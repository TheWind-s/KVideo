'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { MessageCircleMore, X } from 'lucide-react';

/**
 * 导航栏「联系我们」按钮 + 图片弹窗
 * --------------------------------
 * - 位于导航栏右侧「下载APP / 更新」按钮旁边
 * - 点击弹出居中弹窗展示联系图片（public/images/contact-us.jpg，云端可直接替换）
 * - 弹窗支持点击遮罩 / 右上角 X / Esc 关闭
 *
 * 更换图片：替换 public/images/contact-us.jpg 后重新部署即可
 */
export function ContactUsButton() {
    const [open, setOpen] = React.useState(false);
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    React.useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    if (!mounted) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title="联系我们"
                aria-label="联系我们"
                data-focusable
                className="inline-flex h-8 sm:h-10 items-center justify-center gap-1.5 px-2.5 sm:px-4 rounded-[var(--radius-full)] border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-color)] text-xs sm:text-sm font-medium hover:bg-[color-mix(in_srgb,var(--accent-color)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--accent-color)_40%,var(--glass-border))] transition-all duration-200 cursor-pointer whitespace-nowrap"
            >
                <MessageCircleMore size={16} className="sm:w-[18px] sm:h-[18px]" />
                <span className="hidden sm:inline">联系我们</span>
            </button>

            {open && createPortal(
                <div
                    className="fixed inset-0 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    style={{ zIndex: 4000 }}
                    onClick={() => setOpen(false)}
                >
                    <div
                        className="relative w-full max-w-xs sm:max-w-sm max-h-[85vh] overflow-y-auto rounded-[var(--radius-2xl)] border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--shadow-md)] p-4 sm:p-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="关闭联系我们弹窗"
                            className="absolute top-2.5 right-2.5 z-10 w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-color-secondary)] hover:bg-black/5 hover:text-[var(--text-color)] transition-colors cursor-pointer"
                        >
                            <X size={18} />
                        </button>
                        <h3 className="text-base font-semibold text-[var(--text-color)] mb-3 flex items-center gap-2">
                            <MessageCircleMore size={18} className="text-[var(--accent-color)]" />
                            联系我们
                        </h3>
                        <img
                            src="/images/contact-us.jpg"
                            alt="联系我们"
                            className="mx-auto w-full max-h-[55vh] object-contain rounded-xl border border-[var(--glass-border)] select-none"
                            draggable={false}
                        />
                        <p className="mt-3 text-xs text-center text-[var(--text-color-secondary)]">
                            如有建议或问题，欢迎随时联系
                        </p>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
