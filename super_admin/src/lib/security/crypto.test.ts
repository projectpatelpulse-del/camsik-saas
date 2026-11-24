import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  randomToken,
  sha256Hex,
  verifyPassword,
} from './crypto';

test('password hash verifies the right password only', () => {
  const stored = hashPassword('correct horse battery');
  assert.equal(verifyPassword('correct horse battery', stored), true);
  assert.equal(verifyPassword('correct horse battery!', stored), false);
  assert.equal(verifyPassword('', stored), false);
});

test('password hashes use a fresh salt each time', () => {
  assert.notEqual(hashPassword('same-password-123'), hashPassword('same-password-123'));
});

test('malformed stored hash never verifies', () => {
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
  assert.equal(verifyPassword('x', 'bcrypt$1$2$3$4$5'), false);
});

test('secret encryption round-trips with an explicit key', () => {
  const key = randomBytes(32);
  const payload = encryptSecret('mongodb+srv://u:p@host/db', key);
  assert.notEqual(payload, 'mongodb+srv://u:p@host/db');
  assert.equal(decryptSecret(payload, key), 'mongodb+srv://u:p@host/db');
});

test('encryption uses a random IV (same plaintext, different ciphertext)', () => {
  const key = randomBytes(32);
  assert.notEqual(encryptSecret('same', key), encryptSecret('same', key));
});

test('tampered ciphertext is rejected (GCM authentication)', () => {
  const key = randomBytes(32);
  const parts = encryptSecret('secret-value', key).split(':');
  const ct = Buffer.from(parts[3], 'base64');
  ct[0] ^= 0xff;
  parts[3] = ct.toString('base64');
  assert.throws(() => decryptSecret(parts.join(':'), key));
});

test('decryption with a different key fails', () => {
  const payload = encryptSecret('value', randomBytes(32));
  assert.throws(() => decryptSecret(payload, randomBytes(32)));
});

test('encryption reads SECRETS_ENCRYPTION_KEY and rejects a wrong-length key', () => {
  const saved = process.env.SECRETS_ENCRYPTION_KEY;
  try {
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    assert.throws(() => encryptSecret('x'), /32 bytes/);
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    assert.equal(decryptSecret(encryptSecret('x')), 'x');
    delete process.env.SECRETS_ENCRYPTION_KEY;
    assert.throws(() => encryptSecret('x'), /not set/);
  } finally {
    if (saved === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = saved;
  }
});

test('random tokens are unique and URL-safe; hashes are stable', () => {
  const a = randomToken();
  assert.notEqual(a, randomToken());
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.equal(sha256Hex('abc'), sha256Hex('abc'));
  assert.equal(sha256Hex('abc').length, 64);
});
