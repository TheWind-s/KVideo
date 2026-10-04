import { getRequestContext } from '@cloudflare/next-on-pages';
import { cnDate, incr, type CloudflareStatsEnv } from '@/lib/stats/kv';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * APK 下载中转：计数后直接以附件形式流式输出安装包（不再 302 跳转）
 *   /api/apk/download?v=1.0.10
 *
 * 为什么不 302：一加/OPPO/小米等国产自带浏览器对 pages.dev 境外域名的
 * 302 跳转下载经常静默吞掉（既不弹下载也不报错）。直接代理输出并显式
 * 附加 Content-Disposition: attachment 可最大程度触发系统下载器。
 * APK 仅 ~2.7MB，远低于 Workers 免费版响应上限，无压力。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const version = url.searchParams.get('v') ?? '';
  const origin = url.origin;

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return new Response('Invalid version', { status: 400 });
  }

  const target = `${origin}/apk/kvideo-${version}.apk`;

  let kv: CloudflareStatsEnv['KV_STATS'];
  try {
    kv = (getRequestContext().env as unknown as CloudflareStatsEnv).KV_STATS;
  } catch {
    kv = undefined;
  }

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

  try {
    const upstream = await fetch(target);
    if (!upstream.ok || !upstream.body) {
      // 上游异常时退回 302，绝不能挡住下载
      return Response.redirect(target, 302);
    }

    const headers = new Headers(upstream.headers);
    headers.set('Content-Type', 'application/vnd.android.package-archive');
    // ASCII 文件名兜底 + RFC 5987 中文文件名（洋芋影视.apk）
    const cnName = encodeURIComponent('洋芋影视') + '.apk';
    headers.set(
      'Content-Disposition',
      `attachment; filename="yangyuyingshi-${version}.apk"; filename*=UTF-8''${cnName}`,
    );
    headers.set('Cache-Control', 'public, max-age=300');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return Response.redirect(target, 302);
  }
}
