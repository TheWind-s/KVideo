'use client';

import { useEffect, useState } from 'react';
import { settingsStore } from '@/lib/store/settings-store';
import { userSourcesStore } from '@/lib/store/user-sources-store';
import type { ShortDramaSourceInfo } from '@/lib/api/short-drama-api';

/**
 * 探测哪些已启用视频源提供短剧分类。
 * - 模块级缓存：切换标签/重进短剧页 10 分钟内免重复探测
 * - localStorage 持久化：跨会话 24 小时内免等待，进入短剧页即刻可浏览
 */

const MEMORY_TTL = 10 * 60 * 1000;
const STORAGE_TTL = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'kvideo_short_sources_v1';

let cache: { at: number; sources: ShortDramaSourceInfo[] } | null = null;
let inflight: Promise<ShortDramaSourceInfo[]> | null = null;

// 模块初始化时尝试从 localStorage 恢复（仅浏览器环境）
if (typeof window !== 'undefined') {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const saved = JSON.parse(raw) as { at: number; sources: ShortDramaSourceInfo[] };
            if (Array.isArray(saved?.sources) && Date.now() - saved.at < STORAGE_TTL) {
                cache = saved;
            }
        }
    } catch {
        // 解析失败忽略
    }
}

function collectEnabledSources() {
    const settings = settingsStore.getSettings();
    const merged = [...settings.sources.filter((s) => s.enabled)];
    for (const us of userSourcesStore.getSources()) {
        if (us.enabled === false) continue;
        if (!merged.find((s) => s.id === us.id)) merged.push(us);
    }
    return merged;
}

async function probeSources(): Promise<ShortDramaSourceInfo[]> {
    if (cache && Date.now() - cache.at < MEMORY_TTL) return cache.sources;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const res = await fetch('/api/short-drama/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sources: collectEnabledSources() }),
            });
            const data = await res.json();
            const sources: ShortDramaSourceInfo[] = Array.isArray(data?.sources) ? data.sources : [];
            if (sources.length > 0) {
                cache = { at: Date.now(), sources };
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
                } catch {
                    // 配额/隐私模式忽略
                }
            } else if (cache) {
                return cache.sources; // 探测全失败时回退到旧缓存
            }
            return sources;
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

export function useShortDramaSources() {
    const [sources, setSources] = useState<ShortDramaSourceInfo[]>(cache?.sources ?? []);
    const [loading, setLoading] = useState(!cache || Date.now() - cache.at >= MEMORY_TTL);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe: (() => void) | undefined;
        let finished = false;

        const run = () => {
            if (finished) return;
            if (collectEnabledSources().length === 0) return; // 源尚未就绪，等订阅
            finished = true;
            probeSources()
                .then((list) => {
                    if (!cancelled) setSources(list);
                })
                .catch(() => {
                    if (!cancelled) setSources([]);
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        };

        run();
        // 源清单可能在挂载后才异步订阅完成，延迟兜底一次
        timer = setTimeout(run, 800);
        unsubscribe = settingsStore.subscribe(run);

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            unsubscribe?.();
        };
    }, []);

    return { sources, loading };
}
