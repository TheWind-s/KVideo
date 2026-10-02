'use client';

import { useSyncExternalStore } from 'react';

/**
 * useIsMobile —— 判断当前视口是否为手机宽度（<1024px）。
 *
 * 用于需要在手机端渲染与桌面/TV 完全不同布局（列表 vs 网格）的场景。
 * SSR 与首帧统一返回 false（先渲染桌面网格），hydration 后
 * useSyncExternalStore 会在绘制前同步为真实值，手机端切换为列表，
 * 既不会产生 hydration 不匹配，也几乎看不到闪烁。
 */
const MOBILE_QUERY = '(max-width: 1023px)';

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
