import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSearchCache } from '@/lib/hooks/useSearchCache';
import { useParallelSearch } from '@/lib/hooks/useParallelSearch';
import { useSubscriptionSync } from '@/lib/hooks/useSubscriptionSync';
import { settingsStore, type SortOption } from '@/lib/store/settings-store';
import { userSourcesStore } from '@/lib/store/user-sources-store';

export function useHomePage() {
    useSubscriptionSync();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { loadFromCache, saveToCache } = useSearchCache();
    const hasLoadedCache = useRef(false);
    const hasSearchedWithSourcesRef = useRef(false);
    const isInitialCacheLoad = useRef(false);

    const [query, setQuery] = useState('');
    const [hasSearched, setHasSearched] = useState(false);
    const [currentSortBy, setCurrentSortBy] = useState<SortOption>('default');

    // URL 历史统一由 handleSearch 控制（用户搜索 push 一条、挂载恢复 replace）。
    // performSearch 不再更新 URL：否则搜索瞬间 push 与 replace 同地址会被
    // Next App Router 合并成 replace，导致物理返回键没有历史可退（直接退出 App）。
    const onUrlUpdate = useCallback((_q: string) => {
        // no-op：保留回调位以兼容 useParallelSearch 签名
    }, []);

    // Search stream hook
    const {
        loading,
        results,
        availableSources,
        completedSources,
        totalSources,
        performSearch,
        resetSearch,
        cancelSearch,
        loadCachedResults,
        applySorting,
        loadMore,
        hasMore,
        loadingMore,
    } = useParallelSearch(
        saveToCache,
        onUrlUpdate
    );

    // Core search execution function - extracted to eliminate duplication
    const executeSearch = useCallback((searchQuery: string) => {
        if (!searchQuery.trim()) return false;

        const settings = settingsStore.getSettings();
        const enabledSources = settings.sources.filter(s => s.enabled);

        // Merge user personal sources
        const userSources = userSourcesStore.getSources().filter(s => s.enabled !== false);
        const allSources = [...enabledSources];
        for (const us of userSources) {
            if (!allSources.find(s => s.id === us.id)) {
                allSources.push(us);
            }
        }

        if (allSources.length === 0) {
            return false;
        }

        performSearch(searchQuery, allSources, settings.sortBy);
        hasSearchedWithSourcesRef.current = true;
        return true;
    }, [performSearch]);

    // Re-sort results when sort preference changes
    useEffect(() => {
        // Skip re-sorting if this is a load from cache, to preserve the "remembered" position
        // Only re-sort if the user explicitly changes the sortBy option later
        if (hasSearched && results.length > 0 && !isInitialCacheLoad.current) {
            applySorting(currentSortBy);
        }
    }, [currentSortBy, applySorting, hasSearched, results.length]);

    // Load sort preference on mount and subscribe to changes
    useEffect(() => {
        const updateSettings = () => {
            const settings = settingsStore.getSettings();

            // Update sort preference
            if (settings.sortBy !== currentSortBy) {
                setCurrentSortBy(settings.sortBy);
            }

            // Check if we need to re-trigger search due to new sources being loaded
            // This fixes the issue where initial visit has 0 sources, then sources are loaded async
            // but the search (or lack thereof) is already stuck with empty sources.
            const enabledSources = settings.sources.filter(s => s.enabled);
            const hasSources = enabledSources.length > 0;

            // If we have a query, and we haven't searched with sources yet,
            // and we suddenly have sources, trigger the search.
            if (query && hasSources && !hasSearchedWithSourcesRef.current && !loading) {
                if (executeSearch(query)) {
                    setHasSearched(true);
                }
            }
        };

        // Initial load
        updateSettings();

        // Subscribe to changes
        const unsubscribe = settingsStore.subscribe(updateSettings);
        return () => unsubscribe();
    }, [query, loading, executeSearch, currentSortBy]);

    const handleSearch = useCallback((searchQuery: string) => {
        if (!searchQuery.trim()) return;

        // Clear scroll position for this search query to ensure we start at the top on a fresh search
        const scrollKey = `scroll-pos:/?q=${encodeURIComponent(searchQuery)}`;
        sessionStorage.removeItem(scrollKey);

        // Reset cache load flag for new search
        isInitialCacheLoad.current = false;

        // 用户主动搜索：写入一条新的历史记录，App 物理返回键 / 浏览器后退
        // 会先从搜索结果退回首页，而不是直接退出应用。
        // 若当前 URL 已等于目标（首次挂载带 ?q= 恢复），用 replace 避免重复历史。
        const targetUrl = `/?q=${encodeURIComponent(searchQuery)}`;
        if (window.location.pathname + window.location.search === targetUrl) {
            router.replace(targetUrl, { scroll: false });
        } else {
            router.push(targetUrl, { scroll: false });
        }

        setQuery(searchQuery);
        setHasSearched(true);
        executeSearch(searchQuery);
    }, [executeSearch, router]);

    // Load cached results on mount
    useEffect(() => {
        if (hasLoadedCache.current) return;
        hasLoadedCache.current = true;

        const urlQuery = searchParams.get('q');
        const cached = loadFromCache();

        if (urlQuery) {
            setQuery(urlQuery);
            if (cached && cached.query === urlQuery && cached.results.length > 0) {
                isInitialCacheLoad.current = true;
                setHasSearched(true);
                loadCachedResults(cached.results, cached.availableSources);
                hasSearchedWithSourcesRef.current = true;
            } else {
                handleSearch(urlQuery);
            }
        }
    }, [searchParams, loadFromCache, loadCachedResults, handleSearch]);



    const handleCancelSearch = useCallback(() => {
        cancelSearch();
    }, [cancelSearch]);

    const handleReset = useCallback(() => {
        // 在搜索结果页点 Logo：与物理返回键一致，退回上一条历史（首页），
        // popstate 监听负责清理搜索态；没有上一条（直接打开搜索链接）时本地复位。
        if (
            new URLSearchParams(window.location.search).has('q') &&
            window.history.length > 1
        ) {
            cancelSearch();
            window.history.back();
            return;
        }

        setHasSearched(false);
        setQuery('');
        hasSearchedWithSourcesRef.current = false;
        resetSearch();
        router.replace('/', { scroll: false });
    }, [resetSearch, router, cancelSearch]);

    // 浏览器/App 物理返回前进：仅 popstate 触发（router.push/replace 不会触发），
    // 按当前 URL 同步界面——退回首页则退出搜索态，退/进到某搜索则恢复结果。
    useEffect(() => {
        const handlePopState = () => {
            const urlQuery = new URLSearchParams(window.location.search).get('q');

            if (!urlQuery) {
                isInitialCacheLoad.current = false;
                hasSearchedWithSourcesRef.current = false;
                cancelSearch();
                setHasSearched(false);
                setQuery('');
                resetSearch();
                return;
            }

            // 恢复该搜索：优先本地缓存，无缓存则重新请求
            const cached = loadFromCache();
            setQuery(urlQuery);
            setHasSearched(true);
            if (cached && cached.query === urlQuery && cached.results.length > 0) {
                isInitialCacheLoad.current = true;
                loadCachedResults(cached.results, cached.availableSources);
                hasSearchedWithSourcesRef.current = true;
            } else {
                isInitialCacheLoad.current = false;
                executeSearch(urlQuery);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [cancelSearch, resetSearch, loadFromCache, loadCachedResults, executeSearch]);

    return {
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
        loadMore,
        hasMore,
        loadingMore,
    };
}
