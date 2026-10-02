/**
 * ShortDramaSection - 短剧频道
 *
 * 短剧走视频源原生分类浏览（而非关键词按片名搜索）：
 * 第一行选择视频源，第二行选择该源短剧分类下的子标签，
 * 网格无限滚动加载分类影片。
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
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

    // 正在探测可用源
    if (sourcesLoading && sources.length === 0) {
        return (
            <div className="flex justify-center py-12">
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
            <div className="text-center py-20">
                <Icons.Film size={64} className="text-[var(--text-color-secondary)] mx-auto mb-4" />
                <p className="text-[var(--text-color-secondary)]">当前启用的视频源均未提供短剧分类</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in">
            {/* 视频源选择行（横向滚动） */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 mb-2">
                {sources.map((s) => (
                    <button
                        key={s.sourceId}
                        type="button"
                        onClick={() => setSourceId(s.sourceId)}
                        className={chipClass(s.sourceId === sourceId)}
                    >
                        {s.sourceName}
                    </button>
                ))}
            </div>

            {/* 子分类标签行：无子分类时仅显示"全部" */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 mb-5">
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
                <div className="flex justify-center py-12">
                    <div className="flex flex-col items-center gap-3">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--accent-color)] border-t-transparent"></div>
                        <p className="text-sm text-[var(--text-color-secondary)]">正在加载短剧...</p>
                    </div>
                </div>
            ) : videos.length === 0 ? (
                <div className="text-center py-20">
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
