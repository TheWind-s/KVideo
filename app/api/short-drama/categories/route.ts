/**
 * 短剧可用源与分类探测
 * POST /api/short-drama/categories
 * body: { sources: VideoSource[] }
 * 返回所有"提供短剧分类"的源及其子分类标签。
 *
 * 注意：Cloudflare Workers 免费版单请求最多 50 个子请求，
 * 因此最多探测 48 个源，并用并发池控制在途请求数。
 */

import { NextRequest } from 'next/server';
import type { VideoSource } from '@/lib/types';
import { probeShortDramaSource } from '@/lib/api/short-drama-api';

export const runtime = 'edge';

const MAX_PROBED_SOURCES = 48;
const CONCURRENCY = 24;
const PER_SOURCE_TIMEOUT_MS = 6000;

async function mapPool<T, R>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let cursor = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            try {
                results[index] = { status: 'fulfilled', value: await worker(items[index]) };
            } catch (error) {
                results[index] = {
                    status: 'rejected',
                    reason: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }
    });

    await Promise.all(runners);
    return results;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const sources: VideoSource[] = Array.isArray(body?.sources) ? body.sources : [];
        const enabled = sources
            .filter((s) => s && s.baseUrl && s.enabled !== false)
            .slice(0, MAX_PROBED_SOURCES);

        if (enabled.length === 0) {
            return Response.json({ sources: [] });
        }

        const settled = await mapPool(enabled, CONCURRENCY, async (source) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), PER_SOURCE_TIMEOUT_MS);
            try {
                return await probeShortDramaSource(source, controller.signal);
            } finally {
                clearTimeout(timer);
            }
        });

        const hitSources = settled
            .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof probeShortDramaSource>>> =>
                r.status === 'fulfilled'
            )
            .map((r) => r.value)
            .filter((v) => v !== null);

        // 子分类更丰富（标签多）的源排前面，默认体验更好
        hitSources.sort((a, b) => b.children.length - a.children.length);

        return Response.json({ sources: hitSources });
    } catch (error) {
        return Response.json(
            { sources: [], error: error instanceof Error ? error.message : 'Probe failed' },
            { status: 200 }
        );
    }
}
