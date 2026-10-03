import { cnDate, incr, type CloudflareStatsEnv } from '@/lib/stats/kv';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * APK 下载中转：计数后 302 跳转到真实安装包
 *   /api/apk/download?v=1.0.8 → /apk/kvideo-1.0.8.apk
 * 浏览器、系统下载器、App 内 DownloadManager 都会自动跟随跳转。
 * 任何异常都不能挡住下载。
 */
export async function GET(request: Request, env: CloudflareStatsEnv) {
  const url = new URL(request.url);
  const version = url.searchParams.get('v') ?? '';
  const origin = url.origin;

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return new Response('Invalid version', { status: 400 });
  }

  const target = `${origin}/apk/kvideo-${version}.apk`;

  const kv = env?.KV_STATS;
  if (kv) {
    try {
      const day = cnDate();
      await Promise.all([
        incr(kv, 'a:total'),
        incr(kv, `a:${day}`),
        incr(kv, `a:ver:${version}`),
      ]);
    } catch (error) {
      console.error('[stats] apk increment failed', error);
    }
  }

  return Response.redirect(target, 302);
}
