/**
 * 短剧分类浏览 API（服务端 / edge）
 *
 * 苹果 CMS V10 标准协议：
 * - GET {baseUrl}?ac=list                 -> 分类树 { class: [{type_id,type_pid,type_name}] }
 * - GET {baseUrl}?ac=detail&t={typeId}&pg=n -> 分类影片 { total,pagecount,list }
 *
 * 豆瓣不提供短剧标签，短剧频道改为按视频源的原生分类浏览，
 * 而不是用"短剧"关键词按片名模糊搜索。
 */

import type { VideoSource, VideoItem } from '@/lib/types';
import { fetchWithTimeout } from './http-utils';

export interface SourceCategory {
    typeId: string | number;
    typePid: string | number;
    name: string;
}

export interface ShortDramaSourceInfo {
    sourceId: string;
    sourceName: string;
    baseUrl: string;
    /** 短剧主分类 */
    category: SourceCategory;
    /** 短剧主分类下的子分类（如：现代都市/反转爽文/古装仙侠），无子分类时为空数组 */
    children: SourceCategory[];
}

const CATEGORY_PROBE_TIMEOUT = 8000;
const LIST_TIMEOUT = 15000;

/**
 * 拉取源的完整分类树
 */
async function fetchCategoryTree(
    source: VideoSource,
    signal?: AbortSignal
): Promise<SourceCategory[]> {
    const url = new URL(source.baseUrl);
    url.searchParams.set('ac', 'list');

    const res = await fetchWithTimeout(
        url.toString(),
        {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                ...source.headers,
            },
            signal,
        },
        CATEGORY_PROBE_TIMEOUT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const classes = Array.isArray(data?.class) ? data.class : [];
    return classes.map((c: any) => ({
        typeId: c.type_id,
        typePid: c.type_pid,
        name: String(c.type_name || '').trim(),
    }));
}

/**
 * 在分类树中定位"短剧"主分类。
 * 命名不一（短剧/短剧大全/爽文短剧/ai短剧），统一按包含"短剧"匹配，
 * 多个命中时优先级：顶级分类 > 名称最短（"短剧"比"爽文短剧"更通用）。
 */
export function pickShortDramaCategory(classes: SourceCategory[]): SourceCategory | null {
    const hits = classes.filter((c) => c.name.includes('短剧'));
    if (hits.length === 0) return null;

    const score = (c: SourceCategory) => {
        let s = 0;
        if (Number(c.typePid) === 0) s += 100; // 顶级大类通常影片最全
        s -= Math.abs(c.name.length - 2) * 2;  // 越接近"短剧"二字越优先
        if (c.name.includes('AI') || c.name.includes('ai')) s -= 20; // AI 漫剧较窄，降权
        if (c.name.includes('爽文')) s -= 5;
        return s;
    };

    return [...hits].sort((a, b) => score(b) - score(a))[0];
}

/**
 * 探测单个源是否提供短剧分类，返回完整浏览信息（含子分类）
 */
export async function probeShortDramaSource(
    source: VideoSource,
    signal?: AbortSignal
): Promise<ShortDramaSourceInfo | null> {
    const classes = await fetchCategoryTree(source, signal);
    const category = pickShortDramaCategory(classes);
    if (!category) return null;

    const children = classes.filter(
        (c) => String(c.typePid) === String(category.typeId) && c.name
    );

    return {
        sourceId: source.id,
        sourceName: source.name,
        baseUrl: source.baseUrl,
        category,
        children,
    };
}

/**
 * 按分类 ID 拉取一页影片
 */
export async function fetchVideosByCategory(
    source: VideoSource,
    typeId: string | number,
    page: number,
    signal?: AbortSignal
): Promise<{ list: VideoItem[]; total: number; pagecount: number }> {
    const url = new URL(source.baseUrl);
    url.searchParams.set('ac', 'detail');
    url.searchParams.set('t', String(typeId));
    url.searchParams.set('pg', String(page));

    const res = await fetchWithTimeout(
        url.toString(),
        {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                ...source.headers,
            },
            signal,
        },
        LIST_TIMEOUT
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const list: VideoItem[] = (data?.list || []).map((item: any) => ({
        ...item,
        source: source.id,
    }));

    return {
        list,
        total: Number(data?.total) || 0,
        pagecount: Number(data?.pagecount) || 1,
    };
}
