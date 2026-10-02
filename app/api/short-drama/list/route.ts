/**
 * 按分类拉取短剧影片（服务端代理，规避混合内容/CORS）
 * POST /api/short-drama/list
 * body: { source: VideoSource, typeId: string|number, pg: number }
 */

import { NextRequest } from 'next/server';
import type { VideoSource } from '@/lib/types';
import { fetchVideosByCategory } from '@/lib/api/short-drama-api';
import { getSourceName } from '@/lib/utils/source-names';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const source: VideoSource | undefined = body?.source;
        const typeId = body?.typeId;
        const pg = Math.max(1, Number(body?.pg) || 1);

        if (!source?.baseUrl || typeId === undefined || typeId === null) {
            return Response.json({ error: 'source and typeId are required' }, { status: 400 });
        }

        const data = await fetchVideosByCategory(source, typeId, pg);

        return Response.json({
            page: pg,
            total: data.total,
            pagecount: data.pagecount,
            list: data.list.map((video) => ({
                ...video,
                sourceName: getSourceName(source.id) || source.name,
            })),
        });
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : 'Fetch failed' },
            { status: 502 }
        );
    }
}
