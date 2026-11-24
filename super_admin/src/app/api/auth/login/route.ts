import { NextResponse } from 'next/server';
import {
  loginSuperAdmin,
  requestContext,
  sameOriginOk,
  sessionCookieHeader,
} from '@/lib/auth';
import { errorResponse, fail, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!sameOriginOk(request)) return fail('Cross-origin request blocked', 403);
    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return fail('Email and password are required', 400);

    const { token, actor } = await loginSuperAdmin(email, password, requestContext(request));
    const res = NextResponse.json({ success: true, actor });
    res.headers.set('Set-Cookie', sessionCookieHeader(token, 8 * 3600));
    return res;
  } catch (e) {
    // AuthError messages are deliberately generic for bad credentials
    return errorResponse(e, 'auth.login');
  }
}
