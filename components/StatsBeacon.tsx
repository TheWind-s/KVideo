'use client';

import { useEffect } from 'react';

/**
 * 访问统计上报：每个浏览器会话一次（sessionStorage 去重），
 * 统计页本身不计入。sendBeacon 在页面关闭阶段也能发出请求。
 */
export function StatsBeacon() {
  useEffect(() => {
    if (window.location.pathname.startsWith('/stats')) return;
    try {
      if (window.sessionStorage.getItem('kvideo_visit_counted')) return;
      window.sessionStorage.setItem('kvideo_visit_counted', '1');
      navigator.sendBeacon('/api/stats/visit');
    } catch {
      // 隐私模式 / 存储不可用时直接忽略
    }
  }, []);

  return null;
}
