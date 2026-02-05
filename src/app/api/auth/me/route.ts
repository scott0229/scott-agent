import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    console.log('API Auth Me: Token present?', !!token);
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: '無效的憑證' }, { status: 401 });
    }

    const db = await getDb();
    const user = await db.prepare(
      'SELECT id, email, user_id, avatar_url, role, api_key, auto_update_time FROM USERS WHERE id = ?'
    ).bind(payload.id).first();

    if (!user) {
      console.log('API Auth Me: User not found despite valid token');
      return NextResponse.json({ error: '找不到使用者' }, { status: 404 });
    }

    console.log('API Auth Me: Returning user:', { id: user.id, role: user.role, userId: user.user_id });
    return NextResponse.json({ success: true, user });

  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: '無效的憑證' }, { status: 401 });
    }

    const { userId, avatarUrl, currentPassword, newPassword, apiKey, autoUpdateTime } = await req.json() as {
      userId?: string;
      avatarUrl?: string;
      currentPassword?: string;
      newPassword?: string;
      apiKey?: string;
      autoUpdateTime?: string;
    };

    const db = await getDb();

    // If changing password, verify current password first
    if (currentPassword && newPassword) {
      const bcrypt = await import('bcryptjs');

      const currentUser = await db.prepare(
        'SELECT password FROM USERS WHERE id = ?'
      ).bind(payload.id).first();

      if (!currentUser) {
        return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
      }

      const isValid = await bcrypt.compare(currentPassword, currentUser.password as string);
      if (!isValid) {
        return NextResponse.json({ error: '當前密碼不正確' }, { status: 400 });
      }

      // Hash new password and update
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.prepare(
        'UPDATE USERS SET password = ?, updated_at = unixepoch() WHERE id = ?'
      ).bind(hashedPassword, payload.id).run();
    }

    // Check if user_id is already taken by another user
    if (userId) {
      const existing = await db.prepare(
        'SELECT id FROM USERS WHERE user_id = ? AND id != ?'
      ).bind(userId, payload.id).first();

      if (existing) {
        return NextResponse.json({ error: '此使用者 ID 已被使用' }, { status: 409 });
      }
    }

    await db.prepare(
      'UPDATE USERS SET user_id = ?, avatar_url = ?, api_key = ?, auto_update_time = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(
      userId || null,
      avatarUrl !== undefined ? avatarUrl : null,
      apiKey !== undefined ? apiKey : null,
      autoUpdateTime || null,
      payload.id
    ).run();

    const user = await db.prepare(
      'SELECT id, email, user_id, avatar_url, role, api_key, auto_update_time FROM USERS WHERE id = ?'
    ).bind(payload.id).first();

    return NextResponse.json({ success: true, user });

  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
  }
}
