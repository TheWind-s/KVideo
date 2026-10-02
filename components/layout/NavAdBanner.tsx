'use client';

import { useEffect, useRef, useState } from 'react';
import { Megaphone } from 'lucide-react';

/**
 * 顶部广告/公告条（位于标题栏下方，独立于导航栏）
 * ----------------------------------------------------------
 * 想换广告内容时，只需修改下面的 ADS 数组：
 *   text ：广告文字（显示不全时自动横向滚动）
 *   link ：可选，点击后跳转的地址（站内如 '/iptv'，或外链）
 *   external：可选，true 表示外链（新标签页打开）
 * 留空数组 [] 则整个广告位不显示。
 *
 * 播放逻辑：
 *   - 文字显示不全 → 横向匀速滚动到末尾，停顿后纵向切换到下一条
 *   - 文字完整显示 → 停留 HOLD_MS 后纵向切换到下一条
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
  { id: 4, text: '扫码进群领淘宝京东官方大额优惠券，每日更新，一起省钱' },
];

const HOLD_MS = 4000;        // 文字完整显示时的停留时长
const SCROLL_SPEED = 30;     // 横向滚动速度（px/秒）
const SWITCH_MS = 500;       // 纵向切换动画时长
const MARQUEE_TAIL_GAP = 16; // 横向滚动结束后尾部额外留白（px）

export function NavAdBanner() {
  const [index, setIndex] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; duration: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  const current = ADS[index];
  const upcoming = ADS[(index + 1) % ADS.length];

  useEffect(() => {
    // 纵向切换动画进行中不安排新计划，切完由 index 变化重新触发
    if (switching) return;
    setMarquee(null);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;

    const schedule = () => {
      const viewport = viewportRef.current;
      const text = textRef.current;
      if (!viewport || !text || cancelled) return;

      // 文字超宽才横向滚动，滚完停顿一下再纵切；否则直接按停留时长纵切
      const overflow = text.scrollWidth - viewport.clientWidth;
      let wait: number;
      if (overflow > 4) {
        const duration = overflow / SCROLL_SPEED;
        setMarquee({ x: overflow + MARQUEE_TAIL_GAP, duration });
        wait = duration * 1000 + 600;
      } else {
        wait = HOLD_MS;
      }

      timer = setTimeout(() => {
        if (cancelled || ADS.length <= 1) return;
        setSwitching(true);
      }, wait);
    };

    // 等一帧让文字完成布局后再测量宽度
    raf = requestAnimationFrame(schedule);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [index, switching]);

  if (ADS.length === 0) return null;

  const textStyle = marquee
    ? ({
        '--marquee-x': `-${marquee.x}px`,
        animation: `ad-marquee ${marquee.duration}s linear forwards`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-3">
      <div
        className="relative w-full"
        role="marquee"
        aria-live="polite"
      >
        <div className="relative w-full h-9 flex items-center gap-2 px-3 rounded-full bg-[color-mix(in_srgb,var(--accent-color)_8%,var(--glass-bg))] border border-[var(--glass-border)] overflow-hidden">
          <span className="flex-shrink-0 flex items-center gap-1 text-[10px] sm:text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent-color)] text-white">
            <Megaphone size={11} />
            广告
          </span>

          {/* 文字视口：双行轨道，纵向平移实现上下切换 */}
          <div ref={viewportRef} className="relative flex-1 min-w-0 h-full overflow-hidden">
            <div
              className="flex flex-col h-[200%]"
              style={{
                transform: switching ? 'translateY(-50%)' : 'translateY(0)',
                transition: switching ? `transform ${SWITCH_MS}ms ease-in-out` : 'none',
              }}
              onTransitionEnd={() => {
                if (switching) {
                  setIndex((prev) => (prev + 1) % ADS.length);
                  setSwitching(false);
                }
              }}
            >
              <div className="h-1/2 flex items-center overflow-hidden">
                <span
                  ref={textRef}
                  className="whitespace-nowrap text-xs sm:text-sm font-medium text-[var(--text-color-secondary)]"
                  style={textStyle}
                >
                  {current.text}
                </span>
              </div>
              <div className="h-1/2 flex items-center overflow-hidden">
                <span className="whitespace-nowrap text-xs sm:text-sm font-medium text-[var(--text-color-secondary)]">
                  {upcoming.text}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 点击跳转覆盖层（保持稳定元素类型，避免轮播重建） */}
        {current.link && (
          <a
            href={current.link}
            {...(current.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="absolute inset-0 rounded-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
            aria-label={current.text}
            data-focusable
          />
        )}
      </div>
    </div>
  );
}
