'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Icons } from '@/components/ui/Icon';
import {
    CachedVideoJob,
    clearAllJobs,
    deleteJob,
    formatBytes,
    getJobsSnapshot,
    getStorageInfo,
    hydrateJobs,
    pauseJob,
    resumeJob,
    StorageInfo,
    subscribeJobs,
} from '@/lib/cache/video-cache';

interface CachedVideosPanelProps {
    open: boolean;
    onClose: () => void;
}

function episodeLabel(job: CachedVideoJob): string {
    return job.episodeName?.trim() || `第 ${job.episodeIndex + 1} 集`;
}

function JobProgress({ job }: { job: CachedVideoJob }) {
    const percent = job.totalBytes > 0
        ? Math.min(100, Math.round((job.cachedBytes / job.totalBytes) * 100))
        : (job.urls.length > 0
            ? Math.round((job.doneCount / job.urls.length) * 100)
            : 0);

    return (
        <div className="mt-1.5">
            <div className="h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all ${job.status === 'error' ? 'bg-red-400' : 'bg-[var(--accent-color-light,#3d8b40)]'}`}
                    style={{ width: `${Math.max(percent, job.status === 'downloading' ? 3 : 0)}%` }}
                />
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-color-secondary)] flex items-center gap-1.5">
                {job.status === 'downloading' && <span>缓存中 {percent}%</span>}
                {job.status === 'paused' && <span className="text-amber-600">已暂停 {percent}%</span>}
                {job.status === 'error' && <span className="text-red-500">{job.error || '缓存失败'}</span>}
                {job.status === 'completed' && <span className="text-[var(--accent-color-light,#3d8b40)]">已完成 · 可离线观看</span>}
                {job.status !== 'completed' && job.urls.length > 0 && (
                    <span>{job.doneCount}/{job.urls.length} 片</span>
                )}
            </div>
        </div>
    );
}

export function CachedVideosPanel({ open, onClose }: CachedVideosPanelProps) {
    const router = useRouter();
    const jobs = React.useSyncExternalStore(subscribeJobs, getJobsSnapshot, getJobsSnapshot);
    const [storage, setStorage] = React.useState<StorageInfo>({ quota: 0, usage: 0, persistent: false });

    React.useEffect(() => {
        if (open) {
            hydrateJobs().then(() => getStorageInfo()).then(setStorage).catch(() => { /* ignore */ });
        }
    }, [open, jobs.length]);

    const totalCachedBytes = React.useMemo(
        () => jobs.reduce((sum, job) => sum + (job.status === 'completed' ? job.cachedBytes : 0), 0),
        [jobs]
    );

    if (!open) return null;

    const handleOpen = (job: CachedVideoJob) => {
        if (job.status !== 'completed' && job.status !== 'paused') return;
        onClose();
        router.push(job.pageUrl);
    };

    const handleClearAll = async () => {
        if (jobs.length === 0) return;
        const ok = window.confirm(`确定清空全部 ${jobs.length} 个缓存吗？此操作不可恢复。`);
        if (!ok) return;
        await clearAllJobs();
        setStorage(await getStorageInfo());
    };

    return createPortal(
        <div className="fixed inset-0 z-[4200] flex justify-center">
            {/* 遮罩 */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden
            />

            <div className="relative w-full max-w-md mx-auto mt-0 sm:mt-[8vh] mb-0 sm:mb-auto h-full sm:h-auto sm:max-h-[80vh] flex flex-col bg-[var(--glass-bg)] backdrop-blur-[25px] sm:rounded-[var(--radius-2xl)] border border-[var(--glass-border)] shadow-[var(--shadow-md)] overflow-hidden">
                {/* 头部 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border)]">
                    <div>
                        <h2 className="text-base font-semibold text-[var(--text-color)] flex items-center gap-2">
                            <Icons.Download size={18} className="text-[var(--accent-color-light,#3d8b40)]" />
                            我的缓存
                        </h2>
                        <p className="text-[11px] text-[var(--text-color-secondary)] mt-0.5">
                            {jobs.length > 0
                                ? `已缓存 ${formatBytes(totalCachedBytes)}${storage.quota > 0 ? ` · 剩余空间约 ${formatBytes(Math.max(0, storage.quota - storage.usage))}` : ''}`
                                : '在播放器中点下载按钮即可缓存'}
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        {jobs.length > 0 && (
                            <button
                                type="button"
                                onClick={handleClearAll}
                                className="px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-500/10 rounded-[var(--radius-xl)] cursor-pointer"
                            >
                                清空
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="关闭"
                            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-color-secondary)] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                        >
                            <Icons.ChevronDown size={18} />
                        </button>
                    </div>
                </div>

                {/* 列表 */}
                <div className="flex-1 overflow-y-auto px-3 py-2">
                    {jobs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <Icons.Cloud size={40} className="text-[var(--text-color-secondary)] opacity-40" />
                            <p className="mt-3 text-sm text-[var(--text-color-secondary)]">还没有缓存视频</p>
                            <p className="mt-1 text-[11px] text-[var(--text-color-secondary)] opacity-80">
                                播放时点播放器右下角的下载按钮，断网也能看
                            </p>
                        </div>
                    ) : (
                        <ul className="space-y-1.5">
                            {jobs.map((job) => {
                                const playable = job.status === 'completed' || job.status === 'paused';
                                return (
                                    <li
                                        key={job.key}
                                        className={`rounded-[var(--radius-2xl)] border border-[var(--glass-border)] bg-white/40 dark:bg-white/5 px-3 py-2.5 ${playable ? 'cursor-pointer hover:border-[var(--accent-color-light,#3d8b40)]' : ''}`}
                                        onClick={() => handleOpen(job)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 shrink-0 rounded-[var(--radius-xl)] bg-[color-mix(in_srgb,var(--accent-color-light,#3d8b40)_12%,transparent)] flex items-center justify-center">
                                                <Icons.Film size={17} className="text-[var(--accent-color-light,#3d8b40)]" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-[var(--text-color)] truncate">
                                                        {job.title}
                                                    </span>
                                                    {job.status === 'completed' && (
                                                        <Icons.Check size={13} className="shrink-0 text-[var(--accent-color-light,#3d8b40)]" />
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-[var(--text-color-secondary)] truncate">
                                                    {episodeLabel(job)}
                                                    {job.cachedBytes > 0 && ` · ${formatBytes(job.cachedBytes)}`}
                                                </div>
                                                <JobProgress job={job} />
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                {job.status === 'downloading' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => pauseJob(job.key)}
                                                        aria-label="暂停"
                                                        title="暂停"
                                                        className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-color-secondary)] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                                    >
                                                        <Icons.Pause size={16} />
                                                    </button>
                                                )}
                                                {(job.status === 'paused' || job.status === 'error') && (
                                                    <button
                                                        type="button"
                                                        onClick={() => resumeJob(job.key)}
                                                        aria-label="继续缓存"
                                                        title="继续缓存"
                                                        className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--accent-color-light,#3d8b40)] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                                    >
                                                        <Icons.Play size={16} />
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => deleteJob(job.key)}
                                                    aria-label="删除缓存"
                                                    title="删除缓存"
                                                    className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-color-secondary)] hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
                                                >
                                                    <Icons.Trash size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="px-4 py-2.5 border-t border-[var(--glass-border)] text-[11px] text-[var(--text-color-secondary)] leading-relaxed">
                    缓存保存在本机应用内，不会上传；清理应用数据会一并删除。
                </div>
            </div>
        </div>,
        document.body
    );
}
