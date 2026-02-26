import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { signToken } from '@/lib/auth';
import { hashPassword } from '@/lib/password';

export async function POST(req: NextRequest) {
  try {
    const { email, password, userId, group } = await req.json() as { email?: string; password?: string; userId?: string; group?: string };

    if (!email || !password || !userId) {
      return NextResponse.json({ error: '請輸入電子郵件、使用者 ID 及密碼' }, { status: 400 });
    }

    const db = await getDb(group);

    // Check if user_id already exists (email can be shared across accounts)
    const existing = await db.prepare('SELECT * FROM USERS WHERE user_id = ?')
      .bind(userId)
      .first();

    if (existing) {
      return NextResponse.json({ error: '此使用者 ID 已被使用' }, { status: 409 });
    }

    const hashedPassword = await hashPassword(password);

    // Insert new user
    const result = await db.prepare(
      'INSERT INTO USERS (email, user_id, password) VALUES (?, ?, ?)'
    ).bind(email, userId, hashedPassword).run();

    if (!result.success) {
      throw new Error('Failed to create user');
    }

    const newUser = await db.prepare('SELECT * FROM USERS WHERE user_id = ?').bind(userId).first();

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
