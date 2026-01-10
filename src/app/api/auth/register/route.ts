import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword, signToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password, userId } = await req.json() as { email?: string; password?: string; userId?: string };

    if (!email || !password || !userId) {
      return NextResponse.json({ error: '請輸入電子郵件、使用者 ID 及密碼' }, { status: 400 });
    }

    const db = await getDb();

    // Check if email or user_id already exists
    const existing = await db.prepare('SELECT * FROM USERS WHERE email = ? OR user_id = ?')
      .bind(email, userId)
      .first();

    if (existing) {
      if (existing.email === email) {
        return NextResponse.json({ error: '此電子郵件已被註冊' }, { status: 409 });
      }
      if (existing.user_id === userId) {
        return NextResponse.json({ error: '此使用者 ID 已被使用' }, { status: 409 });
      }
    }

    const hashedPassword = await hashPassword(password);

    // Insert new user
    const result = await db.prepare(
      'INSERT INTO USERS (email, user_id, password) VALUES (?, ?, ?)'
    ).bind(email, userId, hashedPassword).run();

    if (!result.success) {
      throw new Error('Failed to create user');
    }

    // Get the newly created user (or usage lastID if predictable, but safe to fetch or just use info)
    // For D1, result.meta.last_row_id might work but easier to just sign token with provided info for now
    // or fetch from DB to be sure. Let's fetch to get the ID.
    const newUser = await db.prepare('SELECT * FROM USERS WHERE email = ?').bind(email).first();

    if (!newUser) {
      throw new Error('User created but not found');
    }

    // Generate JWT
    const token = await signToken({
      id: newUser.id,
      email: newUser.email,
      userId: newUser.user_id
    });

    // Create response
    const response = NextResponse.json({ success: true, user: { id: newUser.id, email: newUser.email, userId: newUser.user_id } });

    // Set HttpOnly Cookie
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24, // 1 day
      path: '/',
    });

    return response;

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
  }
}
