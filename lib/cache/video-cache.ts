/*
 * 视频缓存（纯网页实现，无需升级 App）
 *
 * 媒体字节存放在 Cache API（cache 名与 public/sw.js 保持一致），
 * 任务元数据（标题/集数/URL 列表/进度）存 IndexedDB。
 * Service Worker 负责播放时的 cache-first 拦截与离线回放，
 * 本模块负责：解析 m3u8、预热下载分片、暂停/续传/删除、离线快照查询。
 */

const DB_NAME = 'kvideo-cache-db';
const DB_VERSION = 1;
const STORE_JOBS = 'jobs';
export const MEDIA_CACHE_NAME = 'kvideo-media-v1';

const CONCURRENCY = 4;
const PER_URL_RETRY = 3;
const EMIT_THROTTLE_MS = 400;
const IDB_WRITE_THROTTLE_MS = 1000;

export type JobStatus = 'downloading' | 'paused' | 'completed' | 'error';

export interface CachedVideoJob {
    /** 主键：playUrl 的 SHA-1 前 16 位 */
    key: string;
    playUrl: string;
    videoId: string;
    source: string;
    title: string;
    episodeIndex: number;
    episodeName: string;
    /** 播放页相对地址（/player?id=...），离线列表点击跳转用 */
    pageUrl: string;
    kind: 'hls' | 'file';
    /** 该任务需要缓存的全部 URL（playlist/key/init/分片/文件），删除时逐个清理 */
    urls: string[];
    /** 已完成（含此前已缓存）的 URL 数 */
    doneCount: number;
    /** 已下载字节（估算） */
    cachedBytes: number;
    /** 总字节：未知为 0，前端按分片数估算 */
    totalBytes: number;
    status: JobStatus;
    error?: string;
    createdAt: number;
    updatedAt: number;
}

export interface StorageInfo {
    quota: number;
    usage: number;
    persistent: boolean;
}

export interface StartJobOptions {
    playUrl: string;
    videoId: string;
    source: string;
    title: string;
    episodeIndex: number;
    episodeName: string;
}

// ---------- IndexedDB ----------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('当前环境不支持 IndexedDB'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_JOBS)) {
                const store = db.createObjectStore(STORE_JOBS, { keyPath: 'key' });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('打开缓存数据库失败'));
    });
    return dbPromise;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbPut(job: CachedVideoJob): Promise<void> {
    const db = await openDB();
    await idbRequest(db.transaction(STORE_JOBS, 'readwrite').objectStore(STORE_JOBS).put(job));
}

async function idbGet(key: string): Promise<CachedVideoJob | undefined> {
    const db = await openDB();
    return idbRequest<CachedVideoJob | undefined>(
        db.transaction(STORE_JOBS, 'readonly').objectStore(STORE_JOBS).get(key)
    );
}

async function idbGetAll(): Promise<CachedVideoJob[]> {
    const db = await openDB();
    return idbRequest<CachedVideoJob[]>(
        db.transaction(STORE_JOBS, 'readonly').objectStore(STORE_JOBS).getAll()
    );
}

async function idbDelete(key: string): Promise<void> {
    const db = await openDB();
    await idbRequest(db.transaction(STORE_JOBS, 'readwrite').objectStore(STORE_JOBS).delete(key));
}

// ---------- 内存状态与订阅 ----------

const jobsCache = new Map<string, CachedVideoJob>();
const listeners = new Set<() => void>();
let hydrated = false;

interface DownloadControl {
    controller: AbortController;
    paused: boolean;
}
const controls = new Map<string, DownloadControl>();

let lastEmit = 0;
let emitTimer: ReturnType<typeof setTimeout> | null = null;

function emitNow() {
    for (const cb of listeners) {
        try { cb(); } catch { /* ignore listener errors */ }
    }
}

function emit() {
    const now = Date.now();
    if (now - lastEmit >= EMIT_THROTTLE_MS) {
        lastEmit = now;
        emitNow();
        return;
    }
    if (!emitTimer) {
        emitTimer = setTimeout(() => {
            emitTimer = null;
            lastEmit = Date.now();
            emitNow();
        }, EMIT_THROTTLE_MS);
    }
}

function flushEmit() {
    if (emitTimer) {
        clearTimeout(emitTimer);
        emitTimer = null;
    }
    lastEmit = Date.now();
    emitNow();
}

export function subscribeJobs(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function getJobState(key: string): CachedVideoJob | undefined {
    return jobsCache.get(key);
}

/** useSyncExternalStore 的快照：按更新时间倒序的数组引用（状态变化时换新引用） */
let snapshot: CachedVideoJob[] = [];

function rebuildSnapshot() {
    snapshot = [...jobsCache.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getJobsSnapshot(): CachedVideoJob[] {
    return snapshot;
}

async function persistJob(job: CachedVideoJob, force = false) {
    job.updatedAt = Date.now();
    jobsCache.set(job.key, job);
    rebuildSnapshot();
    emit();
    if (force) {
        await idbPut(job);
        return;
    }
    scheduleIdbWrite(job);
}

const idbWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleIdbWrite(job: CachedVideoJob) {
    const existing = idbWriteTimers.get(job.key);
    if (existing) clearTimeout(existing);
    idbWriteTimers.set(job.key, setTimeout(() => {
        idbWriteTimers.delete(job.key);
        idbPut(job).catch(() => { /* 下次状态变更会再写 */ });
    }, IDB_WRITE_THROTTLE_MS));
}

// ---------- 工具 ----------

export async function hashKey(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-1', data);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
}

function stripHash(url: string): string {
    try {
        const u = new URL(url, window.location.href);
        u.hash = '';
        return u.toString();
    } catch {
        return url;
    }
}

function isHlsUrl(url: string): boolean {
    try {
        const u = new URL(url, window.location.href);
        const proxied = u.searchParams.get('url');
        const target = proxied || u.pathname;
        return /\.m3u8(\?|#|$)/i.test(target);
    } catch {
        return /\.m3u8(\?|#|$)/i.test(url);
    }
}

export function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    return `${value >= 100 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}

export async function getStorageInfo(): Promise<StorageInfo> {
    const fallback: StorageInfo = { quota: 0, usage: 0, persistent: false };
    if (!navigator.storage) return fallback;
    try {
        const est = await navigator.storage.estimate();
        const persistent = await navigator.storage.persisted();
        return {
            quota: est.quota || 0,
            usage: est.usage || 0,
            persistent,
        };
    } catch {
        return fallback;
    }
}

export async function requestPersistentStorage(): Promise<boolean> {
    try {
        if (navigator.storage?.persist) return await navigator.storage.persist();
    } catch { /* ignore */ }
    return false;
}

// ---------- 跨域 URL 走应用代理 ----------
// 跨域资源（源站 m3u8、ts 分片）不能直接 fetch（CORS 失败 / ERR_FAILED），
// 必须包装为 /api/proxy?url=<encoded> 后再请求：
// 1. 代理加上 CORS 头，浏览器允许 fetch
// 2. 代理改写 m3u8 内部 URL，使其也走代理，从而 SW 能拦截并缓存
// 3. 离线回看时，hls.js 也是通过代理访问 master，缓存键与本下载器一致
function toProxiedUrl(url: string): string {
    try {
        const target = new URL(url, window.location.origin);
        if (target.origin === window.location.origin) return url; // 同源：直接用
        return `${window.location.origin}/api/proxy?url=${encodeURIComponent(target.toString())}`;
    } catch {
        return url;
    }
}

// ---------- m3u8 解析 ----------

interface VariantInfo {
    uri: string;
    bandwidth: number;
    codecs: string;
    resolution: number;
}

function parseStreamAttrs(line: string): { bandwidth: number; codecs: string; resolution: number } {
    const bandwidthMatch = /BANDWIDTH=(\d+)/i.exec(line);
    const codecsMatch = /CODECS="([^"]*)"/i.exec(line);
    const resolutionMatch = /RESOLUTION=(\d+)x(\d+)/i.exec(line);
    return {
        bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0,
        codecs: codecsMatch?.[1] || '',
        resolution: resolutionMatch ? parseInt(resolutionMatch[2], 10) : 0,
    };
}

function isHevcCodecs(codecs: string): boolean {
    return /hvc1|hev1|hevc|h265/i.test(codecs);
}

interface ParsedHls {
    /** master + 选中的 variant playlist */
    playlistUrls: string[];
    /** 媒体分片 + AES key + fMP4 init 段 */
    mediaUrls: string[];
    /** 多码率 master 时，改写为只含已下载 variant 的精简 master（离线播放用）；单层播放列表为 null */
    rewrittenMaster: { url: string; text: string } | null;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
    const proxiedUrl = toProxiedUrl(url);
    const res = await fetch(proxiedUrl, { mode: 'cors', signal });
    if (!res.ok) throw new Error(`播放列表加载失败 (HTTP ${res.status})`);
    return res.text();
}

function parseMediaPlaylist(text: string, baseUrl: string): { media: string[] } {
    const media = new Set<string>();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXT-X-KEY')) {
            const uriMatch = /URI="([^"]+)"/.exec(line);
            if (uriMatch) media.add(new URL(uriMatch[1], baseUrl).toString());
            continue;
        }
        if (line.startsWith('#EXT-X-MAP')) {
            const uriMatch = /URI="([^"]+)"/.exec(line);
            if (uriMatch) media.add(new URL(uriMatch[1], baseUrl).toString());
            continue;
        }
        if (line.startsWith('#')) continue;

        // 普通 URI 行（分片）
        media.add(new URL(line, baseUrl).toString());
    }
    return { media: [...media] };
}

async function parseHls(masterUrl: string, signal?: AbortSignal): Promise<ParsedHls> {
    // masterUrl 可能是跨域原始 URL；统一转换为代理 URL 后再解析，
    // 这样 playlistUrls / mediaUrls / rewrittenMaster 的缓存键与 SW 拦截键一致
    const fetchUrl = toProxiedUrl(masterUrl);
    const masterText = await fetchText(fetchUrl, signal);
    const lines = masterText.split(/\r?\n/);
    const variants: Array<VariantInfo & { streamLine: string }> = [];
    const masterHeaderLines: string[] = ['#EXTM3U'];

    let lastStreamLine = '';
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#EXT-X-STREAM-INF')) {
            lastStreamLine = line;
            continue;
        }
        if (line.startsWith('#')) {
            // 保留 master 全局标签（VERSION/独立音轨 MEDIA 等与选中码率相关的也一并保留）
            if (!line.startsWith('#EXTM3U') && !line.startsWith('#EXT-X-STREAM-INF')) {
                masterHeaderLines.push(line);
            }
            continue;
        }
        if (lastStreamLine) {
            const attrs = parseStreamAttrs(lastStreamLine);
            variants.push({ uri: new URL(line, fetchUrl).toString(), streamLine: lastStreamLine, ...attrs });
            lastStreamLine = '';
        }
    }

    const playlistUrls = new Set<string>([stripHash(fetchUrl)]);
    let mediaUrls: string[] = [];
    let rewrittenMaster: { url: string; text: string } | null = null;

    if (variants.length === 0) {
        // 单层播放列表（最常见：苹果CMS V10 大多直出 media playlist）
        mediaUrls = parseMediaPlaylist(masterText, fetchUrl).media;
    } else {
        // 多码率 master：与播放器 HEVC 过滤一致，优先最高带宽的 H.264 variant
        const h264 = variants.filter((v) => !isHevcCodecs(v.codecs));
        const pool = h264.length > 0 ? h264 : variants;
        const selected = [...pool].sort((a, b) =>
            b.bandwidth - a.bandwidth || b.resolution - a.resolution
        )[0];

        playlistUrls.add(stripHash(selected.uri));

        const variantText = await fetchText(selected.uri, signal);
        mediaUrls = parseMediaPlaylist(variantText, selected.uri).media;

        // 精简 master：离线时 SW 回退此版本，hls.js 只能看到已下载的码率
        const rewrittenLines = [
            ...masterHeaderLines,
            selected.streamLine,
            selected.uri,
        ];
        rewrittenMaster = { url: stripHash(fetchUrl), text: rewrittenLines.join('\n') + '\n' };
    }

    return {
        playlistUrls: [...playlistUrls],
        mediaUrls,
        rewrittenMaster,
    };
}

// ---------- 下载器 ----------

async function isCached(url: string): Promise<boolean> {
    try {
        const cache = await caches.open(MEDIA_CACHE_NAME);
        const hit = await cache.match(new Request(url), { ignoreVary: true });
        return !!hit;
    } catch {
        return false;
    }
}

function isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
}

function isQuotaError(err: unknown): boolean {
    return err instanceof DOMException &&
        (err.name === 'QuotaExceededError' || err.name === 'NotSupportedError');
}

async function fetchWithRetry(url: string, signal: AbortSignal): Promise<Response> {
    const proxiedUrl = toProxiedUrl(url);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < PER_URL_RETRY; attempt += 1) {
        try {
            const res = await fetch(proxiedUrl, { mode: 'cors', signal });
            if (res.ok) return res;
            lastErr = new Error(`HTTP ${res.status}`);
        } catch (err) {
            if (isAbortError(err)) throw err;
            lastErr = err;
        }
        if (attempt < PER_URL_RETRY - 1) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('下载失败');
}

async function runDownload(key: string) {
    const job = jobsCache.get(key);
    if (!job) return;

    const control: DownloadControl = {
        controller: new AbortController(),
        paused: false,
    };
    controls.set(key, control);

    let writeTimer: ReturnType<typeof setTimeout> | null = null;

    try {
        // 刷新任务自身 URL 清单（playlist 可能变化 / 首次解析）
        let allUrls = job.urls;
        let kind = job.kind;
        let rewrittenMaster: { url: string; text: string } | null = null;
        if (allUrls.length === 0 || kind === 'hls') {
            kind = isHlsUrl(job.playUrl) ? 'hls' : 'file';
            if (kind === 'hls') {
                const parsed = await parseHls(job.playUrl, control.controller.signal);
                allUrls = [...new Set([...parsed.playlistUrls, ...parsed.mediaUrls])];
                rewrittenMaster = parsed.rewrittenMaster;
            } else {
                allUrls = [stripHash(toProxiedUrl(job.playUrl))];
            }
            job.kind = kind;
            job.urls = allUrls;
            await persistJob(job, true);
        }

        if (allUrls.length === 0) {
            throw new Error('没有可缓存的视频分片');
        }

        const cache = await caches.open(MEDIA_CACHE_NAME);
        const pending: string[] = [];
        let done = job.doneCount;
        let bytes = job.cachedBytes;

        // 启动前先校准哪些已经在缓存（断点续传 / 边看边存过的分片直接跳过）
        for (const url of allUrls) {
            if (await isCached(url)) continue;
            pending.push(url);
        }
        done = allUrls.length - pending.length;
        job.doneCount = done;

        // 已知分片大小时用真实字节估算总量，否则按分片数线性估算
        const estimateTotal = () => {
            if (bytes > 0 && done > 0) {
                return Math.round((bytes / done) * allUrls.length);
            }
            return 0;
        };

        let index = 0;
        let failedUrl = '';

        const worker = async () => {
            while (index < pending.length) {
                if (control.paused) return;
                const url = pending[index];
                index += 1;

                let res: Response;
                try {
                    res = await fetchWithRetry(url, control.controller.signal);
                } catch (err) {
                    if (isAbortError(err)) throw err;
                    failedUrl = url;
                    throw err;
                }

                // 显式写入：覆盖无扩展名的 AES key 等 SW 无法按扩展名识别的资源
                await cache.put(new Request(url), res.clone()).catch((err) => {
                    if (isQuotaError(err)) throw err;
                });

                const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
                bytes += Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
                done += 1;

                job.doneCount = done;
                job.cachedBytes = bytes;
                job.totalBytes = estimateTotal();

                // 节流写 UI/DB
                if (!writeTimer) {
                    writeTimer = setTimeout(() => {
                        writeTimer = null;
                        persistJob(job).catch(() => { /* ignore */ });
                    }, 300);
                }
                emit();
            }
        };

        job.status = 'downloading';
        job.error = undefined;
        await persistJob(job, true);

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length || 1) }, worker));

        if (control.paused) {
            job.status = 'paused';
            await persistJob(job, true);
            return;
        }

        if (failedUrl) throw new Error('部分分片下载失败，请重试');

        // 多码率视频：用只含已下载码率的精简 master 覆盖缓存，离线时 hls.js 不会切到缺失码率
        if (rewrittenMaster) {
            await cache.put(
                new Request(rewrittenMaster.url),
                new Response(rewrittenMaster.text, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/vnd.apple.mpegurl;charset=utf-8',
                        'X-KVideo-Rewritten': '1',
                    },
                })
            );
        }

        // 终态校验
        let verified = 0;
        for (const url of allUrls) {
            if (await isCached(url)) verified += 1;
        }
        if (verified < allUrls.length) {
            job.status = 'paused';
            job.error = `还有 ${allUrls.length - verified} 个分片未完成`;
            await persistJob(job, true);
            return;
        }

        job.doneCount = allUrls.length;
        job.status = 'completed';
        job.error = undefined;
        await persistJob(job, true);
        flushEmit();
    } catch (err) {
        if (isAbortError(err)) {
            // 删除导致的中断：记录已被删除，直接退出
            return;
        }
        const existing = jobsCache.get(key);
        if (existing && !control.paused) {
            existing.status = 'error';
            existing.error = err instanceof Error ? err.message : '缓存失败';
            await persistJob(existing, true);
        }
    } finally {
        if (writeTimer) clearTimeout(writeTimer);
        controls.delete(key);
    }
}

// ---------- 对外 API ----------

let normalizePromise: Promise<void> | null = null;

/** 首次使用时加载 IDB；上次进程被杀导致残留 downloading 的任务标记为 paused */
export function hydrateJobs(): Promise<void> {
    if (hydrated) return Promise.resolve();
    if (!normalizePromise) {
        normalizePromise = (async () => {
            try {
                const all = await idbGetAll();
                let changed = false;
                for (const job of all) {
                    if (job.status === 'downloading') {
                        job.status = 'paused';
                        job.updatedAt = Date.now();
                        changed = true;
                        await idbPut(job);
                    }
                    jobsCache.set(job.key, job);
                }
                rebuildSnapshot();
                hydrated = true;
                if (changed) flushEmit();
            } catch (err) {
                // IndexedDB 不可用时功能降级（仅当前会话可用）
                hydrated = true;
                console.warn('[video-cache] hydrate failed', err);
            }
        })();
    }
    return normalizePromise;
}

export async function getJobByPlayUrl(playUrl: string): Promise<CachedVideoJob | undefined> {
    await hydrateJobs();
    const key = await hashKey(stripHash(playUrl));
    return jobsCache.get(key);
}

export async function findPlayableJob(
    source: string,
    videoId: string,
    episodeIndex?: number
): Promise<CachedVideoJob | undefined> {
    await hydrateJobs();
    const all = [...jobsCache.values()].filter(
        (job) =>
            job.source === source &&
            job.videoId === videoId &&
            (job.status === 'completed' || job.status === 'paused' || job.status === 'downloading')
    );
    if (episodeIndex === undefined || episodeIndex < 0) {
        return all.sort((a, b) => a.episodeIndex - b.episodeIndex)[0];
    }
    return all.find((job) => job.episodeIndex === episodeIndex);
}

export async function startJob(options: StartJobOptions): Promise<void> {
    await hydrateJobs();
    await requestPersistentStorage();

    const playUrl = stripHash(options.playUrl);
    const key = await hashKey(playUrl);
    const existing = jobsCache.get(key);

    if (existing && existing.status === 'downloading') return;

    let pageUrl = `/player?id=${encodeURIComponent(options.videoId)}&source=${encodeURIComponent(options.source)}&title=${encodeURIComponent(options.title)}`;
    if (options.episodeIndex > 0) pageUrl += `&episode=${options.episodeIndex}`;
    if (typeof window !== 'undefined') {
        try {
            const current = new URL(window.location.href);
            const gs = current.searchParams.get('gs');
            if (gs) pageUrl += `&gs=${encodeURIComponent(gs)}`;
            const premium = current.searchParams.get('premium');
            if (premium) pageUrl += `&premium=${encodeURIComponent(premium)}`;
        } catch { /* ignore */ }
    }

    const job: CachedVideoJob = existing
        ? { ...existing, status: 'downloading', error: undefined, updatedAt: Date.now() }
        : {
            key,
            playUrl,
            videoId: options.videoId,
            source: options.source,
            title: options.title,
            episodeIndex: options.episodeIndex,
            episodeName: options.episodeName,
            pageUrl,
            kind: isHlsUrl(playUrl) ? 'hls' : 'file',
            urls: [],
            doneCount: 0,
            cachedBytes: 0,
            totalBytes: 0,
            status: 'downloading',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

    await persistJob(job, true);
    // 不 await：后台进行
    void runDownload(key);
}

export async function pauseJob(key: string): Promise<void> {
    const control = controls.get(key);
    if (control) control.paused = true;
    const job = jobsCache.get(key);
    if (job && job.status === 'downloading') {
        job.status = 'paused';
        await persistJob(job, true);
    }
}

export async function resumeJob(key: string): Promise<void> {
    const job = jobsCache.get(key);
    if (!job || job.status === 'completed' || job.status === 'downloading') return;
    job.status = 'downloading';
    job.error = undefined;
    await persistJob(job, true);
    await requestPersistentStorage();
    void runDownload(key);
}

export async function deleteJob(key: string): Promise<void> {
    const control = controls.get(key);
    if (control) {
        control.paused = true;
        try { control.controller.abort(); } catch { /* ignore */ }
    }
    const job = jobsCache.get(key);
    if (job) {
        try {
            const cache = await caches.open(MEDIA_CACHE_NAME);
            // 只删除本任务登记的 URL，避免误删其他剧集共享的同源资源（极少）
            await Promise.all(job.urls.map((url) =>
                cache.delete(new Request(url), { ignoreVary: true }).catch(() => false)
            ));
        } catch { /* 缓存不可用时仅清元数据 */ }
    }
    jobsCache.delete(key);
    rebuildSnapshot();
    await idbDelete(key).catch(() => { /* ignore */ });
    flushEmit();
}

export async function clearAllJobs(): Promise<void> {
    await hydrateJobs();
    for (const key of [...jobsCache.keys()]) {
        await deleteJob(key);
    }
    try {
        await caches.delete(MEDIA_CACHE_NAME);
    } catch { /* ignore */ }
}

