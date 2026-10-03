/**
 * SearchHistoryDropdown Component
 * Liquid Glass design system compliant dropdown for search history
 * Features: frosted glass effect, rounded-2xl corners, smooth animations
 */

'use client';

import { useEffect, useRef } from 'react';
import { Icons } from '@/components/ui/Icon';
import type { SearchHistoryItem } from '@/lib/store/search-history-store';
import { SearchHistoryHeader } from './SearchHistoryHeader';
import { SearchHistoryListItem } from './SearchHistoryListItem';

interface SearchHistoryDropdownProps {
  isOpen: boolean;
  searchHistory: SearchHistoryItem[];
  highlightedIndex: number;
  triggerRef: React.RefObject<HTMLInputElement | null>;
  onSelectItem: (query: string) => void;
  onRemoveItem: (query: string) => void;
  onClearAll: () => void;
}

/** 热门搜索词（无服务端统计时的静态推荐，可按需调整） */
const HOT_SEARCHES = [
  '变形金刚',
  '火影忍者',
  '复仇者联盟',
  '战狼',
  '红海行动',
  '流浪地球',
  '狂飙',
  '庆余年',
];

export function SearchHistoryDropdown({
  isOpen,
  searchHistory,
  highlightedIndex,
  triggerRef,
  onSelectItem,
  onRemoveItem,
  onClearAll,
}: SearchHistoryDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex === -1 || !dropdownRef.current) return;

    const highlightedElement = dropdownRef.current.querySelector(
      `[data-index="${highlightedIndex}"]`
    );

    if (highlightedElement) {
      highlightedElement.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [highlightedIndex]);

  if (!isOpen) {
    return null;
  }

  // 无搜索历史时展示「大家都在搜」热门推荐
  if (searchHistory.length === 0) {
    return (
      <div
        ref={dropdownRef}
        className="search-history-dropdown absolute top-full left-0 right-0 mt-2 z-[9999]"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="search-history-list px-3 py-3">
          <p className="text-xs font-semibold text-[var(--text-color-secondary)] mb-2 px-1">
            大家都在搜
          </p>
          <div className="flex flex-wrap gap-2">
            {HOT_SEARCHES.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => onSelectItem(term)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] text-sm text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--accent-color)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--accent-color)_40%,var(--glass-border))] transition-all duration-200 cursor-pointer"
              >
                <span className="text-red-500">🔥</span>
                {term}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dropdownRef}
      className="search-history-dropdown absolute top-full left-0 right-0 mt-2 z-[9999]"
      role="listbox"
      aria-label="搜索历史"
      onMouseDown={(e) => {
        // Prevent blur when clicking inside dropdown
        e.preventDefault();
      }}
    >
      {/* Header with clear all button */}
      <SearchHistoryHeader onClearAll={onClearAll} />

      {/* Divider */}
      <div className="search-history-divider" />

      {/* History items */}
      <div className="search-history-list">
        {searchHistory.map((item, index) => (
          <SearchHistoryListItem
            key={`${item.query}-${item.timestamp}`}
            item={item}
            index={index}
            isHighlighted={index === highlightedIndex}
            onSelectItem={onSelectItem}
            onRemoveItem={onRemoveItem}
          />
        ))}
      </div>
    </div>
  );
}
