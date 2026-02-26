import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

/**
 * Extract the account group from the request JWT cookie.
 * Returns 'advisor' (default) or 'scott'.
 */
export async function getGroupFromRequest(req: NextRequest): Promise<string> {
    const token = req.cookies.get('token')?.value;
    if (!token) return 'advisor';
    const payload = await verifyToken(token);
    return payload?.group || 'advisor';
}
