import { NextResponse } from 'next/server';
import { ValidationError } from './security/validation';
import { ConflictError, NotFoundError } from './tenantMaster';
import { AuthError } from './auth';

/** Maps domain errors to HTTP responses. Internal error details are logged, never returned. */
export function errorResponse(e: unknown, context: string): NextResponse {
  if (e instanceof ValidationError) {
    return NextResponse.json({ success: false, message: e.message, fields: e.fields }, { status: 400 });
  }
  if (e instanceof ConflictError) {
    return NextResponse.json({ success: false, message: e.message }, { status: 409 });
  }
  if (e instanceof NotFoundError) {
    return NextResponse.json({ success: false, message: e.message }, { status: 404 });
  }
  if (e instanceof AuthError) {
    return NextResponse.json({ success: false, message: e.message }, { status: 400 });
  }
  console.error(`[${context}]`, e);
  return NextResponse.json({ success: false, message: 'Internal error. Check server logs.' }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export function ok(data: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ success: true, ...data }, { status });
}

export function fail(message: string, status: number): NextResponse {
  return NextResponse.json({ success: false, message }, { status });
}
