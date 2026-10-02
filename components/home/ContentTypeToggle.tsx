'use client';

export type ContentType = 'movie' | 'tv' | 'short';

interface ContentTypeToggleProps {
  value: ContentType;
  onChange: (value: ContentType) => void;
}

const OPTIONS: { key: ContentType; label: string }[] = [
  { key: 'movie', label: '电影' },
  { key: 'tv', label: '电视剧' },
  { key: 'short', label: '短剧' },
];

export function ContentTypeToggle({ value, onChange }: ContentTypeToggleProps) {
  const activeIndex = OPTIONS.findIndex((o) => o.key === value);

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
