import { NextResponse } from 'next/server';
import { getMasterDatabase } from './tenantMaster';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from './security/crypto';
import { validateEmail } from './security/validation';

/**
 * Super Admin authentication. Identity lives in the master DB (`super_admins`), sessions in
 * `sessions` (token stored only as SHA-256 hash, TTL-expired by Mongo).
 */

export const SESSION_COOKIE = 'camsik_sa';
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const IMPERSONATION_SESSION_MS = 30 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 12;

export interface AdminActor {
  id: string;
  email: string;
  name: string;
  role: 'super_admin';
}

export class AuthError extends Error {}

export interface RequestContext {
  ip: string;
  userAgent: string;
}

export function requestContext(request: Request): RequestContext {
  return {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
    userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
  };
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function sessionCookieHeader(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

async function sessionsCollection() {
  const db = await getMasterDatabase();
  return db.collection('sessions');
}

export async function adminCount(): Promise<number> {
  const db = await getMasterDatabase();
  return db.collection('super_admins').countDocuments();
}

/** Creates the first super admin. Refuses if any admin already exists (no open registration). */
export async function createFirstSuperAdmin(input: { email: string; name: string; password: string }): Promise<AdminActor> {
  if (!validateEmail(input.email)) throw new AuthError('A valid email is required');
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const db = await getMasterDatabase();
  const col = db.collection('super_admins');
  if ((await col.countDocuments()) > 0) throw new AuthError('Setup is already complete');

  const doc = {
    id: `sa_${randomToken(12)}`,
    email: input.email.toLowerCase(),
    name: input.name.trim().slice(0, 120) || 'Super Admin',
    role: 'super_admin' as const,
    passwordHash: hashPassword(input.password),
    failedLogins: 0,
    lockedUntil: null as Date | null,
    createdAt: new Date(),
    lastLoginAt: null as Date | null,
  };
  try {
    await col.insertOne(doc);
  } catch (e: any) {
    if (e?.code === 11000) throw new AuthError('An account with this email already exists');
    throw e;
  }
  return { id: doc.id, email: doc.email, name: doc.name, role: 'super_admin' };
}

/** Verifies credentials, applies lockout, and creates an admin session. Generic error on failure. */
export async function loginSuperAdmin(
  email: string,
  password: string,
  ctx: RequestContext
): Promise<{ token: string; actor: AdminActor }> {
  const GENERIC = 'Invalid email or password';
  const db = await getMasterDatabase();
  const col = db.collection('super_admins');
  const user = await col.findOne({ email: (email || '').toLowerCase().trim() });

  if (user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    throw new AuthError('Account temporarily locked after repeated failed logins. Try again later.');
  }

  const ok = user ? verifyPassword(password || '', user.passwordHash) : (verifyPassword(password || '', DUMMY_HASH), false);
  if (!user || !ok) {
    if (user) {
      const failed = (user.failedLogins || 0) + 1;
      await col.updateOne(
        { _id: user._id },
        {
          $set: {
            failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
            lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
          },
        }
      );
    }
    throw new AuthError(GENERIC);
  }

  await col.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const token = randomToken();
  await (await sessionsCollection()).insertOne({
    tokenHash: sha256Hex(token),
    kind: 'admin',
    actorId: user.id,
    actorEmail: user.email,
    tenantId: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + ADMIN_SESSION_MS),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return {
    token,
    actor: { id: user.id, email: user.email, name: user.name, role: 'super_admin' },
  };
}

// Constant-time work for unknown emails, so response timing does not reveal which emails exist.
const DUMMY_HASH = hashPassword(randomToken(16));

export async function destroySession(request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await (await sessionsCollection()).deleteOne({ tokenHash: sha256Hex(token), kind: 'admin' });
}

export async function getAdminFromRequest(request: Request): Promise<AdminActor | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const session = await (await sessionsCollection()).findOne({
    tokenHash: sha256Hex(token),
    kind: 'admin',
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const db = await getMasterDatabase();
  const user = await db.collection('super_admins').findOne({ id: session.actorId });
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, role: 'super_admin' };
}

/**
 * Cross-site request check for state-changing requests. Browsers always send Origin on
 * cross-origin POST; the session cookie is also SameSite=Strict. Non-browser clients send no Origin.
 */
export function sameOriginOk(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

export type GuardResult = { actor: AdminActor } | { response: NextResponse };

/** Use at the top of every control-plane route handler. */
export async function requireAdmin(request: Request): Promise<GuardResult> {
  if (!sameOriginOk(request)) {
    return { response: NextResponse.json({ success: false, message: 'Cross-origin request blocked' }, { status: 403 }) };
  }
  const actor = await getAdminFromRequest(request);
  if (!actor) {
    return { response: NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 }) };
  }
  return { actor };
}

/**
 * Impersonation session: a real, short-lived, tenant-scoped token tied to the actor who started it.
 * The token is returned once; only its hash is stored. Tenant-side validation uses
 * validateImpersonationToken.
 */
export async function createImpersonationSession(
  actor: AdminActor,
  tenantId: string,
  ctx: RequestContext
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + IMPERSONATION_SESSION_MS);
  await (await sessionsCollection()).insertOne({
    tokenHash: sha256Hex(token),
    kind: 'impersonation',
    actorId: actor.id,
    actorEmail: actor.email,
    tenantId,
    createdAt: new Date(),
    expiresAt,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { token, expiresAt };
}

export async function validateImpersonationToken(token: string, tenantId: string) {
  return (await sessionsCollection()).findOne({
    tokenHash: sha256Hex(token),
    kind: 'impersonation',
    tenantId,
    expiresAt: { $gt: new Date() },
  });
}
