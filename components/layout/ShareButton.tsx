'use client';

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { siteConfig } from '@/lib/config/site-config';

/**
 * 导航栏分享按钮
 * --------------------------------
 * - App 内：通过原生桥 shareText 拉起系统分享面板（分享站点链接文案）
 * - 浏览器：优先 Web Share API，不支持则复制链接到剪贴板并提示
 */

interface AndroidShareBridge {
  shareText?: (text: string) => void;
}

declare global {
  interface Window {
    KVideoAndroid?: AndroidShareBridge;
  }
}

export function ShareButton() {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = window.location.origin;
    const text = `${siteConfig.name} - ${siteConfig.description}\n${url}`;

    // App 内：走原生系统分享
    if (typeof window.KVideoAndroid?.shareText === 'function') {
      try {
        window.KVideoAndroid.shareText(text);
        return;
      } catch {
        // 桥异常时走浏览器方案兜底
      }
    }

    // 浏览器：优先系统分享面板
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: siteConfig.name, text, url });
        return;
      } catch {
        // 用户取消分享不算失败，不再往下走复制
        return;
      }
    }

    // 兜底：复制链接到剪贴板
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('复制以下链接分享给好友：', url);
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      title="分享给好友"
      aria-label="分享"
      data-focusable
      className="relative w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-[var(--radius-full)] bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--accent-color)_10%,transparent)] transition-all duration-200 cursor-pointer"
    >
      {copied ? (
        <Check size={16} className="text-[var(--accent-color)] sm:w-5 sm:h-5" />
      ) : (
        <Share2 size={16} className="sm:w-5 sm:h-5" />
      )}
      {copied && (
        <span className="absolute top-full right-0 mt-2 px-2.5 py-1 rounded-lg bg-black/75 text-white text-xs whitespace-nowrap z-[3000]">
          链接已复制
        </span>
      )}
    </button>
  );
}
