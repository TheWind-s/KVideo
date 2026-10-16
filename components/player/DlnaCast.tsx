'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cast, Loader2, Pause, Play, RefreshCw, Square, X } from 'lucide-react';

/**
 * DLNA 投屏（仅新版 APK 内可用，依赖原生 KVideoAndroid.dlna* 桥）：
 * - 点击按钮弹出设备选择弹窗，原生 SSDP 搜索局域网电视/机顶盒；
 * - 选中设备后原生向其推送当前集 m3u8 地址（AVTransport SetAVTransportURI + Play）；
 * - 投屏成功后底部浮条显示状态，支持暂停/继续/停止，换集自动跟随推流；
 * - 浏览器环境（无原生桥）不渲染任何内容。
 */

interface DlnaDeviceLite {
  udn: string;
  name: string;
}

interface DlnaCastResult {
  ok: boolean;
  udn: string;
  name?: string;
  message?: string;
}

interface DlnaCastProps {
  /** 当前集播放地址（m3u8 直链） */
  url: string;
  /** 投屏标题（片名 + 集数） */
  title: string;
}

export function DlnaCast({ url, title }: DlnaCastProps) {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<DlnaDeviceLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingUdn, setPendingUdn] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [casting, setCasting] = useState<{ udn: string; name: string } | null>(null);
  const [castPaused, setCastPaused] = useState(false);
  /** 最近一次已成功发出的投屏内容指纹，防止「投屏成功 → 内容变化监听」回环重复推流 */
  const lastCastKeyRef = useRef('');

  // 原生桥能力检测：仅带 DLNA 桥的新版 APK 渲染按钮
  useEffect(() => {
    setBridgeReady(typeof window.KVideoAndroid?.dlnaSearch === 'function');
  }, []);

  // 监听原生回推事件
  useEffect(() => {
    const onDevices = (event: Event) => {
      const detail = (event as CustomEvent<DlnaDeviceLite[]>).detail;
      if (Array.isArray(detail)) setDevices(detail);
      setSearching(false);
    };
    const onCast = (event: Event) => {
      const detail = (event as CustomEvent<DlnaCastResult>).detail;
      if (!detail) return;
      setPendingUdn(null);
      if (detail.ok) {
        setCasting({ udn: detail.udn, name: detail.name || '电视' });
        setError('');
        setOpen(false);
        // 暂停本地播放，避免手机与电视同时出声
        document.querySelector('video')?.pause();
      } else {
        setError(detail.message || '投屏失败，请重试');
      }
    };
    window.addEventListener('kvideo-dlna-devices', onDevices);
    window.addEventListener('kvideo-dlna-cast', onCast);
    return () => {
      window.removeEventListener('kvideo-dlna-devices', onDevices);
      window.removeEventListener('kvideo-dlna-cast', onCast);
    };
  }, []);

  const startSearch = useCallback(() => {
    setSearching(true);
    setError('');
    setDevices([]);
    try {
      window.KVideoAndroid?.dlnaSearch?.();
    } catch {
      setSearching(false);
      setError('搜索设备失败，请重试');
    }
  }, []);

  const openDialog = useCallback(() => {
    setOpen(true);
    startSearch();
  }, [startSearch]);

  const castToDevice = useCallback(
    (device: DlnaDeviceLite) => {
      setPendingUdn(device.udn);
      setError('');
      lastCastKeyRef.current = `${device.udn}|${url}|${title}`;
      try {
        window.KVideoAndroid?.dlnaCast?.(device.udn, url, title);
      } catch {
        setPendingUdn(null);
        setError('投屏指令发送失败');
      }
    },
    [url, title]
  );

  // 投屏中换集/换源：自动把新地址推给电视（电视端续播下一集）
  useEffect(() => {
    if (!casting) return;
    const key = `${casting.udn}|${url}|${title}`;
    if (key === lastCastKeyRef.current) return;
    lastCastKeyRef.current = key;
    try {
      window.KVideoAndroid?.dlnaCast?.(casting.udn, url, title);
    } catch {
      /* 忽略换集推流失败 */
    }
  }, [casting, url, title]);

  const handlePauseResume = useCallback(() => {
    try {
      if (castPaused) window.KVideoAndroid?.dlnaResume?.();
      else window.KVideoAndroid?.dlnaPause?.();
      setCastPaused((prev) => !prev);
    } catch {
      /* 忽略控制失败 */
    }
  }, [castPaused]);

  const handleStop = useCallback(() => {
    try {
      window.KVideoAndroid?.dlnaStop?.();
    } catch {
      /* 忽略停止失败 */
    }
    setCasting(null);
    setCastPaused(false);
    lastCastKeyRef.current = '';
  }, []);

  if (!bridgeReady) return null;

  return (
    <>
      {/* 投屏按钮：位于收藏/分享同行 */}
      <div className="relative flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={openDialog}
          aria-label="投屏到电视"
          title="投屏到电视（DLNA）"
          data-focusable
          className="flex items-center justify-center p-2 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-color-secondary)] hover:text-[var(--accent-color)] hover:scale-110 active:scale-95 transition-all cursor-pointer"
        >
          <Cast size={18} />
        </button>
        <span className="text-sm text-[var(--text-color-secondary)]">投屏</span>
      </div>

      {/* 投屏状态浮条：固定底部居中，随时暂停/停止 */}
      {casting && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[3500] flex items-center gap-2 px-3.5 py-2 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-lg whitespace-nowrap">
          <Cast size={15} className="text-[var(--accent-color)] flex-shrink-0" />
          <span className="text-xs text-[var(--text-color)] max-w-[9rem] sm:max-w-[16rem] truncate">
            正在投屏：{casting.name}
          </span>
          <button
            type="button"
            onClick={handlePauseResume}
            aria-label={castPaused ? '继续投屏播放' : '暂停投屏播放'}
            title={castPaused ? '继续' : '暂停'}
            data-focusable
            className="flex items-center justify-center p-1.5 rounded-full text-[var(--text-color-secondary)] hover:text-[var(--accent-color)] transition-colors cursor-pointer"
          >
            {castPaused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            type="button"
            onClick={handleStop}
            aria-label="停止投屏"
            title="停止投屏"
            data-focusable
            className="flex items-center justify-center p-1.5 rounded-full text-[var(--text-color-secondary)] hover:text-red-500 transition-colors cursor-pointer"
          >
            <Square size={13} />
          </button>
        </div>
      )}

      {/* 设备选择弹窗 */}
      {open && (
        <div
          className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-xl p-4"
            role="dialog"
            aria-label="选择投屏设备"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cast size={17} className="text-[var(--accent-color)]" />
                <span className="text-sm font-semibold text-[var(--text-color)]">
                  投屏到电视
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                data-focusable
                className="p-1.5 rounded-full text-[var(--text-color-secondary)] hover:text-[var(--accent-color)] transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs text-[var(--text-color-secondary)]">
                请确保电视与手机在同一 WiFi
              </span>
              <button
                type="button"
                onClick={startSearch}
                disabled={searching}
                aria-label="重新搜索设备"
                data-focusable
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-[var(--accent-color)] border border-[var(--accent-color)]/30 hover:bg-[var(--accent-color)]/10 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={searching ? 'animate-spin' : ''} />
                重新搜索
              </button>
            </div>

            {error && (
              <p className="mb-2 px-2.5 py-2 rounded-lg bg-red-500/10 text-xs text-red-500">
                {error}
              </p>
            )}

            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {searching && devices.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-[var(--text-color-secondary)]">
                  <Loader2 size={22} className="animate-spin text-[var(--accent-color)]" />
                  <span className="text-xs">正在搜索局域网设备…</span>
                </div>
              )}

              {!searching && devices.length === 0 && !error && (
                <div className="flex flex-col items-center gap-1.5 py-8 text-[var(--text-color-secondary)]">
                  <Cast size={24} className="opacity-40" />
                  <span className="text-xs">未发现可投屏的设备</span>
                  <span className="text-[11px] opacity-70">
                    电视需支持 DLNA 并已开启多屏互动/投屏开关
                  </span>
                </div>
              )}

              {devices.map((device) => {
                const isCasting = casting?.udn === device.udn;
                const isPending = pendingUdn === device.udn;
                return (
                  <button
                    key={device.udn}
                    type="button"
                    onClick={() => castToDevice(device)}
                    disabled={isPending}
                    data-focusable
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors cursor-pointer disabled:cursor-wait ${
                      isCasting
                        ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10'
                        : 'border-[var(--glass-border)] hover:bg-[var(--accent-color)]/10'
                    }`}
                  >
                    <span className="text-sm text-[var(--text-color)] truncate">
                      {device.name}
                      {isCasting && (
                        <span className="ml-1.5 text-[11px] text-[var(--accent-color)]">
                          正在投屏
                        </span>
                      )}
                    </span>
                    {isPending ? (
                      <Loader2 size={14} className="animate-spin text-[var(--accent-color)] flex-shrink-0" />
                    ) : (
                      <span className="text-xs text-[var(--accent-color)] flex-shrink-0">
                        {isCasting ? '重新连接' : '连接'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
