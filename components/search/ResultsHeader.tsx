'use client';

import type { SourceBadge } from '@/lib/types';

interface ResultsHeaderProps {
  loading: boolean;
  resultsCount: number;
  availableSources: SourceBadge[];
  query?: string;
}

export function ResultsHeader({
  loading,
  resultsCount,
  availableSources,
  query,
}: ResultsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 mb-5 sm:mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-lg sm:text-2xl font-bold text-[var(--text-color)] leading-snug">
          {query ? (
            <>
              搜索“{query}”，{loading ? (
                '正在搜索相关影片…'
              ) : (
                <>
                  找到 <span className="text-[var(--accent-color)]">{resultsCount}</span> 部相关影片
                </>
              )}
            </>
          ) : (
            <span>搜索结果</span>
          )}
        </h3>
      </div>
    </div>
  );
}
