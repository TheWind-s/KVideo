'use client';

import { Suspense, useMemo, useState } from 'react';
import { SearchForm } from '@/components/search/SearchForm';
import { NoResults } from '@/components/search/NoResults';
import { PopularFeatures } from '@/components/home/PopularFeatures';
import { HeroCarousel } from '@/components/home/HeroCarousel';
import { ContentTypeToggle, type ContentType } from '@/components/home/ContentTypeToggle';
import { FavoritesSidebar } from '@/components/favorites/FavoritesSidebar';
import { Navbar } from '@/components/layout/Navbar';
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

  // Movie / TV selector — lifted here so it can share the search row
  const [contentType, setContentType] = useState<ContentType>(() => {
    if (typeof window === 'undefined') return 'movie';
    return localStorage.getItem('kvideo_default_content_type') === 'tv' ? 'tv' : 'movie';
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

      {/* Hero Banner - top of the page */}
      {!hasSearched && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 mb-6">
          <HeroCarousel />
        </div>
      )}

      {/* Search Form + Movie/TV Toggle - same row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6 sm:mb-8">
        <div className="flex items-center gap-2 sm:gap-4">
          <ContentTypeToggle value={contentType} onChange={setContentType} />
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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        {/* Results Section */}
        {(results.length >= 1 || (!loading && results.length > 0)) && (
          <SearchResults
            results={results}
            availableSources={availableSources}
            loading={loading}
            latencies={latencies}
          />
        )}

        {/* Popular Features - Homepage */}
        {!loading && !hasSearched && (
          <>
            <PopularFeatures
              onSearch={handleSearch}
              contentType={contentType}
              onContentTypeChange={setContentType}
            />
          </>
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
