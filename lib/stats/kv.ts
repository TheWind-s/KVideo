/**
 * Cloudflare KV 统计存储层
 * --------------------------------
 * KV 命名空间需在 Cloudflare 后台绑定为 KV_STATS：
 *   Pages 项目 → Settings → Functions → KV namespace bindings
 *
 * Key 设计：
 *   v:total           网站访问总量
 *   v:YYYY-MM-DD      当天访问量（Asia/Shanghai）
 *   a:total           APK 下载总量
 *   a:YYYY-MM-DD      当天下载量
 *   a:ver:x.y.z       某版本下载量
 */

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: { name: string; expiration?: number }[];
  }>;
}

export interface CloudflareStatsEnv {
  KV_STATS?: KVNamespaceLike;
  /** 统计页访问密钥（Pages 环境变量） */
  STATS_KEY?: string;
}

/** 东八区日期，避免 UTC 跨天导致计数归属错误 */
export function cnDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 最近 n 天日期（含今天，旧 → 新） */
export function recentDates(days: number, today: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() - i);
    out.push(cnDate(d));
  }
  return out;
}

/** 自增计数器。KV 无原子操作，此量级下读改写竞态可接受 */
export async function incr(kv: KVNamespaceLike, key: string): Promise<number> {
  const raw = await kv.get(key);
  const current = Number.parseInt(raw ?? '0', 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  await kv.put(key, String(next));
  return next;
}

export async function readInt(kv: KVNamespaceLike, key: string): Promise<number> {
  const raw = await kv.get(key);
  const n = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}
