'use client';

import { useEffect, useRef, useState } from 'react';
import type { SourceInfo } from '@/components/player/EpisodeList';

/**
 * 播放器源测速 + 自动切换最快源（方案 A）
 *
 * 背景：免费采集源的视频 CDN 速度差异巨大（实测可达 5-10 倍），
 * 源 API 延迟（search-parallel 的 latency）测的是 API 服务器，
 * 不代表视频文件 CDN（如 vip.ffzy-plays.com）的真实速度。
 *
 * 本 hook 在「视频迟迟未起播」时（playUrl 已就绪但 2.5s 仍未 playing），
 * 客户端实测：各候选源同集数的 m3u8 首包下载耗时（浏览器→源站 CDN 真实路径），
 * 若明显快于当前源则回调 onAutoSwitch，由页面换源（保留集数/进度）。
 *
 * 结果缓存：sessionStorage 按源缓存 10 分钟（同一 CDN 主机速度基本一致），
 * 避免每次播放都重复测速产生额外流量。
 */

interface SpeedEntry {
    ms: number;
    at: number;
}

const CACHE_PREFIX = 'kvideo-srcspeed:v1:';
const CACHE_TTL_MS = 10 * 60 * 1000;
const DETAIL_TIMEOUT_MS = 6000;
const M3U8_TIMEOUT_MS = 3500;
const MAX_CANDIDATES = 4;
/** 当前源测速快于该值 → 视为已经够快，不切换 */
const CURRENT_FAST_MS = 1500;
/** 候选源测速必须快于该值才有切换价值 */
const CANDIDATE_FAST_MS = 1800;
/** 候选源测速失败时（当前源也失败）更严格的上限 */
const CANDIDATE_STRICT_MS = 1000;
/** 候选源须比当前源快过该比例才值得切换（切换本身有详情请求成本） */
const SWITCH_RATIO = 0.55;

function readSpeedCache(sourceId: string): SpeedEntry | null {
    try {
        const raw = sessionStorage.getItem(CACHE_PREFIX + sourceId);
        if (!raw) return null;
        const entry = JSON.parse(raw) as SpeedEntry;
        if (!entry || typeof entry.ms !== 'number') return null;
        if (Date.now() - entry.at > CACHE_TTL_MS) return null;
        return entry;
    } catch {
        return null;
    }
}

function writeSpeedCache(sourceId: string, ms: number) {
    try {
        sessionStorage.setItem(CACHE_PREFIX + sourceId, JSON.stringify({ ms, at: Date.now() }));
    } catch { /* ignore quota errors */ }
}

function fetchWithTimeout(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    return fetch(url, { signal: controller.signal, cache: 'no-store' })
        .finally(() => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onOuterAbort);
        });
}

/** 拉取某源某集的原始播放地址（复用 /api/detail） */
async function fetchEpisodeUrl(
    id: string,
    source: string,
    episodeIndex: number,
    signal?: AbortSignal
): Promise<string | null> {
    const res = await fetchWithTimeout(`/api/detail?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`, DETAIL_TIMEOUT_MS, signal);
    if (!res.ok) return null;
    const json = await res.json();
    const detail = json?.data ?? json;
    const episodes = detail?.episodes;
    const ep = Array.isArray(episodes) ? episodes[episodeIndex] : undefined;
    return ep?.url || null;
}

/** 计时下载 m3u8（文件极小，总耗时≈CDN 响应速度），失败返回 -1 */
async function timeM3u8(url: string, signal?: AbortSignal): Promise<number> {
    const start = performance.now();
    try {
        const res = await fetchWithTimeout(url, M3U8_TIMEOUT_MS, signal);
        if (!res.ok && res.status !== 200) return -1;
        await res.text();
        return Math.round(performance.now() - start);
    } catch {
        return -1;
    }
}

interface UseSourceSpeedTestParams {
    /** 仅在视频迟迟未起播时为 true（由页面控制：playUrl 就绪 2.5s 后仍未 playing） */
    enabled: boolean;
    currentSource: string;
    currentVideoId: string;
    currentPlayUrl: string;
    episodeIndex: number;
    /** 全部分组源（含当前源，hook 内部会排除） */
    candidates: SourceInfo[];
    onAutoSwitch: (best: SourceInfo, ms: number) => void;
}

export function useSourceSpeedTest({
    enabled,
    currentSource,
    currentVideoId,
    currentPlayUrl,
    episodeIndex,
    candidates,
    onAutoSwitch,
}: UseSourceSpeedTestParams) {
    const [speeds, setSpeeds] = useState<Record<string, number>>({});
    const [testing, setTesting] = useState(false);
    const firedRef = useRef(false);
    /** 已为哪个 视频+集数 启动过测速（换片/换集后重新武装） */
    const startedKeyRef = useRef('');
    const candidatesSig = candidates
        .map((item) => `${item.source}:${item.id}`)
        .join('|');

    useEffect(() => {
        if (!enabled || !currentVideoId || candidates.length === 0) return;
        const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
        if (nav.connection?.saveData) return;
        const startKey = `${currentVideoId}:${episodeIndex}`;
        if (startedKeyRef.current === startKey) return;
        startedKeyRef.current = startKey;
        firedRef.current = false;

        const controller = new AbortController();
        setTesting(true);

        const otherSources = candidates
            .filter((item) => item.source !== currentSource)
            .slice(0, MAX_CANDIDATES);

        (async () => {
            const results: Record<string, number> = {};

            // 先读缓存（命中则免测速）
            const needTest: SourceInfo[] = [];
            for (const item of otherSources) {
                const cached = readSpeedCache(item.source);
                if (cached) {
                    results[item.source] = cached.ms;
                } else {
                    needTest.push(item);
                }
            }
            if (Object.keys(results).length > 0) {
                setSpeeds((prev) => ({ ...prev, ...results }));
            }

            // 并发实测未缓存的源
            await Promise.all(
                needTest.map(async (item) => {
                    const url = await fetchEpisodeUrl(String(item.id), item.source, episodeIndex, controller.signal);
                    if (!url) return;
                    const ms = await timeM3u8(url, controller.signal);
                    if (controller.signal.aborted) return;
                    const value = ms > 0 ? ms : -1;
                    results[item.source] = value;
                    if (value > 0) writeSpeedCache(item.source, value);
                    setSpeeds((prev) => ({ ...prev, [item.source]: value }));
                })
            );

            if (!controller.signal.aborted) setTesting(false);
        })();

        return () => {
            controller.abort();
            setTesting(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, currentVideoId, episodeIndex, candidatesSig]);

    // 当前源测速：playUrl 就绪后计时其 m3u8
    const [currentMs, setCurrentMs] = useState<number | null>(null);
    useEffect(() => {
        if (!enabled || !currentPlayUrl || !currentSource) return;
        if (currentMs !== null) return;
        let cancelled = false;
        (async () => {
            const ms = await timeM3u8(currentPlayUrl);
            if (!cancelled) setCurrentMs(ms > 0 ? ms : -1);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, currentPlayUrl, currentSource]);

    // 决策：候选源明显快于当前源 → 回调一次
    const onAutoSwitchRef = useRef(onAutoSwitch);
    onAutoSwitchRef.current = onAutoSwitch;

    useEffect(() => {
        if (!enabled || firedRef.current) return;
        if (currentMs === null) return; // 当前源尚未测完

        let bestSource = '';
        let bestId = '';
        let bestMs = Infinity;
        for (const item of candidates) {
            if (item.source === currentSource) continue;
            const ms = speeds[item.source];
            if (typeof ms === 'number' && ms > 0 && ms < bestMs) {
                bestMs = ms;
                bestSource = item.source;
                bestId = String(item.id);
            }
        }
        if (!bestSource) return;

        const currentFailed = currentMs === -1;
        const shouldSwitch = currentFailed
            ? bestMs <= CANDIDATE_STRICT_MS
            : currentMs > CURRENT_FAST_MS &&
              bestMs <= CANDIDATE_FAST_MS &&
              bestMs < currentMs * SWITCH_RATIO;
        if (!shouldSwitch) return;

        firedRef.current = true;
        onAutoSwitchRef.current(
            { id: bestId, source: bestSource, sourceName: bestSource },
            bestMs
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, currentMs, speeds, currentSource]);

    return { speeds, testing };
}
