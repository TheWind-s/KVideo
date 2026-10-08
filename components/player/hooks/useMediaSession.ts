'use client';

import { useEffect, useRef } from 'react';

interface UseMediaSessionProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    title: string;
    episodeName?: string;
    episodeIndex?: number;
    totalEpisodes?: number;
    poster?: string;
    onNextEpisode?: () => void;
    onPreviousEpisode?: () => void;
    onSeekTo?: (time: number) => void;
}

/**
 * MediaSession API 集成
 *
 * - 桌面 Chrome：在系统媒体通知里显示控制
 * - Android WebView/App：系统媒体通知带「投屏」按钮（走系统 MediaRouter，支持 Chromecast/DLNA/蓝牙）
 * - iOS Safari：锁屏界面上显示控制
 *
 * 注意：Android WebView 默认支持 MediaSession（API 23+），
 * 但需要在 AndroidManifest.xml 声明 android.permission.FOREGROUND_SERVICE
 * 和注册 MediaPlayer.Callback 才能完整生效；纯网页侧只需设置 metadata + handlers 即可触发系统通知。
 */
export function useMediaSession({
    videoRef,
    title,
    episodeName,
    episodeIndex,
    totalEpisodes,
    poster,
    onNextEpisode,
    onPreviousEpisode,
    onSeekTo,
}: UseMediaSessionProps) {
    const handlersRef = useRef({ onNextEpisode, onPreviousEpisode, onSeekTo });
    handlersRef.current = { onNextEpisode, onPreviousEpisode, onSeekTo };

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
        if (!title) return;

        const video = videoRef.current;
        if (!video) return;

        // ---------- metadata ----------
        const artwork = poster
            ? [{ src: poster, sizes: '512x512', type: 'image/jpeg' }]
            : [];

        navigator.mediaSession.metadata = new MediaMetadata({
            title: episodeName ? `${title} · ${episodeName}` : title,
            artist: title,
            album: totalEpisodes && totalEpisodes > 1
                ? `共 ${totalEpisodes} 集`
                : '洋芋影视',
            artwork,
        });

        // ---------- action handlers ----------
        const tryAction = (fn?: () => void) => {
            try { fn?.(); } catch { /* ignore */ }
        };

        const playHandler = () => {
            video.play().catch(() => { /* ignore autoplay rejection */ });
        };
        const pauseHandler = () => {
            video.pause();
        };
        const seekToHandler = (details?: MediaSessionActionDetails) => {
            const t = details?.seekTime;
            if (typeof t === 'number' && isFinite(t) && t >= 0) {
                video.currentTime = Math.min(t, video.duration || t);
                handlersRef.current.onSeekTo?.(video.currentTime);
            }
        };
        const seekForwardHandler = () => {
            video.currentTime = Math.min((video.currentTime || 0) + 10, video.duration || Infinity);
        };
        const seekBackwardHandler = () => {
            video.currentTime = Math.max((video.currentTime || 0) - 10, 0);
        };
        const nextHandler = () => tryAction(handlersRef.current.onNextEpisode);
        const prevHandler = () => tryAction(handlersRef.current.onPreviousEpisode);
        const stopHandler = () => {
            video.pause();
            video.currentTime = 0;
        };

        const actions: [MediaSessionAction, (details?: MediaSessionActionDetails) => void][] = [
            ['play', playHandler],
            ['pause', pauseHandler],
            ['seekto', seekToHandler],
            ['seekforward', seekForwardHandler],
            ['seekbackward', seekBackwardHandler],
            ['stop', stopHandler],
        ];
        if (onNextEpisode) actions.push(['nexttrack', nextHandler]);
        if (onPreviousEpisode) actions.push(['previoustrack', prevHandler]);

        for (const [action, handler] of actions) {
            try {
                navigator.mediaSession.setActionHandler(action, handler as any);
            } catch { /* some actions unsupported on this UA */ }
        }

        // ---------- playback state sync ----------
        const updateState = () => {
            try {
                if (video.paused) {
                    navigator.mediaSession.playbackState = 'paused';
                } else {
                    navigator.mediaSession.playbackState = 'playing';
                }
                if ('setPositionState' in navigator.mediaSession && isFinite(video.duration) && video.duration > 0) {
                    navigator.mediaSession.setPositionState({
                        duration: video.duration,
                        position: Math.min(video.currentTime || 0, video.duration),
                        playbackRate: video.playbackRate || 1,
                    });
                }
            } catch { /* ignore */ }
        };

        const onPlay = () => updateState();
        const onPause = () => updateState();
        const onLoaded = () => updateState();
        const onTimeUpdate = () => {
            // 频率太高，节流：仅在整 5 秒变化时同步
            const sec = Math.floor(video.currentTime || 0);
            if (sec !== (video as any).__lastMsSec) {
                (video as any).__lastMsSec = sec;
                updateState();
            }
        };

        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('durationchange', onLoaded);
        video.addEventListener('timeupdate', onTimeUpdate);
        updateState();

        return () => {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('durationchange', onLoaded);
            video.removeEventListener('timeupdate', onTimeUpdate);
            // 离开页面时清除状态，避免幽灵通知
            try {
                navigator.mediaSession.metadata = null;
                navigator.mediaSession.playbackState = 'none';
                for (const [action] of actions) {
                    try { navigator.mediaSession.setActionHandler(action, null); } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        };
    }, [title, episodeName, episodeIndex, totalEpisodes, poster, videoRef]);
}
