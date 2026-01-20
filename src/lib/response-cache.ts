// Simple in-memory response cache for API endpoints
// Usage: Import this module and use cacheResponse() wrapper

interface CacheEntry {
    response: any;
    timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

export async function cacheResponse<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = DEFAULT_TTL
): Promise<T> {
    const cached = cache.get(key);

    if (cached && (Date.now() - cached.timestamp) < ttl) {
        console.log(`[Cache HIT] ${key}`);
        return cached.response;
    }

    console.log(`[Cache MISS] ${key}, fetching...`);
    const response = await fetcher();

    cache.set(key, {
        response,
        timestamp: Date.now()
    });

    return response;
}

export function clearCache(key?: string) {
    if (key) {
        cache.delete(key);
        console.log(`[Cache CLEAR] ${key}`);
    } else {
        cache.clear();
        console.log('[Cache CLEAR] All cache cleared');
    }
}
