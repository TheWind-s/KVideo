'use client';

import React from 'react';
import { Icons } from '@/components/ui/Icon';
import { CachedVideosPanel } from '@/components/cache/CachedVideosPanel';
import { getJobsSnapshot, hydrateJobs, subscribeJobs } from '@/lib/cache/video-cache';

export function NavCacheButton() {
    const [open, setOpen] = React.useState(false);
    const [mounted, setMounted] = React.useState(false);
    const jobs = React.useSyncExternalStore(subscribeJobs, getJobsSnapshot, getJobsSnapshot);

    React.useEffect(() => {
        setMounted(true);
        hydrateJobs().catch(() => { /* ignore */ });
    }, []);

    const activeCount = jobs.filter((j) => j.status === 'downloading' || j.status === 'paused').length;
    const completedCount = jobs.filter((j) => j.status === 'completed').length;

    if (!mounted) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="relative w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-[var(--radius-full)] bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--accent-color)_10%,transparent)] transition-all duration-200 cursor-pointer"
                aria-label="我的缓存"
                title="我的缓存（离线观看）"
                data-focusable
            >
                <Icons.Download size={17} className="sm:w-5 sm:h-5" />
                {activeCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-[var(--accent-color-light,#3d8b40)] text-white text-[9px] font-bold leading-none">
                        {activeCount}
                    </span>
                )}
                {activeCount === 0 && completedCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--accent-color-light,#3d8b40)] border border-white" />
                )}
            </button>
            <CachedVideosPanel open={open} onClose={() => setOpen(false)} />
        </>
    );
}
