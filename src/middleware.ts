import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;

  // Verify token if it exists
  const verifiedToken = token ? await verifyToken(token) : null;
  const isAuthenticated = !!verifiedToken;

  // 1. Authenticated users trying to access Login page -> Redirect to Project List
  if (isAuthenticated && pathname === '/login') {
    return NextResponse.redirect(new URL('/project-list', request.url));
  }

  // 2. Authenticated users at root -> Redirect to Project List
  if (isAuthenticated && pathname === '/') {
    return NextResponse.redirect(new URL('/project-list', request.url));
  }

  // 3. Unauthenticated users trying to access protected routes -> Redirect to Login
  // Protected routes: /project-list and anything under it
  if (!isAuthenticated && pathname.startsWith('/project-list')) {
      return NextResponse.redirect(new URL('/login', request.url));
  }
  
  // 4. Unauthenticated users at root -> Redirect to Login
  if (!isAuthenticated && pathname === '/') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/project-list/:path*'],
};
