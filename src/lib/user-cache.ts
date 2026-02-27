// Cached wrapper for expensive user selection queries
import { cacheResponse } from '@/lib/response-cache';
import { getGroupFromRequest } from '@/lib/group';
import type { NextRequest } from 'next/server';

export async function getCachedUserSelection(
    req: NextRequest,
    fetcher: () => Promise<any>
): Promise<any> {
    const { searchParams } = new URL(req.url);
    const roles = searchParams.get('roles');
    const year = searchParams.get('year');
    const userId = searchParams.get('userId');
    const group = await getGroupFromRequest(req);

    // Create cache key from query parameters (include group to prevent cross-group contamination)
    const cacheKey = `users-selection-${group}-${roles || 'all'}-${year || 'all'}-${userId || 'all'}-v3`;

    // 5 minute cache for user data with stats
    return cacheResponse(cacheKey, fetcher, 5 * 60 * 1000);
}
