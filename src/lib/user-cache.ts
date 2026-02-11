// Cached wrapper for expensive user selection queries
import { cacheResponse } from '@/lib/response-cache';
import type { NextRequest } from 'next/server';

export async function getCachedUserSelection(
    req: NextRequest,
    fetcher: () => Promise<any>
): Promise<any> {
    const { searchParams } = new URL(req.url);
    const roles = searchParams.get('roles');
    const year = searchParams.get('year');
    const userId = searchParams.get('userId');

    // Create cache key from query parameters
    const cacheKey = `users-selection-${roles || 'all'}-${year || 'all'}-${userId || 'all'}-v3`;

    // 5 minute cache for user data with stats
    return cacheResponse(cacheKey, fetcher, 5 * 60 * 1000);
}
