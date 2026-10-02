import type { VideoSource } from '@/lib/types';
// Same catalogue is also published at the same origin (/default-sources.json)
// so clients can refresh the list without reaching GitHub. Keep both in sync.
import rawDefaultSources from '@/public/default-sources.json';

interface RawDefaultSource {
    id: string;
    name: string;
    baseUrl: string;
    group?: 'normal' | 'premium';
    enabled?: boolean;
    priority?: number;
}

// Default predefined video sources - bundled at build time so fresh clients
// (including TV WebViews on networks where GitHub raw is unreachable) can
// search immediately without fetching an external subscription.
export const DEFAULT_SOURCES: VideoSource[] = (rawDefaultSources as RawDefaultSource[])
    .filter((source) => source.group !== 'premium')
    .map((source) => ({
        id: source.id,
        name: source.name,
        baseUrl: source.baseUrl,
        searchPath: '',
        detailPath: '',
        enabled: source.enabled !== false,
        priority: source.priority || 1,
        group: 'normal' as const,
    }));
