import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { signToken } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';

export async function POST(req: NextRequest) {
  try {
    const { account, password, group } = await req.json() as { account?: string; password?: string; group?: string };

    if (!account || !password) {
      return NextResponse.json({ error: '請輸入帳號和密碼' }, { status: 400 });
    }

    // The website is locked to the single `scottagent` account. Reject any other
    // login identifier up front — crucially including the legacy "admin", which
    // is still this account's EMAIL, so the email-based lookup below would
    // otherwise resolve "admin" to the scottagent account and let it in. Same
    // generic error as a bad credential so we don't disclose which identifier
    // works. Relax/remove to allow other logins again.
    if (String(account).trim().toLowerCase() !== 'scottagent') {
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    const db = await getDb(group);

    // Prioritize user_id match first, then fall back to email
    let user: any = await db.prepare('SELECT * FROM USERS WHERE user_id = ?').bind(account).first();

    if (!user) {
      // Try email match - but check for multiple accounts with same email
      const emailMatches = await db.prepare('SELECT * FROM USERS WHERE email = ?').bind(account).all();
      if (emailMatches.results.length === 1) {
        user = emailMatches.results[0];
      } else if (emailMatches.results.length > 1) {
        return NextResponse.json({ error: '此 Email 有多個帳戶，請使用帳號 ID 登入' }, { status: 400 });
      }
    }

    if (!user) {
      return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 });
    }

    // The website is locked down to the single `scottagent` admin account —
    // every other account (including the old `admin`) is blocked from login.
    // Matched on the resolved user (so the account's email can't be used to log
    // in either) and compared case-insensitively to avoid a casing typo locking
    // everyone out. Returns the SAME generic error as a bad credential so we
    // don't disclose which account is permitted. Relax/remove this guard to
    // allow other logins again.
    if (String(user.user_id).toLowerCase() !== 'scottagent') {
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
      group: group || 'advisor',
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
