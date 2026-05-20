import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { apiRateLimiter, authRateLimiter } from '@/lib/rate-limiter';

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const isAuthPage = request.nextUrl.pathname.startsWith('/login');
  const isApiAuthRoute = request.nextUrl.pathname.startsWith('/api/auth');
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');

  // Rate limiting for API routes
  if (isApiRoute) {
    try {
      if (isApiAuthRoute) {
        // Auth routes: rate limit by IP
        const ip =
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          request.headers.get('x-real-ip') ||
          'unknown';
        const result = authRateLimiter.check(ip);

        if (!result.allowed) {
          return new NextResponse(
            JSON.stringify({ error: 'Too many requests' }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(Math.ceil((result.retryAfterMs ?? 1000) / 1000)),
              },
            }
          );
        }

        // Auth routes bypass the rest of the auth check
        return NextResponse.next();
      }

      // General API routes: rate limit by user ID (from JWT)
      if (token) {
        const userId = (token.id as string) || token.email || 'anonymous';
        const result = apiRateLimiter.check(userId);

        if (!result.allowed) {
          return new NextResponse(
            JSON.stringify({ error: 'Too many requests' }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(Math.ceil((result.retryAfterMs ?? 1000) / 1000)),
              },
            }
          );
        }
      }
    } catch {
      // Fail open: if rate limiter errors, allow the request through
    }
  }

  if (isApiAuthRoute) {
    return NextResponse.next();
  }

  if (!token && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (token && isAuthPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
