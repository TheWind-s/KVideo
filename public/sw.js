/*
 * 洋芋影视 Service Worker
 * 职责：
 * 1. 播放器静态壳缓存（_next/static）——加速页面加载
 * 2. 导航请求 network-first，离线回退最近缓存的页面
 * 注意：不拦截视频流、不代理 API 写请求。
 */

const SHELL_CACHE = 'kvideo-shell-v1';
const ACTIVE_CACHES = [SHELL_CACHE];
const LEGACY_CACHE_PREFIXES = ['video-cache-', 'kvideo-media-'];

const STATIC_PATH_RE = /\/_next\/(static|image)\//;

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

    // 同源静态资源
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
});
