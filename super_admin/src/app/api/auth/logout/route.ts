import { NextResponse } from 'next/server';
import { destroySession, sameOriginOk, sessionCookieHeader } from '@/lib/auth';
import { errorResponse, fail } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!sameOriginOk(request)) return fail('Cross-origin request blocked', 403);
    await destroySession(request);
    const res = NextResponse.json({ success: true });
    res.headers.set('Set-Cookie', sessionCookieHeader('', 0));
    return res;
  } catch (e) {
    return errorResponse(e, 'auth.logout');
  }
}
