'use client';

import { useEffect, useState } from 'react';
import { Download, Check, RefreshCw } from 'lucide-react';

/**
 * 导航栏右侧的 APK 下载 / 更新按钮
 * --------------------------------
 * - 浏览器访问：显示「下载APP」，点击直接下载站点托管的 APK
 * - 洋芋影视 App 内访问：读取原生桥提供的已装 versionCode，与
 *   /apk/release.json 对比：有新版 → 高亮「更新 vX.Y.Z」，点击交给
 *   原生 DownloadManager 下载并拉起安装；已是最新 → 低调版本胶囊
 *
 * 发布新版 APK 时只需：
 *   1) 把新 APK 放到 public/apk/ 并更新 release.json 的 versionCode/url
 *   2) git push，Cloudflare 部署后所有已装 App 自动出现更新提示
 */

interface ApkReleaseManifest {
  versionName: string;
  versionCode: number;
  url: string;
  publishedAt?: string;
  notes?: string[];
}

interface AndroidBridge {
  getAppVersionCode?: () => number;
  getAppVersionName?: () => string;
  downloadUpdate?: (url: string) => void;
}

declare global {
  interface Window {
    KVideoAndroid?: AndroidBridge;
  }
}

type UpdateState = 'browser' | 'checking' | 'latest' | 'update';

/** Android WebView 的 UA 带有 "; wv)" 标记；旧版 App 壳无 JS 桥也无下载监听，点下载链接会被静默吞掉 */
function isBridgelessWebView(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /; wv\)/.test(navigator.userAgent) && typeof window.KVideoAndroid?.downloadUpdate !== 'function';
}

export function ApkDownloadButton() {
  const [manifest, setManifest] = useState<ApkReleaseManifest | null>(null);
  const [state, setState] = useState<UpdateState>('checking');
  const [downloading, setDownloading] = useState(false);
  const [legacyHint, setLegacyHint] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const bridge = typeof window !== 'undefined' ? window.KVideoAndroid : undefined;
    const inApp = typeof bridge?.getAppVersionCode === 'function';

    fetch('/apk/release.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ApkReleaseManifest | null) => {
        if (cancelled || !data || !data.url) return;
        setManifest(data);

        if (!inApp) {
          setState('browser');
          return;
        }

        try {
          const installed = Number(bridge?.getAppVersionCode?.() ?? 0);
          setState(installed < data.versionCode ? 'update' : 'latest');
        } catch {
          setState('latest');
        }
      })
      .catch(() => {
        // 清单获取失败：浏览器仍允许通过固定地址下载，App 内则静默隐藏
        if (!cancelled && !inApp) setState('browser');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking') return null;

  const apkUrl = manifest
    ? new URL(manifest.url, window.location.origin).toString()
    : `${window.location.origin}/apk/kvideo-1.0.7.apk`;
  const notesText = manifest?.notes?.length ? `\n\n${manifest.notes.map((n) => `· ${n}`).join('\n')}` : '';

  // 浏览器：普通下载链接；旧版 App 壳（无桥 WebView）则提示改用系统浏览器下载
  if (state === 'browser') {
    return (
      <span className="relative inline-flex">
        <a
          href={apkUrl}
          download="洋芋影视.apk"
          title="下载洋芋影视 Android 安装包"
          data-focusable
          onClick={(e) => {
            if (!isBridgelessWebView()) return;
            e.preventDefault();
            setLegacyHint(true);
            setTimeout(() => setLegacyHint(false), 6000);
          }}
          className="inline-flex h-8 sm:h-10 items-center justify-center gap-1.5 px-2.5 sm:px-4 rounded-[var(--radius-full)] border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-color)] text-xs sm:text-sm font-medium hover:bg-[color-mix(in_srgb,var(--accent-color)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--accent-color)_40%,var(--glass-border))] transition-all duration-200 cursor-pointer whitespace-nowrap"
        >
          <Download size={16} className="sm:w-[18px] sm:h-[18px]" />
          <span>下载APP</span>
        </a>
        {legacyHint && (
          <span className="absolute top-full right-0 mt-2 w-56 p-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--shadow-md)] text-xs leading-5 text-[var(--text-color)] z-[3000]">
            当前 App 版本过旧，无法直接下载。请用手机浏览器打开本站，点「下载APP」安装新版；之后就能在 App 内一键更新。
          </span>
        )}
      </span>
    );
  }

  // App 内有更新：高亮胶囊，点击走原生下载安装
  if (state === 'update' && manifest) {
    return (
      <button
        type="button"
        title={`发现新版本 v${manifest.versionName}，点击下载更新${notesText}`}
        data-focusable
        disabled={downloading}
        onClick={() => {
          try {
            window.KVideoAndroid?.downloadUpdate?.(apkUrl);
            setDownloading(true);
            // 按钮态恢复由下载通知承接，3 秒后复位仅为视觉兜底
            setTimeout(() => setDownloading(false), 3000);
          } catch {
            // 原生桥异常时退化为浏览器打开
            window.open(apkUrl, '_blank');
          }
        }}
        className="relative inline-flex h-8 sm:h-10 items-center justify-center gap-1.5 px-2.5 sm:px-4 rounded-[var(--radius-full)] bg-[var(--accent-color)] text-white text-xs sm:text-sm font-semibold shadow-[var(--shadow-sm)] hover:brightness-105 active:scale-95 transition-all duration-200 cursor-pointer whitespace-nowrap disabled:opacity-70"
      >
        {downloading ? <Check size={16} className="sm:w-[18px] sm:h-[18px]" /> : <RefreshCw size={15} className="sm:w-[17px] sm:h-[17px]" />}
        <span>{downloading ? '下载中' : `更新 v${manifest.versionName}`}</span>
        {!downloading && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[var(--glass-bg)] animate-pulse" />
        )}
      </button>
    );
  }

  // App 内已是最新：低调版本胶囊（仍可点击重新下载安装包）
  return (
    <button
      type="button"
      title={`当前已是最新版本${notesText}`}
      data-focusable
      onClick={() => {
        try {
          window.KVideoAndroid?.downloadUpdate?.(apkUrl);
        } catch {
          window.open(apkUrl, '_blank');
        }
      }}
      className="inline-flex h-8 sm:h-10 items-center justify-center gap-1.5 px-2.5 sm:px-3.5 rounded-[var(--radius-full)] border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-color-secondary)] text-xs sm:text-sm hover:text-[var(--accent-color)] transition-all duration-200 cursor-pointer whitespace-nowrap"
    >
      <Check size={15} className="text-[var(--accent-color)] sm:w-[17px] sm:h-[17px]" />
      <span className="hidden sm:inline">v{manifest?.versionName ?? ''}</span>
    </button>
  );
}
