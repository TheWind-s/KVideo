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
 * 媒体通知栏集成（双通道）：
 *
 * 1. 原生桥通道（洋芋影视 App / Android WebView）：
 *    WebView 不支持 Web MediaSession API，改由 JS 桥上报状态给原生
 *    MediaSessionCompat → 系统媒体通知栏（锁屏 / 下拉媒体卡片），
 *    通知按钮 / 耳机媒体键经 window.__kvideoMediaCommand 调回网页。
 *
 * 2. 标准 Web MediaSession 通道（Chrome 桌面 / Android 浏览器 / iOS Safari）：
 *    设置 metadata + action handlers，由浏览器自行渲染系统媒体通知。
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
        const video = videoRef.current;
        if (typeof window === 'undefined' || !video) return;
        if (!title) return;

        const displayTitle = episodeName ? `${title} · ${episodeName}` : title;

        // ---------- 共用控制命令（通知按钮 / 锁屏控件都会走到这里） ----------
        const tryAction = (fn?: () => void) => {
            try { fn?.(); } catch { /* ignore */ }
        };
        const playHandler = () => {
            video.play().catch(() => { /* ignore autoplay rejection */ });
        };
        const pauseHandler = () => {
            video.pause();
        };
        const seekToHandler = (time?: number) => {
            if (typeof time === 'number' && isFinite(time) && time >= 0) {
                video.currentTime = Math.min(time, video.duration || time);
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

        const runCommand = (cmd: string, arg?: number) => {
            switch (cmd) {
                case 'play': playHandler(); break;
                case 'pause': pauseHandler(); break;
                case 'seekto': seekToHandler(arg); break;
                case 'seekforward': seekForwardHandler(); break;
                case 'seekbackward': seekBackwardHandler(); break;
                case 'next': nextHandler(); break;
                case 'prev': prevHandler(); break;
                case 'stop': stopHandler(); break;
            }
        };

        // ---------- 通道 1：原生桥（App WebView） ----------
        const bridge = window.KVideoAndroid;
        if (typeof bridge?.mediaUpdate === 'function') {
            window.__kvideoMediaCommand = runCommand;

            let lastReport = 0;
            const report = (force = false) => {
                const now = Date.now();
                if (!force && now - lastReport < 1000) return;
                lastReport = now;
                try {
                    bridge.mediaUpdate?.(JSON.stringify({
                        isPlaying: !video.paused && !video.ended,
                        title: displayTitle,
                        artist: title,
                        album: totalEpisodes && totalEpisodes > 1 ? `共 ${totalEpisodes} 集` : '洋芋影视',
                        position: Math.round((video.currentTime || 0) * 1000),
                        duration: Math.round((video.duration || 0) * 1000),
                        canNext: !!onNextEpisode,
                        canPrev: !!onPreviousEpisode,
                    }));
                } catch { /* ignore */ }
            };

            const onPlayB = () => report(true);
            const onPauseB = () => report(true);
            const onMetaB = () => report(true);
            const onEndedB = () => report(true);
            const onTimeB = () => {
                // timeupdate 高频触发：仅在播放中按 1s 节流上报进度
                if (!video.paused) report();
            };

            video.addEventListener('play', onPlayB);
            video.addEventListener('pause', onPauseB);
            video.addEventListener('loadedmetadata', onMetaB);
            video.addEventListener('durationchange', onMetaB);
            video.addEventListener('seeked', onMetaB);
            video.addEventListener('ended', onEndedB);
            video.addEventListener('timeupdate', onTimeB);
            report(true);

            return () => {
                video.removeEventListener('play', onPlayB);
                video.removeEventListener('pause', onPauseB);
                video.removeEventListener('loadedmetadata', onMetaB);
                video.removeEventListener('durationchange', onMetaB);
                video.removeEventListener('seeked', onMetaB);
                video.removeEventListener('ended', onEndedB);
                video.removeEventListener('timeupdate', onTimeB);
                delete window.__kvideoMediaCommand;
                try {
                    bridge.mediaStop?.();
                } catch { /* ignore */ }
            };
        }

        // ---------- 通道 2：标准 Web MediaSession（浏览器环境） ----------
        if (!('mediaSession' in navigator)) return;

        // ---------- metadata ----------
        const artwork = poster
            ? [{ src: poster, sizes: '512x512', type: 'image/jpeg' }]
            : [];

        navigator.mediaSession.metadata = new MediaMetadata({
            title: displayTitle,
            artist: title,
            album: totalEpisodes && totalEpisodes > 1
                ? `共 ${totalEpisodes} 集`
                : '洋芋影视',
            artwork,
        });

        // ---------- action handlers ----------
        const actions: [MediaSessionAction, (details?: MediaSessionActionDetails) => void][] = [
            ['play', playHandler],
            ['pause', pauseHandler],
            ['seekto', (details) => seekToHandler(details?.seekTime)],
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

        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('durationchange', onLoaded);
        updateState();

        return () => {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('durationchange', onLoaded);
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
