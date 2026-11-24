import { NextResponse } from 'next/server';
import {
  adminCount,
  createFirstSuperAdmin,
  loginSuperAdmin,
  requestContext,
  sameOriginOk,
  sessionCookieHeader,
} from '@/lib/auth';
import { errorResponse, fail, readJson } from '@/lib/http';
import { ValidationError } from '@/lib/security/validation';

export const dynamic = 'force-dynamic';

/**
 * First-run only: creates the first super admin and signs them in. Permanently closed once any
 * super admin exists, so it cannot be used to add accounts later.
 */
export async function POST(request: Request) {
  try {
    if (!sameOriginOk(request)) return fail('Cross-origin request blocked', 403);
    if ((await adminCount()) > 0) return fail('Setup is already complete', 409);

    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw new ValidationError('Email and password are required');

    const ctx = requestContext(request);
    await createFirstSuperAdmin({ email, name, password });
    const { token, actor } = await loginSuperAdmin(email, password, ctx);

    const res = NextResponse.json({ success: true, actor }, { status: 201 });
    res.headers.set('Set-Cookie', sessionCookieHeader(token, 8 * 3600));
    return res;
  } catch (e) {
    return errorResponse(e, 'auth.setup');
  }
}
