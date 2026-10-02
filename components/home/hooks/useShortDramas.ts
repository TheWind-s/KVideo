import { useEffect, useMemo, useRef } from 'react';
import { useParallelSearch } from '@/lib/hooks/useParallelSearch';
import { settingsStore } from '@/lib/store/settings-store';
import { userSourcesStore } from '@/lib/store/user-sources-store';
import type { Video } from '@/lib/types';

const noop = () => {};

// 关键词搜索会误命中的非短剧分类（如名为"短剧X家族"的综艺），统一过滤
const EXCLUDED_CATEGORY_KEYWORDS = ['综艺', '动画', '动漫', '纪录', '新闻', '体育'];

// 按剧名去重，同名结果优先保留响应延迟更低的源
function dedupeByName(videos: Video[]): Video[] {
    const picked = new Map<string, Video>();
    for (const video of videos) {
        const key = video.vod_name.toLowerCase().trim();
        const existing = picked.get(key);
        if (!existing) {
            picked.set(key, video);
            continue;
        }
        const existingLatency = existing.latency ?? Number.POSITIVE_INFINITY;
        const currentLatency = video.latency ?? Number.POSITIVE_INFINITY;
        if (currentLatency < existingLatency) picked.set(key, video);
    }
    return [...picked.values()];
}

/**
 * 短剧内容豆瓣推荐接口不提供（标签接口无"短剧"，recommend 搜短剧返回 0 条），
 * 因此直接聚合已启用的视频源，复用首页搜索框同一套并行流式搜索能力。
 */
export function useShortDramas(keyword: string) {
    const {
        loading,
        results,
        performSearch,
        resetSearch,
        cancelSearch,
    } = useParallelSearch(noop, noop);

    const triggeredRef = useRef<string | null>(null);

    useEffect(() => {
        triggeredRef.current = null;

        let cancelled = false;
        resetSearch();

        const run = () => {
            if (cancelled || triggeredRef.current === keyword) return;
            const settings = settingsStore.getSettings();
            const enabledSources = settings.sources.filter((s) => s.enabled);
            const userSources = userSourcesStore.getSources().filter((s) => s.enabled !== false);
            const allSources = [...enabledSources];
            for (const us of userSources) {
                if (!allSources.find((s) => s.id === us.id)) allSources.push(us);
            }
            if (allSources.length === 0) return;
            triggeredRef.current = keyword;
            performSearch(keyword, allSources, settings.sortBy);
        };

        run();
        // Sources may arrive shortly after mount (subscription fetch)
        const timer = setTimeout(run, 800);
        const unsubscribe = settingsStore.subscribe(() => {
            if (triggeredRef.current !== keyword) run();
        });

        return () => {
            cancelled = true;
            clearTimeout(timer);
            unsubscribe();
            // 卸载或关键词变化时中断进行中的流式请求
            cancelSearch();
        };
    }, [keyword, performSearch, resetSearch, cancelSearch]);

    // 过滤非短剧分类并按剧名去重，避免浏览页同一短剧堆叠多个源
    const dedupedResults = useMemo(() => {
        const filtered = results.filter((video) => {
            const category = video.type_name || '';
            return !EXCLUDED_CATEGORY_KEYWORDS.some((word) => category.includes(word));
        });
        return dedupeByName(filtered);
    }, [results]);

    return { loading, results: dedupedResults };
}
