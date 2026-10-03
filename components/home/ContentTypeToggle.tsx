'use client';

export type ContentType = 'movie' | 'tv' | 'short';

interface ContentTypeToggleProps {
  value: ContentType;
  onChange: (value: ContentType) => void;
  /** 移动端搜索聚焦时折叠为单个当前选中胶囊，给搜索框让位 */
  collapsed?: boolean;
}

const OPTIONS: { key: ContentType; label: string }[] = [
  { key: 'movie', label: '电影' },
  { key: 'tv', label: '电视剧' },
  { key: 'short', label: '短剧' },
];

export function ContentTypeToggle({ value, onChange, collapsed = false }: ContentTypeToggleProps) {
  const activeIndex = OPTIONS.findIndex((o) => o.key === value);
  const activeLabel = OPTIONS[activeIndex]?.label ?? '电影';

  // 折叠态：只显示当前选中的小胶囊，点击可循环切换到下一个
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => {
          const next = OPTIONS[(activeIndex + 1) % OPTIONS.length];
          onChange(next.key);
        }}
        className="flex-shrink-0 h-12 px-3 rounded-full bg-[var(--accent-color)] text-white text-xs font-bold flex items-center justify-center cursor-pointer transition-all duration-200 active:scale-95"
        title={`当前：${activeLabel}，点击切换`}
      >
        {activeLabel}
      </button>
    );
  }

  return (
    <div className="relative box-border h-12 md:h-14 w-44 sm:w-60 p-0.5 flex-shrink-0 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-full grid grid-cols-3 backdrop-blur-2xl shadow-sm ring-1 ring-white/10 overflow-hidden">
      {/* Sliding indicator: one third of the inner track */}
      <div
        className="absolute top-0.5 bottom-0.5 bg-[var(--accent-color)] rounded-full transition-all duration-300 ease-out"
        style={{
          width: 'calc((100% - 4px) / 3)',
          left: `calc(2px + ${activeIndex} * (100% - 4px) / 3)`,
        }}
      />
      {OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`relative z-10 text-xs sm:text-sm font-bold transition-colors duration-300 cursor-pointer flex items-center justify-center ${
            value === opt.key ? 'text-white' : 'text-[var(--text-color-secondary)] hover:text-[var(--text-color)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
