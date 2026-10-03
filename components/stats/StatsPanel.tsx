'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, Download, RefreshCw, CalendarDays } from 'lucide-react';

interface DailyPoint {
  date: string;
  count: number;
}
interface VersionPoint {
  version: string;
  count: number;
}
interface StatsData {
  generatedAt: string;
  visits: {
    total: number;
    today: number;
    yesterday: number;
    daily: DailyPoint[];
  };
  apk: {
    total: number;
    today: number;
    yesterday: number;
    daily: DailyPoint[];
    versions: VersionPoint[];
  };
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 shadow-sm">
      <div className="flex items-center gap-2 text-[var(--accent-color)]">
        {icon}
        <span className="text-sm font-semibold text-[var(--text-color-secondary)]">{label}</span>
      </div>
      <p className="mt-2 text-3xl font-bold text-[var(--text-color)] tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-[var(--text-color-secondary)]">{sub}</p>
    </div>
  );
}

function DailyBars({ data, color }: { data: DailyPoint[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-32 items-end gap-[3px]">
      {data.map((d) => (
        <div
          key={d.date}
          className="group relative flex-1 rounded-t-sm transition-all"
          style={{ height: `${Math.max(d.count > 0 ? 4 : 2, (d.count / max) * 100)}%`, backgroundColor: color, opacity: d.count > 0 ? 1 : 0.25 }}
          title={`${d.date}：${d.count}`}
        >
          <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100">
            {d.date.slice(5)} {d.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatsPanelInner() {
  const params = useSearchParams();
  const key = params.get('key') ?? '';

  const [data, setData] = useState<StatsData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'forbidden' | 'unbound' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/stats/data?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (res.status === 404) {
        setStatus('forbidden');
        return;
      }
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        setErrorText(body.error ?? 'KV 未绑定');
        setStatus('unbound');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setData(await res.json());
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, [key]);

  useEffect(() => {
    if (!key) {
      setStatus('forbidden');
      return;
    }
    load();
  }, [key, load]);

  if (status === 'forbidden') {
    return (
      <main className="flex min-h-screen items-center justify-center px-6" style={{ background: 'linear-gradient(160deg,#f4faf3,#dcebdd)' }}>
        <div className="w-full max-w-sm rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-8 text-center shadow-xl">
          <p className="text-5xl">🔒</p>
          <h1 className="mt-4 text-xl font-bold text-[var(--text-color)]">无法访问此页面</h1>
          <p className="mt-2 text-sm text-[var(--text-color-secondary)]">
            请在地址后携带正确的访问参数：<br />
            <code className="mt-1 inline-block rounded bg-black/5 px-2 py-0.5">/stats?key=你的密钥</code>
          </p>
        </div>
      </main>
    );
  }

  if (status === 'unbound' || status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center px-6" style={{ background: 'linear-gradient(160deg,#f4faf3,#dcebdd)' }}>
        <div className="w-full max-w-sm rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-8 text-center shadow-xl">
          <p className="text-4xl">⚠️</p>
          <h1 className="mt-4 text-xl font-bold text-[var(--text-color)]">统计暂不可用</h1>
          <p className="mt-2 text-sm text-[var(--text-color-secondary)]">{errorText || '数据读取失败，请稍后重试'}</p>
          <button onClick={load} className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--accent-color)] px-5 py-2.5 text-sm font-bold text-white">
            <RefreshCw className="h-4 w-4" /> 重试
          </button>
        </div>
      </main>
    );
  }

  if (status === 'loading' || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ background: 'linear-gradient(160deg,#f4faf3,#dcebdd)' }}>
        <RefreshCw className="h-8 w-8 animate-spin text-[var(--accent-color)]" />
      </main>
    );
  }

  const versionTotal = Math.max(1, data.apk.versions.reduce((s, v) => s + v.count, 0));

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6" style={{ background: 'linear-gradient(160deg,#f4faf3 0%,#e9f2ea 55%,#dcebdd 100%)' }}>
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-color)]">
              <CalendarDays className="h-6 w-6 text-[var(--accent-color)]" />
              洋芋影视 · 数据统计
            </h1>
            <p className="mt-1 text-xs text-[var(--text-color-secondary)]">
              更新于 {new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（东八区）
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-2 text-sm font-semibold text-[var(--text-color)] transition active:scale-95"
          >
            <RefreshCw className="h-4 w-4" /> 刷新
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4">
          <StatCard icon={<Eye className="h-5 w-5" />} label="网站访问总量" value={data.visits.total} sub={`今日 ${data.visits.today.toLocaleString()} · 昨日 ${data.visits.yesterday.toLocaleString()}`} />
          <StatCard icon={<Download className="h-5 w-5" />} label="APK 下载总量" value={data.apk.total} sub={`今日 ${data.apk.today.toLocaleString()} · 昨日 ${data.apk.yesterday.toLocaleString()}`} />
        </div>

        <section className="mt-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-bold text-[var(--text-color)]">
            <Eye className="h-4 w-4 text-[var(--accent-color)]" /> 近 30 天访问量
          </h2>
          <div className="mt-4">
            <DailyBars data={data.visits.daily} color="var(--accent-color)" />
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-bold text-[var(--text-color)]">
            <Download className="h-4 w-4 text-[var(--accent-color)]" /> 近 30 天 APK 下载量
          </h2>
          <div className="mt-4">
            <DailyBars data={data.apk.daily} color="#2f7a55" />
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 shadow-sm">
          <h2 className="text-base font-bold text-[var(--text-color)]">各版本下载分布</h2>
          {data.apk.versions.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--text-color-secondary)]">暂无下载记录</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.apk.versions.map((v) => (
                <li key={v.version} className="flex items-center gap-3">
                  <span className="w-16 flex-shrink-0 text-sm font-semibold text-[var(--text-color)]">v{v.version}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-full bg-black/5">
                    <div className="h-full rounded-full bg-[var(--accent-color)]" style={{ width: `${(v.count / versionTotal) * 100}%`, minWidth: v.count > 0 ? '8px' : 0 }} />
                  </div>
                  <span className="w-12 flex-shrink-0 text-right text-sm tabular-nums text-[var(--text-color-secondary)]">{v.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

export function StatsPanel() {
  return (
    <Suspense fallback={null}>
      <StatsPanelInner />
    </Suspense>
  );
}
