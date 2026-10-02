
import { ResultsHeader } from '@/components/search/ResultsHeader';
import { TypeBadges } from '@/components/search/TypeBadges';
import { VideoGrid } from '@/components/search/VideoGrid';
import { useSourceBadges } from '@/lib/hooks/useSourceBadges';
import { useTypeBadges } from '@/lib/hooks/useTypeBadges';
import { useLanguageBadges } from '@/lib/hooks/useLanguageBadges';
import { Video, SourceBadge } from '@/lib/types';

interface SearchResultsProps {
    results: Video[];
    availableSources: SourceBadge[];
    loading: boolean;
    isPremium?: boolean;
    latencies?: Record<string, number>;
}

export function SearchResults({
    results,
    availableSources,
    loading,
    isPremium = false,
    latencies = {},
}: SearchResultsProps) {
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
        <div className="animate-fade-in">
            <ResultsHeader
                loading={loading}
                resultsCount={results.length}
                availableSources={availableSources}
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

            {/* Display filtered videos (type filter applied) */}
            <VideoGrid
                videos={finalFilteredVideos}
                isPremium={isPremium}
                latencies={latencies}
            />
        </div>
    );
}


