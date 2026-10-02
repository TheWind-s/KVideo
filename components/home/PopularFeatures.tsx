/**
 * PopularFeatures - Main component for popular movies section
 * Displays Douban movie recommendations with tag filtering and infinite scroll.
 * Includes personalized "为你推荐" tag when user has 2+ watched items.
 */

'use client';

import { useState } from 'react';
import { TagManager } from './TagManager';
import { MovieGrid } from './MovieGrid';
import { Icons } from '@/components/ui/Icon';
import { useTagManager } from './hooks/useTagManager';
import { usePopularMovies } from './hooks/usePopularMovies';
import { usePersonalizedRecommendations } from './hooks/usePersonalizedRecommendations';

interface DoubanMovie {
  id: string;
  title: string;
  cover: string;
  rate: string;
  url: string;
}

interface PopularFeaturesProps {
  onSearch?: (query: string) => void;
}

export function PopularFeatures({ onSearch }: PopularFeaturesProps) {
  const {
    tags,
    selectedTag,
    contentType,
    newTagInput,
    showTagManager,
    justAddedTag,
    setContentType,
    setSelectedTag,
    setNewTagInput,
    setShowTagManager,
    setJustAddedTag,
    handleAddTag,
    handleDeleteTag,
    handleRestoreDefaults,
    handleDragEnd,
    isLoadingTags,
  } = useTagManager();

  const {
    movies: recommendMovies,
    loading: recommendLoading,
    hasMore: recommendHasMore,
    hasHistory,
    prefetchRef: recommendPrefetchRef,
    loadMoreRef: recommendLoadMoreRef,
  } = usePersonalizedRecommendations(false);

  const [isRecommendSelected, setIsRecommendSelected] = useState(false);

  const effectiveRecommendSelected = hasHistory && isRecommendSelected;
  const isTagManagementMode = showTagManager;

  const {
    movies,
    loading,
    hasMore,
    prefetchRef,
    loadMoreRef,
  } = usePopularMovies(
    effectiveRecommendSelected ? '' : selectedTag,
    tags,
    contentType
  );

  const handleMovieClick = (movie: DoubanMovie) => {
    if (onSearch) {
      onSearch(movie.title);
    }
  };

  const handleRecommendSelect = () => {
    setIsRecommendSelected(true);
  };

  const handleRegularTagSelect = (tagId: string) => {
    if (tagId === 'custom_高级' || tags.find(t => t.id === tagId)?.label === '高级') {
      window.location.href = '/premium';
      return;
    }
    setIsRecommendSelected(false);
    setSelectedTag(tagId);
  };

  return (
    <div className="animate-fade-in">
      {/* Content Type Toggle + Tag Management (one compact row) */}
      {!isTagManagementMode && !effectiveRecommendSelected && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="relative w-44 sm:w-52 p-0.5 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-full grid grid-cols-2 backdrop-blur-2xl shadow-sm ring-1 ring-white/10 overflow-hidden flex-shrink-0">
            {/* Sliding Indicator */}
            <div
              className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-[var(--accent-color)] rounded-full transition-transform duration-400 cubic-bezier(0.4, 0, 0.2, 1) shadow-[0_0_12px_rgba(0,122,255,0.35)]"
              style={{
                transform: `translateX(${contentType === 'movie' ? '2px' : 'calc(100% + 2px)'})`,
              }}
            />

            <button
              onClick={() => setContentType('movie')}
              className={`relative z-10 py-1.5 text-xs sm:text-[13px] font-bold transition-colors duration-300 cursor-pointer flex justify-center items-center ${contentType === 'movie' ? 'text-white' : 'text-[var(--text-color-secondary)] hover:text-[var(--text-color)]'
                }`}
            >
              电影
            </button>
            <button
              onClick={() => setContentType('tv')}
              className={`relative z-10 py-1.5 text-xs sm:text-[13px] font-bold transition-colors duration-300 cursor-pointer flex justify-center items-center ${contentType === 'tv' ? 'text-white' : 'text-[var(--text-color-secondary)] hover:text-[var(--text-color)]'
                }`}
            >
              电视剧
            </button>
          </div>
          <button
            onClick={() => setShowTagManager(!showTagManager)}
            className="text-xs sm:text-sm text-[var(--text-color-secondary)] hover:text-[var(--accent-color)] transition-colors flex items-center gap-1.5 cursor-pointer flex-shrink-0"
          >
            <Icons.Tag size={14} />
            管理标签
          </button>
        </div>
      )}

      <TagManager
        tags={tags}
        selectedTag={effectiveRecommendSelected ? '' : selectedTag}
        showTagManager={showTagManager}
        newTagInput={newTagInput}
        justAddedTag={justAddedTag}
        hideManagementRow={!isTagManagementMode && !effectiveRecommendSelected}
        onTagSelect={handleRegularTagSelect}
        onTagDelete={handleDeleteTag}
        onToggleManager={() => setShowTagManager(!showTagManager)}
        onRestoreDefaults={handleRestoreDefaults}
        onNewTagInputChange={setNewTagInput}
        onAddTag={handleAddTag}
        onDragEnd={handleDragEnd}
        onJustAddedTagHandled={() => setJustAddedTag(false)}
        isLoadingTags={isLoadingTags}
        recommendTag={hasHistory ? {
          label: '为你推荐',
          isSelected: effectiveRecommendSelected,
          onSelect: handleRecommendSelect,
        } : undefined}
      />

      {!isTagManagementMode && (
        effectiveRecommendSelected ? (
          <MovieGrid
            movies={recommendMovies}
            loading={recommendLoading}
            hasMore={recommendHasMore}
            onMovieClick={handleMovieClick}
            prefetchRef={recommendPrefetchRef}
            loadMoreRef={recommendLoadMoreRef}
          />
        ) : (
          <MovieGrid
            movies={movies}
            loading={loading}
            hasMore={hasMore}
            onMovieClick={handleMovieClick}
            prefetchRef={prefetchRef}
            loadMoreRef={loadMoreRef}
          />
        )
      )}
    </div>
  );
}
