/**
 * TypeBadges - Main component for type badge filtering
 * Auto-collects unique type_name values and shows counts
 * Badges disappear when all videos of that type are removed
 * Responsive: Desktop shows expand/collapse, Mobile shows horizontal scroll
 *
 * 默认整体收起，点击标题行展开；展开状态本地记忆。
 */

'use client';

import { memo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Icons } from '@/components/ui/Icon';
import { TypeBadgeList } from './TypeBadgeList';
import type { TypeBadge } from '@/lib/types';

const COLLAPSE_KEY = 'kvideo_type_badges_collapsed';

interface TypeBadgesProps {
  badges: TypeBadge[];
  selectedTypes: Set<string>;
  onToggleType: (type: string) => void;
  className?: string;
}

export const TypeBadges = memo(function TypeBadges({
  badges,
  selectedTypes,
  onToggleType,
  className = ''
}: TypeBadgesProps) {
  // 默认收起；本地存储仅记录"用户主动展开过"
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(COLLAPSE_KEY) !== 'false';
  });

  if (badges.length === 0) {
    return null;
  }

  const handleClearAll = () => {
    selectedTypes.forEach(type => onToggleType(type));
  };

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, String(next));
      return next;
    });
  };

  return (
    <Card
      hover={false}
      className={`p-4 animate-fade-in bg-[var(--bg-color)]/50 backdrop-blur-none saturate-100 shadow-sm border-[var(--glass-border)] ${className}`}
    >
      {/* 标题行即折叠开关 */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!isCollapsed}
        className="w-full flex items-center gap-2 text-left cursor-pointer focus:outline-none"
      >
        <Icons.Tag size={16} className="text-[var(--accent-color)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--text-color)]">
          分类标签 ({badges.length})
        </span>
        {selectedTypes.size > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--accent-color)_12%,transparent)] text-[var(--accent-color)] font-medium">
            已选 {selectedTypes.size}
          </span>
        )}
        <Icons.ChevronDown
          size={16}
          className={`ml-auto shrink-0 text-[var(--text-color-secondary)] transition-transform duration-300 ${isCollapsed ? '-rotate-90' : ''}`}
        />
      </button>

      {!isCollapsed && (
        <>
          <div className="flex items-center md:items-start gap-3 mt-3">
            <TypeBadgeList
              badges={badges}
              selectedTypes={selectedTypes}
              onToggleType={onToggleType}
            />
          </div>

          {selectedTypes.size > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--glass-border)]">
              <button
                onClick={handleClearAll}
                className="text-xs text-[var(--text-color-secondary)] hover:text-[var(--accent-color)]
                         flex items-center gap-1 transition-colors"
              >
                <Icons.X size={12} />
                清除筛选 ({selectedTypes.size})
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
});
