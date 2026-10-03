'use client';

import { useEffect, useState } from 'react';
import { Download, Sparkles, RefreshCw } from 'lucide-react';

/**
 * 强制更新拦截层
 * --------------------------------
 * - 仅在洋芋影视 App 内生效（浏览器没有原生桥，直接跳过）
 * - 打开页面时读取原生桥的已装 versionCode，与站点 /apk/release.json 对比
 * - 有新版本时渲染全屏不可关闭的更新页：必须下载安装新版本才能继续使用
 * - 点击「立即更新」调用原生 DownloadManager 下载，完成后系统自动拉起安装
 *
 * 发布新版 APK 流程不变：APK 放入 public/apk/ → 更新 release.json → push
 */

interface ApkReleaseManifest {
  versionName: string;
  versionCode: number;
  url: string;
  publishedAt?: string;
  notes?: string[];
}

export function ForceUpdateGate() {
  const [manifest, setManifest] = useState<ApkReleaseManifest | null>(null);
  const [appCode, setAppCode] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadHint, setDownloadHint] = useState(false);

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.KVideoAndroid : undefined;
    // 浏览器 / 无桥旧壳：不做强制更新（无桥壳连下载能力都没有，只能手动装）
    if (typeof bridge?.getAppVersionCode !== 'function') return;

    const installed = Number(bridge.getAppVersionCode?.() ?? 0);
    setAppCode(installed);

    fetch('/apk/release.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ApkReleaseManifest | null) => {
        if (data && Number(data.versionCode) > installed) {
          setManifest(data);
        }
      })
      .catch(() => {
        // 拉取清单失败不打扰用户
      });
  }, []);

  if (!manifest || appCode === null) return null;

  const handleUpdate = () => {
    const bridge = window.KVideoAndroid;
    if (typeof bridge?.downloadUpdate !== 'function') return;
    bridge.downloadUpdate(new URL(manifest.url, window.location.origin).toString());
    setDownloading(true);
    // 下载是系统通知栏行为，几秒后出现安装引导
    setTimeout(() => setDownloadHint(true), 4000);
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-6"
      style={{
        background: 'linear-gradient(160deg, #f4faf3 0%, #e9f2ea 55%, #dcebdd 100%)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="发现新版本"
    >
      <div className="w-full max-w-sm rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-6 sm:p-8 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center gap-2 text-[var(--accent-color)]">
          <Sparkles className="h-5 w-5" />
          <span className="text-sm font-bold tracking-wide">洋芋影视 · 版本更新</span>
        </div>

        <h2 className="mt-3 text-2xl font-bold text-[var(--text-color)]">
          发现新版本 v{manifest.versionName}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--text-color-secondary)]">
          本版本包含重要更新，需要安装新版本后才能继续使用。
        </p>

        {manifest.notes?.length ? (
          <ul className="mt-4 space-y-1.5 rounded-2xl bg-[color-mix(in_srgb,var(--accent-color)_8%,transparent)] p-4">
            {manifest.notes.map((note, i) => (
              <li key={i} className="flex gap-2 text-sm text-[var(--text-color)]">
                <span className="text-[var(--accent-color)]">·</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          onClick={handleUpdate}
          disabled={false}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-color)] px-6 py-3.5 text-base font-bold text-white shadow-lg transition-all duration-200 hover:opacity-90 active:scale-95 cursor-pointer"
        >
          {downloading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
          {downloading ? '正在下载更新包…' : '立即更新'}
        </button>

        {downloading ? (
          <p className="mt-3 text-center text-xs leading-5 text-[var(--text-color-secondary)]">
            已交给系统下载{downloadHint ? '，完成后请点击通知安装；若长时间无响应可再点一次' : '，请在通知栏查看进度'}
          </p>
        ) : (
          <p className="mt-3 text-center text-xs text-[var(--text-color-secondary)]">
            使用流量下载时请注意资费
          </p>
        )}
      </div>
    </div>
  );
}
