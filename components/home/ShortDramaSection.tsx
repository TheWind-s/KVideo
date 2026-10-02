/**
 * ShortDramaSection - 短剧频道
 *
 * 短剧走视频源原生分类浏览（而非关键词按片名搜索）：
 * 视频源自动选择（不展示源切换行），仅展示子分类标签行，
 * 网格无限滚动加载分类影片；当前源"全部"分类为空时自动回退到下一个源。
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { VideoGrid } from '@/components/search/VideoGrid';
import { Icons } from '@/components/ui/Icon';
import { useShortDramaSources } from './hooks/useShortDramaSources';
import { useShortDramas } from './hooks/useShortDramas';
import type { ShortDramaSourceInfo } from '@/lib/api/short-drama-api';

const SOURCE_STORAGE_KEY = 'kvideo_short_source';
const ALL_TAG = '__all__';

function chipClass(active: boolean) {
    return `px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-[13px] font-semibold transition-all whitespace-nowrap rounded-[var(--radius-full)] cursor-pointer select-none ${
        active
            ? 'bg-[var(--accent-color)] text-white shadow-md scale-105'
            : 'bg-[var(--glass-bg)] backdrop-blur-xl text-[var(--text-color)] border border-[var(--glass-border)] hover:border-[var(--accent-color)] hover:scale-105'
    }`;
}

export function ShortDramaSection() {
    const { sources, loading: sourcesLoading } = useShortDramaSources();

    const [sourceId, setSourceId] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem(SOURCE_STORAGE_KEY) || '';
    });
    const [tagId, setTagId] = useState<string>(ALL_TAG);

    // 源列表就绪后校正选中源：优先记忆中的源，否则取第一个
    useEffect(() => {
        if (sources.length === 0) return;
        if (!sources.some((s) => s.sourceId === sourceId)) {
            setSourceId(sources[0].sourceId);
            setTagId(ALL_TAG);
        }
    }, [sources, sourceId]);

    const selectedSource: ShortDramaSourceInfo | null = useMemo(
        () => sources.find((s) => s.sourceId === sourceId) ?? null,
        [sources, sourceId]
    );

    // 切换源时重置为"全部"，并记忆源选择
    useEffect(() => {
        setTagId(ALL_TAG);
        if (sourceId) {
            try {
                localStorage.setItem(SOURCE_STORAGE_KEY, sourceId);
            } catch {
                // 忽略写入失败
            }
        }
    }, [sourceId]);

    const activeTypeId =
        tagId === ALL_TAG
            ? selectedSource?.category.typeId ?? null
            : selectedSource?.children.find((c) => String(c.typeId) === tagId)?.typeId ?? null;

    const { videos, loading, loadingMore, hasMore, prefetchRef, loadMoreRef } =
        useShortDramas(selectedSource, activeTypeId);

    // 源对用户不可见，需要自动回退：当前源"全部"分类加载完仍为空 → 换下一个未试过的源。
    // stateRef 保证超时回调里读到的是最新状态；空窗帧（loading 尚未置 true）会被清除重排。
    const stateRef = useRef({ loading, videos, tagId, selectedSource, sources });
    stateRef.current = { loading, videos, tagId, selectedSource, sources };
    const triedSourcesRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (sourcesLoading || !selectedSource) return;
        if (loading || videos.length > 0) return;

        const timer = setTimeout(() => {
            const s = stateRef.current;
            if (s.loading || s.videos.length > 0) return; // 已有内容/正在加载
            if (s.tagId !== ALL_TAG) return;              // 仅"全部"分类触发回退，具体子分类为空就如实展示
            const currentSource = s.selectedSource;
            if (!currentSource) return;
            if (triedSourcesRef.current.has(currentSource.sourceId)) {
                const retry = sources.find((x) => !triedSourcesRef.current.has(x.sourceId));
                if (!retry) return; // 全部试过，保持空态
            }
            const next =
                sources.find((x) => !triedSourcesRef.current.has(x.sourceId) && x.sourceId !== currentSource.sourceId) ??
                sources.find((x) => x.sourceId !== currentSource.sourceId);
            if (next) {
                triedSourcesRef.current.add(currentSource.sourceId);
                setSourceId(next.sourceId);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [sources, sourcesLoading, selectedSource, loading, videos, tagId]);

    // 正在探测可用源
    if (sourcesLoading && sources.length === 0) {
        return (
            <div className="flex justify-center py-12 px-4">
                <div className="flex flex-col items-center gap-3">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--accent-color)] border-t-transparent"></div>
                    <p className="text-sm text-[var(--text-color-secondary)]">正在发现短剧资源...</p>
                </div>
            </div>
        );
    }

    // 没有任何源提供短剧
    if (sources.length === 0) {
        return (
            <div className="text-center py-20 px-4">
                <Icons.Film size={64} className="text-[var(--text-color-secondary)] mx-auto mb-4" />
                <p className="text-[var(--text-color-secondary)]">当前启用的视频源均未提供短剧分类</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in">
            {/* 视频源自动选择，不展示源切换行 */}

            {/* 子分类标签行：无子分类时仅显示"全部"（手机端网格通屏，标签行保留内边距） */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 mb-5 px-4 sm:px-0">
                <button type="button" onClick={() => setTagId(ALL_TAG)} className={chipClass(tagId === ALL_TAG)}>
                    全部
                </button>
                {selectedSource?.children.map((child) => (
                    <button
                        key={String(child.typeId)}
                        type="button"
                        onClick={() => setTagId(String(child.typeId))}
                        className={chipClass(tagId === String(child.typeId))}
                    >
                        {child.name}
                    </button>
                ))}
            </div>

            {/* 列表区域 */}
            {loading && videos.length === 0 ? (
                <div className="flex justify-center py-12 px-4">
                    <div className="flex flex-col items-center gap-3">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--accent-color)] border-t-transparent"></div>
                        <p className="text-sm text-[var(--text-color-secondary)]">正在加载短剧...</p>
                    </div>
                </div>
            ) : videos.length === 0 ? (
                <div className="text-center py-20 px-4">
                    <Icons.Film size={64} className="text-[var(--text-color-secondary)] mx-auto mb-4" />
                    <p className="text-[var(--text-color-secondary)]">该分类下暂无短剧</p>
                </div>
            ) : (
                <>
                    <VideoGrid videos={videos} />

                    {hasMore && !loadingMore && <div ref={prefetchRef} className="h-1" />}
                    {loadingMore && (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-4 border-[var(--accent-color)] border-t-transparent"></div>
                        </div>
                    )}
                    {hasMore && !loadingMore && <div ref={loadMoreRef} className="h-20" />}
                    {!hasMore && (
                        <div className="text-center py-12">
                            <p className="text-[var(--text-color-secondary)]">没有更多内容了</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
