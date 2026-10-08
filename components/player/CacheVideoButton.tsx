'use client';

import React from 'react';
import { Icons } from '@/components/ui/Icon';
import {
    CachedVideoJob,
    deleteJob,
    formatBytes,
    getJobsSnapshot,
    hashKey,
    hydrateJobs,
    pauseJob,
    resumeJob,
    startJob,
    subscribeJobs,
} from '@/lib/cache/video-cache';

interface CacheVideoButtonProps {
    /** 原始播放地址（非代理包装地址） */
    playUrl: string;
    videoId: string;
    source: string;
    title: string;
    episodeIndex: number;
    episodeName: string;
}

const RING_RADIUS = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function CacheVideoButton({
    playUrl,
    videoId,
    source,
    title,
    episodeIndex,
    episodeName,
}: CacheVideoButtonProps) {
    const [key, setKey] = React.useState<string>('');
    const [ready, setReady] = React.useState(false);
    const [showMenu, setShowMenu] = React.useState(false);
    const [tip, setTip] = React.useState('');
    const tipTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevStatusRef = React.useRef<string>('');

    const jobs = React.useSyncExternalStore(subscribeJobs, getJobsSnapshot, getJobsSnapshot);
    const job: CachedVideoJob | undefined = React.useMemo(
        () => (key ? jobs.find((item) => item.key === key) : undefined),
        [jobs, key]
    );

    React.useEffect(() => {
        let cancelled = false;
        hydrateJobs().then(async () => {
            if (cancelled || !playUrl) return;
            const nextKey = await hashKey(playUrl);
            if (!cancelled) {
                setKey(nextKey);
                setReady(true);
            }
        });
        return () => { cancelled = true; };
    }, [playUrl]);

    const showTip = React.useCallback((message: string, duration = 2200) => {
        setTip(message);
        if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
        tipTimerRef.current = setTimeout(() => setTip(''), duration);
    }, []);

    React.useEffect(() => {
        return () => {
            if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
        };
    }, []);

    // 后台下载完成 / 失败的提示
    React.useEffect(() => {
        const status = job?.status || '';
        const prev = prevStatusRef.current;
        prevStatusRef.current = status;
        if (!prev || !status || prev === status) return;
        if (status === 'completed') showTip('缓存完成，断网也能看');
        else if (status === 'error') showTip(job?.error || '缓存失败，请重试', 3200);
    }, [job?.status, job?.error, showTip]);

    const handleStart = React.useCallback(async () => {
        try {
            await startJob({ playUrl, videoId, source, title, episodeIndex, episodeName });
            showTip('开始缓存本集，可在导航栏「缓存」查看');
        } catch (err) {
            showTip(err instanceof Error ? err.message : '无法缓存该视频');
        }
    }, [playUrl, videoId, source, title, episodeIndex, episodeName, showTip]);

    const handleClick = React.useCallback(() => {
        if (!job) {
            void handleStart();
            return;
        }
        switch (job.status) {
            case 'downloading':
                void pauseJob(job.key).then(() => showTip('已暂停缓存'));
                break;
            case 'paused':
            case 'error':
                void resumeJob(job.key).then(() => showTip('继续缓存'));
                break;
            case 'completed':
                setShowMenu((v) => !v);
                break;
            default:
                void handleStart();
        }
    }, [job, handleStart, showTip]);

    const handleDelete = React.useCallback(async () => {
        if (!job) return;
        await deleteJob(job.key);
        setShowMenu(false);
        showTip('已删除缓存');
    }, [job, showTip]);

    if (!ready || !playUrl) return null;

    const status = job?.status;
    const total = job?.totalBytes || 0;
    const done = job?.cachedBytes || 0;
    const percent = total > 0
        ? Math.min(100, Math.round((done / total) * 100))
        : (job && job.urls.length > 0
            ? Math.round((job.doneCount / job.urls.length) * 100)
            : 0);

    const label = !job
        ? '缓存本集（离线观看）'
        : status === 'downloading'
            ? `缓存中 ${percent}%${done > 0 ? ` · ${formatBytes(done)}` : ''}`
            : status === 'paused'
                ? `缓存已暂停 ${percent}% · 点击继续`
                : status === 'error'
                    ? `缓存失败 · 点击重试`
                    : '已缓存 · 点击管理';

    return (
        <div className="relative shrink-0">
            <button
                type="button"
                onClick={handleClick}
                className="btn-icon relative"
                aria-label={label}
                title={label}
            >
                {status === 'downloading' ? (
                    <span className="relative inline-flex items-center justify-center w-5 h-5">
                        <svg width="22" height="22" viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
                            <circle cx="12" cy="12" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
                            <circle
                                cx="12"
                                cy="12"
                                r={RING_RADIUS}
                                fill="none"
                                stroke="var(--accent-color-light, #3d8b40)"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeDasharray={RING_CIRCUMFERENCE}
                                strokeDashoffset={RING_CIRCUMFERENCE * (1 - Math.max(percent, 2) / 100)}
                                style={{ transition: 'stroke-dashoffset 0.3s ease' }}
                            />
                        </svg>
                        {/* 暂停标识 */}
                        <span className="flex items-center gap-[2px]">
                            <span className="block w-[2.5px] h-[8px] bg-white rounded-sm" />
                            <span className="block w-[2.5px] h-[8px] bg-white rounded-sm" />
                        </span>
                    </span>
                ) : status === 'paused' ? (
                    <span className="relative inline-flex">
                        <Icons.Download size={20} className="text-amber-400" />
                        <span className="absolute -right-1 -bottom-1 w-2 h-2 rounded-full bg-amber-400 border border-black/50" />
                    </span>
                ) : status === 'completed' ? (
                    <Icons.Check size={20} className="text-[var(--accent-color-light,#3d8b40)]" />
                ) : status === 'error' ? (
                    <Icons.Download size={20} className="text-red-400" />
                ) : (
                    <Icons.Download size={20} />
                )}
            </button>

            {/* 进度/提示气泡 */}
            {tip && !showMenu && (
                <span className="absolute bottom-full right-0 mb-2 px-2.5 py-1 rounded-lg bg-black/85 text-white text-[11px] whitespace-nowrap z-[3000] pointer-events-none">
                    {tip}
                </span>
            )}

            {/* 已缓存管理小菜单 */}
            {showMenu && (
                <>
                    <span className="fixed inset-0 z-[2998] cursor-default" onClick={() => setShowMenu(false)} />
                    <div className="absolute bottom-full right-0 mb-2 z-[2999] min-w-[150px] bg-[var(--glass-bg)] backdrop-blur-[20px] border border-[var(--glass-border)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] p-1.5">
                <div className="px-2 py-1 text-[11px] text-[var(--text-color-secondary)]">
                    本集已缓存{total > 0 ? ` · ${formatBytes(total)}` : ''}
                </div>
                <button
                    type="button"
                    onClick={handleDelete}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-xl)] text-left text-xs text-red-500 hover:bg-red-500/10 cursor-pointer"
                >
                    <Icons.Trash size={14} />
                    <span>删除缓存</span>
                </button>
            </div>
                </>
            )}
        </div>
    );
}
