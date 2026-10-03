import type { Metadata } from 'next';
import { StatsPanel } from '@/components/stats/StatsPanel';

export const metadata: Metadata = {
  title: '数据统计 - 洋芋影视',
  robots: { index: false, follow: false },
};

/**
 * 隐藏统计页：仅 /stats?key=密钥 可访问，密钥由环境变量 STATS_KEY 校验。
 * 无 key 或 key 错误时页面与接口均返回无权限提示，搜索引擎也不收录。
 */
export default function StatsPage() {
  return <StatsPanel />;
}
