import { recentDates, readInt, type CloudflareStatsEnv } from '@/lib/stats/kv';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * 统计数据读取（仅统计页调用）
 * 必须携带 ?key=xxx 且与环境变量 STATS_KEY 一致；
 * 未配置密钥或密钥错误一律 404，不暴露任何信息。
 */
export async function GET(request: Request, env: CloudflareStatsEnv) {
  const key = new URL(request.url).searchParams.get('key');
  if (!env?.STATS_KEY || !key || key !== env.STATS_KEY) {
    return new Response('Not Found', { status: 404 });
  }

  const kv = env.KV_STATS;
  if (!kv) {
    return Response.json(
      { error: 'KV_STATS binding 未配置，请在 Cloudflare Pages 绑定 KV 命名空间' },
      { status: 503 },
    );
  }

  try {
    const days = recentDates(30);

    const [
      visitTotal,
      apkTotal,
      visitDailyRaw,
      apkDailyRaw,
      versionKeys,
    ] = await Promise.all([
      readInt(kv, 'v:total'),
      readInt(kv, 'a:total'),
      Promise.all(days.map((d) => readInt(kv, `v:${d}`))),
      Promise.all(days.map((d) => readInt(kv, `a:${d}`))),
      kv.list({ prefix: 'a:ver:', limit: 100 }),
    ]);

    const versionEntries = await Promise.all(
      versionKeys.keys.map(async ({ name }) => ({
        version: name.replace('a:ver:', ''),
        count: await readInt(kv, name),
      })),
    );
    versionEntries.sort((a, b) => b.count - a.count);

    return Response.json({
      generatedAt: new Date().toISOString(),
      visits: {
        total: visitTotal,
        today: visitDailyRaw[visitDailyRaw.length - 1] ?? 0,
        yesterday: visitDailyRaw[visitDailyRaw.length - 2] ?? 0,
        daily: days.map((date, i) => ({ date, count: visitDailyRaw[i] ?? 0 })),
      },
      apk: {
        total: apkTotal,
        today: apkDailyRaw[apkDailyRaw.length - 1] ?? 0,
        yesterday: apkDailyRaw[apkDailyRaw.length - 2] ?? 0,
        daily: days.map((date, i) => ({ date, count: apkDailyRaw[i] ?? 0 })),
        versions: versionEntries,
      },
    });
  } catch (error) {
    console.error('[stats] data read failed', error);
    return Response.json({ error: '统计数据读取失败' }, { status: 500 });
  }
}
