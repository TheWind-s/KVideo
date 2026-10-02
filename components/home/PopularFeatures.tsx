/**
 * PopularFeatures - Main component for popular movies section
 * Displays Douban movie recommendations with tag filtering and infinite scroll.
 * Includes personalized "为你推荐" tag when user has 2+ watched items.
 */

'use client';

import { useState, useEffect } from 'react';
import { TagManager } from './TagManager';
import { MovieGrid } from './MovieGrid';
import { VideoGrid } from '@/components/search/VideoGrid';
import { Icons } from '@/components/ui/Icon';
import { useTagManager } from './hooks/useTagManager';
import { usePopularMovies } from './hooks/usePopularMovies';
import { usePersonalizedRecommendations } from './hooks/usePersonalizedRecommendations';
import { useShortDramas } from './hooks/useShortDramas';
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

// 豆瓣不提供短剧标签/推荐，改用该关键词并行搜索各视频源聚合短剧内容
const SHORT_DRAMA_KEYWORD = '短剧';

export function PopularFeatures({ onSearch, contentType, onContentTypeChange }: PopularFeaturesProps) {
  // 短剧：复用首页并行搜索，直接聚合视频源结果
  const { results: shortResults, loading: shortLoading } = useShortDramas(SHORT_DRAMA_KEYWORD);
  const isShort = contentType === 'short';

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

  // 短剧模式：隐藏豆瓣标签行，直接以搜索结果网格展示各视频源聚合的短剧
  if (isShort) {
    return (
      <div className="animate-fade-in">
        {shortLoading && shortResults.length === 0 ? (
          <div className="flex justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--accent-color)] border-t-transparent"></div>
              <p className="text-sm text-[var(--text-color-secondary)]">正在从各视频源加载短剧...</p>
            </div>
          </div>
        ) : shortResults.length === 0 ? (
          <div className="text-center py-20">
            <Icons.Film size={64} className="text-[var(--text-color-secondary)] mx-auto mb-4" />
            <p className="text-[var(--text-color-secondary)]">暂未找到短剧资源，请稍后重试</p>
          </div>
        ) : (
          <>
            <VideoGrid videos={shortResults} />
            {shortLoading && (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-[var(--accent-color)] border-t-transparent"></div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
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
