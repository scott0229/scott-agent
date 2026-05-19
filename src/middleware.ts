import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;

  // Verify token if it exists
  const verifiedToken = token ? await verifyToken(token) : null;
  const isAuthenticated = !!verifiedToken;

  const isAuthPage = pathname === '/login' || pathname === '/register';

  // 1. Authenticated users at Auth pages -> Redirect to dashboard
  if (isAuthenticated && isAuthPage) {
    return NextResponse.redirect(new URL('/daily-trades', request.url));
  }

  // 2. Root path redirect
  if (pathname === '/') {
    return NextResponse.redirect(new URL(isAuthenticated ? '/daily-trades' : '/login', request.url));
  }

  // 3. Unauthenticated users accessing protected pages -> Redirect to Login
  if (!isAuthenticated && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.png).*)'],
};
