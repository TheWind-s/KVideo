'use client';

export type ContentType = 'movie' | 'tv';

interface ContentTypeToggleProps {
  value: ContentType;
  onChange: (value: ContentType) => void;
}

export function ContentTypeToggle({ value, onChange }: ContentTypeToggleProps) {
  return (
    <div className="relative box-border h-12 md:h-14 w-28 sm:w-44 p-0.5 flex-shrink-0 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-full grid grid-cols-2 backdrop-blur-2xl shadow-sm ring-1 ring-white/10 overflow-hidden">
      {/* Sliding indicator */}
      <div
        className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-[var(--accent-color)] rounded-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(${value === 'movie' ? '2px' : 'calc(100% + 2px)'})` }}
      />
      <button
        type="button"
        onClick={() => onChange('movie')}
        className={`relative z-10 text-xs sm:text-sm font-bold transition-colors duration-300 cursor-pointer flex items-center justify-center ${
          value === 'movie' ? 'text-white' : 'text-[var(--text-color-secondary)] hover:text-[var(--text-color)]'
        }`}
      >
        电影
      </button>
      <button
        type="button"
        onClick={() => onChange('tv')}
        className={`relative z-10 text-xs sm:text-sm font-bold transition-colors duration-300 cursor-pointer flex items-center justify-center ${
          value === 'tv' ? 'text-white' : 'text-[var(--text-color-secondary)] hover:text-[var(--text-color)]'
        }`}
      >
        电视剧
      </button>
    </div>
  );
}
