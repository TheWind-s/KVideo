'use client';

import { Suspense, useMemo, useState } from 'react';
import { SearchForm } from '@/components/search/SearchForm';
import { NoResults } from '@/components/search/NoResults';
import { PopularFeatures } from '@/components/home/PopularFeatures';
import { ShortDramaSection } from '@/components/home/ShortDramaSection';
import { HeroCarousel } from '@/components/home/HeroCarousel';
import { ContentTypeToggle, type ContentType } from '@/components/home/ContentTypeToggle';
import { FavoritesSidebar } from '@/components/favorites/FavoritesSidebar';
import { Navbar } from '@/components/layout/Navbar';
import { NavAdBanner } from '@/components/layout/NavAdBanner';
import { SearchResults } from '@/components/home/SearchResults';
import { useHomePage } from '@/lib/hooks/useHomePage';
import { useLatencyPing } from '@/lib/hooks/useLatencyPing';

function HomePage() {
  const {
    query,
    hasSearched,
    loading,
    results,
    availableSources,
    completedSources,
    totalSources,
    handleSearch,
    handleReset,
    handleCancelSearch,
  } = useHomePage();

  // 电影 / 电视剧 / 短剧 选择器 —— 提升到页面层以便与搜索框共用同一行
  const [contentType, setContentType] = useState<ContentType>(() => {
    if (typeof window === 'undefined') return 'movie';
    const saved = localStorage.getItem('kvideo_default_content_type');
    return saved === 'tv' || saved === 'short' ? saved : 'movie';
  });

  // Real-time latency pinging
  const sourceUrls = useMemo(() =>
    availableSources.flatMap((source) =>
      source.baseUrl ? [{ id: source.id, baseUrl: source.baseUrl }] : []
    ),
    [availableSources]
  );

  const { latencies } = useLatencyPing({
    sourceUrls,
    enabled: hasSearched && results.length > 0,
  });

  return (
    <div className="min-h-screen">
      {/* Glass Navbar */}
      <Navbar onReset={handleReset} />

      {/* 顶部广告条 —— 标题栏下方，文字超宽自动横向滚动 */}
      <NavAdBanner />

      {/* Hero Banner - top of the page（手机端左右无留白、通屏展示；桌面/TV 保持边距与圆角） */}
      {!hasSearched && (
        <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 mt-2 sm:mt-4 mb-4 sm:mb-6">
          <HeroCarousel />
        </div>
      )}

      {/* Search Form + Movie/TV Toggle - same row（搜索后折叠类型切换器，搜索栏独占整行） */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6 sm:mb-8">
        <div className="flex items-center gap-2 sm:gap-4">
          {!hasSearched && (
            <ContentTypeToggle value={contentType} onChange={setContentType} />
          )}
          <SearchForm
            inline
            onSearch={handleSearch}
            onClear={handleReset}
            onCancelSearch={handleCancelSearch}
            isLoading={loading}
            initialQuery={query}
            currentSource=""
            checkedSources={completedSources}
            totalSources={totalSources}
          />
        </div>
      </div>

      {/* Main Content（手机端封面网格通屏无左右边距；各区块内部自行保留需要的内边距） */}
      <main className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pb-20">
        {/* Results Section */}
        {(results.length >= 1 || (!loading && results.length > 0)) && (
          <SearchResults
            results={results}
            availableSources={availableSources}
            loading={loading}
            query={query}
            latencies={latencies}
          />
        )}

        {/* Popular Features - Homepage */}
        {!loading && !hasSearched && (
          contentType === 'short' ? (
            <ShortDramaSection />
          ) : (
            <PopularFeatures
              onSearch={handleSearch}
              contentType={contentType}
              onContentTypeChange={setContentType}
            />
          )
        )}

        {/* No Results */}
        {!loading && hasSearched && results.length === 0 && (
          <NoResults onReset={handleReset} />
        )}
      </main>

      {/* Favorites Sidebar - Left */}
      <FavoritesSidebar />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-[var(--accent-color)] border-t-transparent"></div>
      </div>
    }>
      <HomePage />
    </Suspense>
  );
}
