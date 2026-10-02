/**
 * PopularFeatures - Main component for popular movies section
 * Displays Douban movie recommendations with tag filtering and infinite scroll.
 * Includes personalized "为你推荐" tag when user has 2+ watched items.
 */

'use client';

import { useState, useEffect } from 'react';
import { TagManager } from './TagManager';
import { MovieGrid } from './MovieGrid';
import { useTagManager } from './hooks/useTagManager';
import { usePopularMovies } from './hooks/usePopularMovies';
import { usePersonalizedRecommendations } from './hooks/usePersonalizedRecommendations';
import type { ContentType } from './ContentTypeToggle';

interface DoubanMovie {
  id: string;
  title: string;
  cover: string;
  rate: string;
  url: string;
}

interface PopularFeaturesProps {
  onSearch?: (query: string) => void;
  contentType: ContentType;
  onContentTypeChange: (value: ContentType) => void;
}

export function PopularFeatures({ onSearch, contentType, onContentTypeChange }: PopularFeaturesProps) {
  const {
    tags,
    selectedTag,
    newTagInput,
    showTagManager,
    justAddedTag,
    setSelectedTag,
    setNewTagInput,
    setShowTagManager,
    setJustAddedTag,
    handleAddTag,
    handleDeleteTag,
    handleRestoreDefaults,
    handleDragEnd,
    isLoadingTags,
  } = useTagManager({ contentType, setContentType: onContentTypeChange });

  const {
    movies: recommendMovies,
    loading: recommendLoading,
    hasMore: recommendHasMore,
    hasHistory,
    prefetchRef: recommendPrefetchRef,
    loadMoreRef: recommendLoadMoreRef,
  } = usePersonalizedRecommendations(false);

  const [isRecommendSelected, setIsRecommendSelected] = useState(false);

  // Leaving "for you" mode whenever the movie/TV type changes
  useEffect(() => {
    setIsRecommendSelected(false);
  }, [contentType]);

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
      {/* 手机端主内容区无边距，标签行保留左右内边距 */}
      <div className="px-4 sm:px-0">
        <TagManager
        tags={tags}
        selectedTag={effectiveRecommendSelected ? '' : selectedTag}
        showTagManager={showTagManager}
        newTagInput={newTagInput}
        justAddedTag={justAddedTag}
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
      </div>

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
