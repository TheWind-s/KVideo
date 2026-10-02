'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import type { Video } from '@/lib/types';
import type { ShortDramaSourceInfo } from '@/lib/api/short-drama-api';

/**
 * 按视频源原生分类浏览短剧（苹果CMS ac=detail&t=分类ID&pg=页码），
 * 支持无限滚动分页。源与子分类来自 useShortDramaSources 的探测结果。
 */
export function useShortDramas(source: ShortDramaSourceInfo | null, typeId: string | number | null) {
    const [videos, setVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(1);
    const pagecountRef = useRef(1);
    const requestSeqRef = useRef(0);

    const loadPage = useCallback(
        async (pg: number, append: boolean, seq: number) => {
            if (!source || !typeId) return;

            const res = await fetch('/api/short-drama/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: {
                        id: source.sourceId,
                        name: source.sourceName,
                        baseUrl: source.baseUrl,
                        searchPath: '',
                        detailPath: '',
                    },
                    typeId,
                    pg,
                }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (seq !== requestSeqRef.current) return; // 已切换源/标签，丢弃过期响应

            const incoming: Video[] = Array.isArray(data.list) ? data.list : [];
            pagecountRef.current = Number(data.pagecount) || 1;

            setVideos((prev) => {
                if (!append) return incoming;
                // 保险去重（个别源跨页会重复推同一部）
                const seen = new Set(prev.map((v) => `${v.source}:${v.vod_id}`));
                const fresh = incoming.filter((v) => !seen.has(`${v.source}:${v.vod_id}`));
                return [...prev, ...fresh];
            });
            setHasMore(pg < pagecountRef.current && incoming.length > 0);
        },
        [source, typeId]
    );

    // 切换源或分类：重置并加载第一页
    useEffect(() => {
        const seq = ++requestSeqRef.current;
        setVideos([]);
        setHasMore(true);
        setPage(1);
        pagecountRef.current = 1;

        if (!source || !typeId) return;

        let cancelled = false;
        setLoading(true);
        loadPage(1, false, seq)
            .catch((error) => {
                if (seq === requestSeqRef.current) {
                    console.error('加载短剧列表失败:', error);
                    setHasMore(false);
                }
            })
            .finally(() => {
                if (!cancelled && seq === requestSeqRef.current) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [source, typeId, loadPage]);

    const handleLoadMore = useCallback(
        (nextPage: number) => {
            if (!source || !typeId || loadingMore || nextPage > pagecountRef.current) return;
            const seq = requestSeqRef.current;
            setLoadingMore(true);
            loadPage(nextPage, true, seq)
                .then(() => setPage(nextPage))
                .catch(() => setHasMore(false))
                .finally(() => setLoadingMore(false));
        },
        [source, typeId, loadingMore, loadPage]
    );

    const { prefetchRef, loadMoreRef } = useInfiniteScroll({
        hasMore,
        loading: loading || loadingMore,
        page,
        onLoadMore: handleLoadMore,
    });

    return { videos, loading, loadingMore, hasMore, prefetchRef, loadMoreRef };
}
