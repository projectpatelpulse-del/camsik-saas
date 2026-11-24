import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Password hashing (scrypt, memory-hard, built into Node — no native deps).
 * Format: scrypt$N$r$p$saltB64$hashB64
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const { N, r, p } = SCRYPT_PARAMS;
  const hash = scryptSync(password, salt, KEY_LEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Opaque random token (URL-safe). Store only its hash. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Encryption of tenant secrets (DB URIs, API keys) at rest with AES-256-GCM.
 * Key: SECRETS_ENCRYPTION_KEY = base64 of 32 random bytes.
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
function getSecretsKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) throw new Error('SECRETS_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SECRETS_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer = getSecretsKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(payload: string, key: Buffer = getSecretsKey()): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('Malformed secret payload');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
