
import { ResultsHeader } from '@/components/search/ResultsHeader';
import { TypeBadges } from '@/components/search/TypeBadges';
import { VideoGrid } from '@/components/search/VideoGrid';
import { VideoListView } from '@/components/search/VideoListView';
import { useSourceBadges } from '@/lib/hooks/useSourceBadges';
import { useTypeBadges } from '@/lib/hooks/useTypeBadges';
import { useLanguageBadges } from '@/lib/hooks/useLanguageBadges';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { Video, SourceBadge } from '@/lib/types';

interface SearchResultsProps {
    results: Video[];
    availableSources: SourceBadge[];
    loading: boolean;
    query?: string;
    isPremium?: boolean;
    latencies?: Record<string, number>;
}

/** 手机端首次搜索的骨架行（封面 + 文案 + 按钮） */
function MobileListSkeleton() {
    return (
        <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
                <div
                    key={i}
                    className="flex gap-3 p-2.5 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] animate-pulse"
                >
                    <div className="flex-shrink-0 w-[104px] aspect-[2/3] rounded-xl bg-[color-mix(in_srgb,var(--text-color)_8%,transparent)]" />
                    <div className="flex-1 flex flex-col gap-2 py-1">
                        <div className="h-4 w-2/3 rounded bg-[color-mix(in_srgb,var(--text-color)_8%,transparent)]" />
                        <div className="h-3 w-full rounded bg-[color-mix(in_srgb,var(--text-color)_6%,transparent)]" />
                        <div className="h-3 w-5/6 rounded bg-[color-mix(in_srgb,var(--text-color)_6%,transparent)]" />
                        <div className="mt-auto flex gap-2.5">
                            <div className="h-9 w-20 rounded-full bg-[color-mix(in_srgb,var(--accent-color)_24%,transparent)]" />
                            <div className="h-9 w-20 rounded-full bg-[color-mix(in_srgb,var(--text-color)_8%,transparent)]" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function SearchResults({
    results,
    availableSources,
    loading,
    query,
    isPremium = false,
    latencies = {},
}: SearchResultsProps) {
    const isMobile = useIsMobile();

    // Source filter chain retained (no source badges shown, so nothing is filtered)
    const {
        filteredVideos: sourceFilteredVideos,
    } = useSourceBadges(results, availableSources);

    // Type badges hook - auto-collects and filters by type_name
    // Apply on source-filtered results for combined filtering
    const {
        typeBadges,
        selectedTypes,
        filteredVideos: typeFilteredVideos,
        toggleType,
    } = useTypeBadges(sourceFilteredVideos);

    // Language filter chain retained (no language badges shown, so nothing is filtered)
    const {
        filteredVideos: finalFilteredVideos,
    } = useLanguageBadges(typeFilteredVideos);

    if (results.length === 0 && !loading) return null;

    return (
        <div className="animate-fade-in px-4 sm:px-0">
            <ResultsHeader
                loading={loading}
                resultsCount={results.length}
                availableSources={availableSources}
                query={query}
            />

            {/* 视频源筛选栏已隐藏 */}

            {/* Type Badges - Auto-collected from search results */}
            {typeBadges.length > 0 && (
                <TypeBadges
                    badges={typeBadges}
                    selectedTypes={selectedTypes}
                    onToggleType={toggleType}
                    className="mb-6"
                />
            )}

            {/* 语言标签筛选栏已隐藏 */}

            {/* 手机端：竖向详情列表；桌面/TV：封面网格 */}
            {isMobile ? (
                loading && finalFilteredVideos.length === 0 ? (
                    <MobileListSkeleton />
                ) : (
                    <VideoListView
                        videos={finalFilteredVideos}
                        isPremium={isPremium}
                    />
                )
            ) : (
                <VideoGrid
                    videos={finalFilteredVideos}
                    isPremium={isPremium}
                    latencies={latencies}
                />
            )}
        </div>
    );
}
