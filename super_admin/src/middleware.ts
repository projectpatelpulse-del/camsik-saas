import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge gate. It only checks that a session cookie is present; the session itself is verified
 * against MongoDB inside each route handler (requireAdmin), since the edge runtime cannot query the DB.
 * Routes under /api/auth stay open so login and first-run setup work.
 */
const SESSION_COOKIE = 'camsik_sa';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  let response: NextResponse;
  if (pathname.startsWith('/api/auth/')) {
    response = NextResponse.next();
  } else if (pathname.startsWith('/api/')) {
    response = hasSession
      ? NextResponse.next()
      : NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 });
  } else if (pathname === '/login') {
    response = NextResponse.next();
  } else if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next();
  }

  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images/).*)'],
};
