import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { useSiteIcon } from '@/components/SiteIconProvider';
import { Icons } from '@/components/ui/Icon';
import { siteConfig } from '@/lib/config/site-config';

export function PlayerNavbar({ isPremium }: { isPremium?: boolean }) {
    const router = useRouter();
    const siteIconSrc = useSiteIcon();

    return (
        <nav className="sticky top-0 z-50 pt-4 pb-2 px-4" style={{ transform: 'translateZ(0)' }}>
            <div className="max-w-7xl mx-auto bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-sm)] px-4 sm:px-6 py-4">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                        <button
                            onClick={() => router.push(isPremium ? '/premium' : '/')}
                            className="flex items-center justify-center hover:opacity-80 transition-opacity flex-shrink-0 cursor-pointer"
                            title={isPremium ? "返回高级主页" : "返回首页"}
                        >
                            <Image
                                src={siteIconSrc}
                                alt={siteConfig.name}
                                width={40}
                                height={40}
                                unoptimized
                                className="object-contain"
                            />
                        </button>
                        <Button
                            variant="secondary"
                            onClick={() => router.back()}
                            className="flex items-center gap-2"
                        >
                            <Icons.ChevronLeft size={20} />
                            <span className="hidden sm:inline">返回</span>
                        </Button>
                    </div>
                    {/* 顶部右侧操作按钮（设置/主题切换）已隐藏 */}
                </div>
            </div>
        </nav>
    );
}
