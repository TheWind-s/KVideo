import { getRequestContext } from '@cloudflare/next-on-pages';
import { cnDate, incr, type CloudflareStatsEnv } from '@/lib/stats/kv';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * 网站访问计数
 * 客户端每个浏览器会话只上报一次（sessionStorage 去重），
 * 无 KV 绑定时静默成功，绝不影响页面正常使用。
 */
export async function POST() {
  const env = getRequestContext().env as unknown as CloudflareStatsEnv;
  const kv = env.KV_STATS;
  if (!kv) {
    return Response.json({ ok: false, reason: 'kv-unbound' }, { status: 200 });
  }

  try {
    const day = cnDate();
    await Promise.all([incr(kv, 'v:total'), incr(kv, `v:${day}`)]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error('[stats] visit increment failed', error);
    return Response.json({ ok: false }, { status: 200 });
  }
}
