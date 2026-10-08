/*
 * 洋芋影视 Service Worker
 * 职责：
 * 1. 视频流缓存（HLS m3u8/ts、mp4、加密 key）——缓存本集 / 边看边存 / 离线回看
 * 2. 播放器静态壳缓存（_next/static）——离线时播放页仍可打开
 * 3. 导航请求 network-first，离线回退最近缓存的页面
 * 注意：只做被动缓存与显式缓存，不拦截非 GET、不代理 API 写请求。
 */

const MEDIA_CACHE = 'kvideo-media-v1';
const SHELL_CACHE = 'kvideo-shell-v1';
const ACTIVE_CACHES = [MEDIA_CACHE, SHELL_CACHE];
const LEGACY_CACHE_PREFIXES = ['video-cache-'];

const MANIFEST_EXT_RE = /\.(m3u8|m3u)(\?|#|$)/i;
const MEDIA_EXT_RE = /\.(m3u8|m3u|ts|m4s|mp4|m4v|mov|m4a|aac|mp3|flv|webm|key)(\?|#|$)/i;
const STATIC_PATH_RE = /\/_next\/(static|image)\//;
const PROXY_PATH_RE = /\/api\/(proxy|iptv\/stream)(\/|$)/i;

/** 代理 URL 中真实资源地址的判断 */
function getProxiedUrl(urlObj) {
    if (!PROXY_PATH_RE.test(urlObj.pathname)) return null;
    const raw = urlObj.searchParams.get('url') || urlObj.searchParams.get('u');
    return raw || null;
}

function isManifestRequest(urlObj) {
    if (MANIFEST_EXT_RE.test(urlObj.pathname)) return true;
    const proxied = getProxiedUrl(urlObj);
    return !!proxied && MANIFEST_EXT_RE.test(proxed.split('#')[0]);
}

function isMediaLike(urlObj) {
    if (MEDIA_EXT_RE.test(urlObj.pathname)) return true;
    const proxied = getProxiedUrl(urlObj);
    return !!proxied && MEDIA_EXT_RE.test(proxied.split('#')[0]);
}

function isCacheableResponse(res) {
    if (!res) return false;
    // 只存完整 200（206 是 Range 部分内容，直接缓存会破坏后续拖动）
    if (res.status !== 200) return false;
    // basic=同源 / cors=跨域带 CORS 头 / opaque=no-cors 不可读但可回放
    return res.type === 'basic' || res.type === 'cors' || res.type === 'opaque';
}

/** 用缓存的完整 200 响应手工构造 206 Range 响应（支持大文件流式切片，不读进内存） */
async function buildRangeResponse(fullResponse, rangeHeader) {
    const totalHeader = fullResponse.headers.get('content-length');
    const total = totalHeader ? parseInt(totalHeader, 10) : NaN;
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
    if (!match || isNaN(total) || total <= 0 || !fullResponse.body) return null;

    let start = match[1] ? parseInt(match[1], 10) : NaN;
    let end = match[2] ? parseInt(match[2], 10) : NaN;

    if (isNaN(start)) {
        // bytes=-N 后缀形式
        const suffix = isNaN(end) ? 0 : end;
        start = Math.max(0, total - suffix);
        end = total - 1;
    } else if (isNaN(end)) {
        end = total - 1;
    }

    if (start >= total || start < 0) {
        return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` },
        });
    }
    end = Math.min(end, total - 1);

    const reader = fullResponse.body.getReader();
    let pos = 0;
    let finished = false;
    let closed = false;

    const closeStream = (controller) => {
        if (closed) return;
        closed = true;
        finished = true;
        controller.close();
    };

    const slicedStream = new ReadableStream({
        async pull(controller) {
            if (finished) return;
            try {
                // 在同一次 pull 内循环读取：跳过目标区间之前的所有数据。
                // 不能把"丢弃后 return"交回流调度器——空 pull 后 Chromium 不保证再次触发 pull，会导致挂死。
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        closeStream(controller);
                        return;
                    }
                    if (!value || value.length === 0) continue;

                    const chunkStart = pos;
                    const chunkEnd = pos + value.length - 1;
                    pos = chunkEnd + 1;

                    if (chunkEnd < start) continue; // 区间前：同一次 pull 内继续读
                    if (chunkStart > end) {
                        closeStream(controller);
                        return;
                    }

                    const sliceFrom = Math.max(start, chunkStart) - chunkStart;
                    const sliceTo = Math.min(end, chunkEnd) - chunkStart;
                    controller.enqueue(value.subarray(sliceFrom, sliceTo + 1));

                    if (chunkEnd >= end) {
                        closeStream(controller);
                    }
                    // 本 chunk 已输出：交回调度器，由消费者背压驱动下一次 pull 读取后续 chunk
                    return;
                }
            } catch (err) {
                controller.error(err);
            }
        },
    });

    const headers = new Headers();
    headers.set('Content-Type', fullResponse.headers.get('content-type') || 'video/mp4');
    headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');

    return new Response(slicedStream, { status: 206, headers });
}

/** 视频流：cache-first（离线回放 + 显式下载缓存命中）；不写-on-miss（避免 SW 内 fetch+put 链路异常） */
async function handleMediaRequest(request, urlObj) {
    const cache = await caches.open(MEDIA_CACHE);

    // 1) 缓存命中：直接返回（含下载器写入的精简 master / 显式缓存的分片）
    //    对缓存中的完整 200 响应，按需合成 206 Range（支持 mp4 拖动 / 离线 seek）
    const cached = await cache.match(request, { ignoreVary: true }).catch(() => null);
    if (cached) {
        const rangeHeader = request.headers.get('range');
        if (rangeHeader && cached.status === 200) {
            const ranged = await buildRangeResponse(cached, rangeHeader);
            if (ranged) return ranged;
        }
        return cached;
    }

    // 2) 未命中：网络获取，原样返回（不写入缓存；下载器负责显式 cache.put）
    //    对于跨域资源（vip.ffzy-plays.com 等），SW 上下文 fetch 会因 CORS 受限，
    //    浏览器原生 hls.js 会通过 /api/proxy 同源路径访问，那部分由上面的缓存命中处理。
    return fetch(request);
}

/** 导航 HTML：network-first，失败回退缓存（离线打开播放页） */
async function handleNavigation(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const fresh = await fetch(request, { cache: 'no-cache' });
        if (fresh.ok && fresh.status === 200) {
            cache.put(request, fresh.clone()).catch(() => { /* ignore */ });
        }
        return fresh;
    } catch (_) {
        const exact = await cache.match(request).catch(() => null);
        if (exact) return exact;
        const loose = await cache.match(request, { ignoreSearch: true }).catch(() => null);
        if (loose) return loose;
        const home = await cache.match('/').catch(() => null);
        if (home) return home;
        return new Response('', { status: 503, statusText: 'Offline' });
    }
}

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames
                    .filter((name) =>
                        (LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
                            (!ACTIVE_CACHES.includes(name) && name.startsWith('kvideo-')))
                    )
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    let urlObj;
    try {
        urlObj = new URL(request.url);
    } catch (_) {
        return;
    }
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') return;

    // 页面导航
    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(request));
        return;
    }

    // 同源带 hash 的静态资源
    if (urlObj.origin === self.location.origin && STATIC_PATH_RE.test(urlObj.pathname)) {
        event.respondWith(
            caches.match(request, { ignoreVary: true }).then((hit) => {
                if (hit) return hit;
                return fetch(request).then((res) => {
                    if (res.ok && res.status === 200) {
                        const copy = res.clone();
                        caches.open(SHELL_CACHE)
                            .then((cache) => cache.put(request, copy))
                            .catch(() => { /* ignore */ });
                    }
                    return res;
                });
            })
        );
        return;
    }

    // 视频流（含跨域 hls 分片 / 代理流）
    const mediaLike = isMediaLike(urlObj);
    const proxied = getProxiedUrl(urlObj);
    if (mediaLike || proxied) {
        event.respondWith(handleMediaRequest(request, urlObj));
        return;
    }

    // 其他跨域请求：仅做缓存命中查找（封面图等未缓存请求零副作用）
    if (urlObj.origin !== self.location.origin) {
        event.respondWith(
            caches.match(request, { ignoreVary: true }).then((hit) => hit || fetch(request))
        );
    }
});
