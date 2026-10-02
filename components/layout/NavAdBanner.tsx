'use client';

import { useEffect, useRef, useState } from 'react';
import { Megaphone } from 'lucide-react';

/**
 * 导航栏广告/公告轮播条
 * ----------------------------------------------------------
 * 想换广告内容时，只需修改下面的 ADS 数组：
 *   text ：广告文字（建议 20 字以内，太长会自动省略号）
 *   link ：可选，点击后跳转的地址（站内如 '/iptv'，或外链）
 *   external：可选，true 表示外链（新标签页打开）
 * 留空数组 [] 则整个广告位不显示。
 */
interface AdItem {
  id: number;
  text: string;
  link?: string;
  external?: boolean;
}

const ADS: AdItem[] = [
  { id: 1, text: '海量影视免费观看，每日持续更新' },
  { id: 2, text: '支持手机、平板与 Android TV 大屏观影' },
  { id: 3, text: '搜索不到时，多换几个关键词试试吧' },
];

const ROTATE_INTERVAL = 4000;

export function NavAdBanner() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (paused || ADS.length <= 1) return;
    timerRef.current = setInterval(() => {
      setIndex((prev) => (prev + 1) % ADS.length);
    }, ROTATE_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused]);

  if (ADS.length === 0) return null;

  const current = ADS[index];

  return (
    <div className="flex-1 min-w-0 flex justify-start ml-1 sm:ml-3">
      <div
        className="relative w-full min-w-0"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div
          className="relative w-full h-8 sm:h-9 flex items-center gap-2 px-3 rounded-full bg-[color-mix(in_srgb,var(--accent-color)_8%,var(--glass-bg))] border border-[var(--glass-border)] overflow-hidden"
          aria-live="polite"
        >
          <span className="flex-shrink-0 flex items-center gap-1 text-[10px] sm:text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent-color)] text-white">
            <Megaphone size={11} />
            广告
          </span>

          <div className="relative flex-1 min-w-0 h-full">
            {ADS.map((ad, i) => (
              <span
                key={ad.id}
                className={`absolute inset-0 flex items-center text-xs sm:text-sm font-medium truncate transition-all duration-500 ${
                  i === index
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 -translate-y-2 pointer-events-none'
                } text-[var(--text-color-secondary)]`}
              >
                {ad.text}
              </span>
            ))}
          </div>
        </div>

        {/* Click overlay (stable element type across slides) */}
        {current.link && (
          <a
            href={current.link}
            {...(current.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="absolute inset-0 rounded-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
            aria-label={current.text}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            data-focusable
          />
        )}
      </div>
    </div>
  );
}
