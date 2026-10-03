'use client';

/**
 * VideoListView —— 手机端搜索结果竖向列表
 *
 * 与桌面/TV 的 VideoGrid 对应：每条结果一整行卡片，
 * 左侧竖版封面，右侧标题 / 年份地区类型 / 演员，
 * 底部「播放」「详情」按钮（详情直达播放页"简介"标签）。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Icons } from '@/components/ui/Icon';
import { LatencyBadge } from '@/components/ui/LatencyBadge';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';
import { Video } from '@/lib/types';
import { htmlToText } from '@/lib/utils/html';
import { parseVideoTitle } from '@/lib/utils/video';
import { useResolutionProbe, type ResolutionInfo } from '@/lib/hooks/useResolutionProbe';

interface VideoListViewProps {
  videos: Video[];
  isPremium?: boolean;
  latencies?: Record<string, number>;
}

const PAGE_SIZE = 12;

function buildPlayerUrl(video: Video, index: number, isPremium: boolean, tab?: 'info') {
  const params: Record<string, string> = {
    id: String(video.vod_id),
    source: video.source,
    title: video.vod_name,
  };
  if (isPremium) params.premium = '1';
  if (tab) params.tab = tab;
  return `/player?${new URLSearchParams(params).toString()}`;
}

/** 取 type_name 的第一个分类做角标（如"剧情,战争"→"剧情"） */
function firstType(typeName?: string): string {
  if (!typeName) return '';
  return typeName.split(/[,，/]/).map((s) => s.trim()).filter(Boolean)[0] ?? '';
}

const VideoListRow = memo(function VideoListRow({
  video,
  index,
  isPremium,
  latency,
  resolution,
  isProbing,
}: {
  video: Video;
  index: number;
  isPremium: boolean;
  latency?: number;
  resolution?: ResolutionInfo | null;
  isProbing?: boolean;
}) {
  const { cleanTitle } = parseVideoTitle(video.vod_name);
  const playUrl = buildPlayerUrl(video, index, isPremium);
  const detailUrl = buildPlayerUrl(video, index, isPremium, 'info');
  const typeBadge = firstType(video.type_name);
  const remarks = htmlToText(video.vod_remarks);

  // 年份 / 地区 / 完整类型，按参考图拼成一行
  const metaParts: string[] = [];
  if (video.vod_year) metaParts.push(video.vod_year);
  const areaAndGenres = [video.vod_area, video.type_name].filter(Boolean).join(' ');
  if (areaAndGenres) metaParts.push(areaAndGenres);

  return (
    <div className="relative flex gap-3 p-2.5 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-sm">
      {/* 左侧封面（固定宽度 2:3，点击直接播放） */}
      <Link
        href={playUrl}
        prefetch={false}
        data-focusable
        aria-label={`播放${video.vod_name}`}
        className="relative flex-shrink-0 w-[104px] aspect-[2/3] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--glass-bg)_50%,transparent)]"
      >
        {video.vod_pic ? (
          <Image
            src={video.vod_pic}
            alt={video.vod_name}
            fill
            sizes="104px"
            className="object-cover"
            loading={index < 6 ? 'eager' : 'lazy'}
            unoptimized
            referrerPolicy="no-referrer"
            onError={(e) => {
              const target = e.currentTarget as HTMLImageElement;
              if (target.dataset.fallback === '1') {
                target.style.opacity = '0';
                return;
              }
              target.dataset.fallback = '1';
              target.src = '/placeholder-poster.svg';
            }}
          />
        ) : (
          <Image
            src="/placeholder-poster.svg"
            alt={video.vod_name}
            fill
            sizes="104px"
            className="object-cover"
            unoptimized
          />
        )}
        {/* 收藏按钮：封面右上角，手机端常驻显示 */}
        <div className="absolute top-1.5 right-1.5 z-20">
          <FavoriteButton
            videoId={video.vod_id}
            source={video.source}
            title={video.vod_name}
            poster={video.vod_pic}
            sourceName={video.sourceName}
            type={video.type_name}
            year={video.vod_year}
            remarks={video.vod_remarks}
            size={15}
            isPremium={isPremium}
            className="shadow-md"
          />
        </div>
      </Link>

      {/* 右侧信息 */}
      <div className="flex-1 min-w-0 flex flex-col py-0.5">
        {/* 标题行：标题 + 右上角标 */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-base font-bold text-[var(--accent-color)] leading-snug line-clamp-2 break-all">
            {cleanTitle}
          </h4>
          {typeBadge && (
            <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--accent-color)_10%,transparent)] text-[var(--accent-color)] font-medium">
              {typeBadge}
            </span>
          )}
        </div>

        {/* 年份 / 地区 / 类型 */}
        {metaParts.length > 0 && (
          <p className="mt-1.5 text-xs text-[var(--text-color-secondary)] leading-relaxed line-clamp-1">
            {metaParts.join('  /  ')}
          </p>
        )}

        {/* 演员 */}
        {video.vod_actor && (
          <p className="mt-1 text-xs text-[var(--text-color-secondary)] leading-relaxed line-clamp-1">
            {video.vod_actor}
          </p>
        )}

        {/* 备注（HD / 更新至 / 完结 等） */}
        {remarks && (
          <p className="mt-1 text-[11px] text-[var(--text-color-secondary)] opacity-80 line-clamp-1">
            {remarks}
          </p>
        )}

        {/* 画质 + 延迟标签（与桌面网格一致：画质来自分辨率探测，延迟来自源测速） */}
        {(resolution || isProbing || latency !== undefined) && (
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {resolution ? (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${resolution.color}`}
              >
                {resolution.label}
              </span>
            ) : isProbing ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-white/50 bg-gray-500/50 animate-pulse">
                ...
              </span>
            ) : null}
            {latency !== undefined && <LatencyBadge latency={latency} className="flex-shrink-0" />}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mt-auto pt-2 flex items-center gap-2.5">
          <Link
            href={playUrl}
            prefetch={false}
            data-focusable
            className="inline-flex items-center gap-1.5 h-9 px-5 rounded-full bg-[var(--accent-color)] text-white text-sm font-medium active:brightness-95 transition"
          >
            <Icons.Play size={15} />
            播放
          </Link>
          <Link
            href={detailUrl}
            prefetch={false}
            data-focusable
            className="inline-flex items-center h-9 px-5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-color)] text-sm font-medium active:brightness-95 transition"
          >
            详情
          </Link>
        </div>
      </div>
    </div>
  );
});

function VideoListSkeleton() {
  return (
    <div className="flex gap-3 p-2.5 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] animate-pulse">
      <div className="flex-shrink-0 w-[104px] aspect-[2/3] rounded-xl bg-[color-mix(in_srgb,var(--text-color)_8%,transparent)]" />
      <div className="flex-1 flex flex-col gap-2 py-1">
        <div className="h-4 w-2/3 rounded bg-[color-mix(in_srgb,var(--text-color)_8%,transparent)]" />
        <div className="h-3 w-full rounded bg-[color-mix(in_srgb,var(--text-color)_6%,transparent)]" />
        <div className="h-3 w-5/6 rounded bg-[color-mix(in_srgb,var(--text-color)_6%,transparent)]" />
        <div className="mt-auto flex gap-2.5">
          <div className="h-9 w-20 rounded-full bg-[color-mix(in_srgb,var(--accent-color)_24%,transparent)]" />
          <div className="h-9 w-20 rounded-full bg-[color-mix(in_srgb,var(--text-color)_8%,transparent)]" />
        </div>
      </div>
    </div>
  );
}

export const VideoListView = memo(function VideoListView({
  videos,
  isPremium = false,
  latencies = {},
}: VideoListViewProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // 新搜索（首条结果变化）时分页重置；SSE 流式追加期间首条稳定，不会反复重置
  const firstKey = videos[0] ? `${videos[0].source}:${videos[0].vod_id}` : '';
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [firstKey]);

  const visibleVideos = useMemo(() => videos.slice(0, visibleCount), [videos, visibleCount]);

  // 分辨率探测列表：SSE 流式追加期间 results 数组持续变化，若直接跟随会导致
  // 探测请求被反复中止重发。这里按"可见行 id 集合"稳定化，并防抖 600ms，
  // 等结果流平息后只发起一次探测（翻页新增行时自然再触发）。
  const visibleKey = visibleVideos.map((v) => `${v.source}:${v.vod_id}`).join('|');
  const [settledKey, setSettledKey] = useState(visibleKey);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(visibleKey), 600);
    return () => clearTimeout(timer);
  }, [visibleKey]);

  const probeList = useMemo(() => {
    if (!settledKey) return [];
    const wanted = new Set(settledKey.split('|'));
    return visibleVideos
      .filter((v) => wanted.has(`${v.source}:${v.vod_id}`))
      .map((v) => ({ id: String(v.vod_id), source: v.source }));
    // settledKey 变化后从最新 visibleVideos 取，避免探测过期行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey, videos, visibleCount]);
  const { resolutions, isProbing } = useResolutionProbe(probeList);

  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (node) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            setLoadingMore(true);
            setVisibleCount((prev) => prev + PAGE_SIZE);
            // 一帧后关闭 loading 态，避免闪烁
            requestAnimationFrame(() => setLoadingMore(false));
          }
        },
        { rootMargin: '400px' }
      );
      observerRef.current.observe(node);
    }
  }, []);

  return (
    <div role="list" aria-label="视频搜索结果">
      <div className="flex flex-col gap-3">
        {visibleVideos.map((video, index) => {
          const resolution = resolutions[`${video.source}:${video.vod_id}`];
          return (
            <VideoListRow
              key={`${video.vod_id}-${index}`}
              video={video}
              index={index}
              isPremium={isPremium}
              latency={latencies[video.source] ?? video.latency}
              resolution={resolution}
              isProbing={isProbing && !resolution}
            />
          );
        })}
      </div>

      {visibleCount < videos.length && (
        <div ref={loadMoreRef} className="h-20 w-full flex items-center justify-center">
          {loadingMore && (
            <div className="w-6 h-6 rounded-full border-2 border-[var(--accent-color)] border-t-transparent animate-spin" />
          )}
        </div>
      )}
    </div>
  );
});
