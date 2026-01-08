import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const db = await getDb();
    const user = await db.prepare(
      'SELECT id, email, user_id, avatar_url FROM USERS WHERE id = ?'
    ).bind(payload.id).first();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, user });
    
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { userId, avatarUrl } = await req.json() as { userId?: string; avatarUrl?: string };

    const db = await getDb();

    // Check if user_id is already taken by another user
    if (userId) {
      const existing = await db.prepare(
        'SELECT id FROM USERS WHERE user_id = ? AND id != ?'
      ).bind(userId, payload.id).first();

      if (existing) {
        return NextResponse.json({ error: 'User ID already taken' }, { status: 409 });
      }
    }

    await db.prepare(
      'UPDATE USERS SET user_id = ?, avatar_url = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(userId || null, avatarUrl !== undefined ? avatarUrl : null, payload.id).run();

    const user = await db.prepare(
      'SELECT id, email, user_id, avatar_url FROM USERS WHERE id = ?'
    ).bind(payload.id).first();

    return NextResponse.json({ success: true, user });
    
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
