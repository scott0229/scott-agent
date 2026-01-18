import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { signToken } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';

export async function POST(req: NextRequest) {
  try {
    const { account, password } = await req.json() as { account?: string; password?: string };

    if (!account || !password) {
      return NextResponse.json({ error: '請輸入帳號和密碼' }, { status: 400 });
    }

    const db = await getDb();

    // Query user by email or user_id
    const stmt = db.prepare('SELECT * FROM USERS WHERE email = ? OR user_id = ?');
    const user = await stmt.bind(account, account).first();

    if (!user) {
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    const isValid = await verifyPassword(password, user.password as string);

    if (!isValid) {
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    // Generate JWT
    const token = await signToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Create response
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        user_id: user.user_id
      }
    });

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
    console.error('Login error:', error);
    return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
  }
}
