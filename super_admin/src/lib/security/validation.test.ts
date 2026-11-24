import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dbNameForSlug,
  isValidTenantDbName,
  normalizeDomain,
  normalizeSlug,
  sanitizeBranding,
  sanitizeTenantUpdate,
  validateDomain,
  validateNewTenant,
  validateSlug,
  ValidationError,
} from './validation';

test('slug normalisation and validation', () => {
  assert.equal(normalizeSlug('  ABC Electronics!! '), 'abc-electronics');
  assert.equal(validateSlug('abc-electronics'), null);
  assert.notEqual(validateSlug('ab'), null, 'too short');
  assert.notEqual(validateSlug('-bad-'), null, 'leading/trailing hyphen');
  assert.notEqual(validateSlug('admin'), null, 'reserved');
  assert.notEqual(validateSlug('a'.repeat(40)), null, 'too long');
});

test('database names are derived from slugs and must match the tenant pattern', () => {
  assert.equal(dbNameForSlug('apex-it'), 'casmik_tenant_apex_it');
  assert.equal(isValidTenantDbName('casmik_tenant_apex_it'), true);
  assert.equal(isValidTenantDbName('casmik'), false, 'the shared app DB is not a tenant DB');
  assert.equal(isValidTenantDbName('admin'), false);
  assert.equal(isValidTenantDbName('casmik_tenant_x;drop'), false);
});

test('domain normalisation strips scheme, path, port and trailing dot', () => {
  assert.equal(normalizeDomain('HTTPS://Shop.Example.com/path?x=1'), 'shop.example.com');
  assert.equal(normalizeDomain('example.com:8443.'), 'example.com');
});

test('domain validation rejects IPs, single labels and bad characters', () => {
  assert.equal(validateDomain('shop.example.com'), null);
  assert.notEqual(validateDomain('localhost'), null);
  assert.notEqual(validateDomain('10.0.0.1'), null);
  assert.notEqual(validateDomain('exa_mple.com'), null);
  assert.notEqual(validateDomain('-bad.example.com'), null);
});

test('new tenant requires a valid name, slug and support email; db name is derived', () => {
  const v = validateNewTenant({ name: 'ABC Electronics', supportEmail: 'Care@ABC.in' });
  assert.equal(v.slug, 'abc-electronics');
  assert.equal(v.dbName, 'casmik_tenant_abc_electronics');
  assert.equal(v.supportEmail, 'care@abc.in');

  assert.throws(() => validateNewTenant({ name: 'X', supportEmail: 'nope' }), (e: any) => {
    assert.ok(e instanceof ValidationError);
    assert.ok(e.fields.name && e.fields.supportEmail);
    return true;
  });
});

test('caller-supplied dbName is ignored for new tenants', () => {
  const v = validateNewTenant({ name: 'Acme Store', supportEmail: 'a@acme.in', dbName: 'casmik' });
  assert.equal(v.dbName, 'casmik_tenant_acme_store');
});

test('branding sanitiser keeps known keys and drops unknown ones', () => {
  const out = sanitizeBranding({
    brandName: 'Acme',
    primaryColor: '#10B981',
    logoUrl: '/images/logo.svg',
    _id: 'evil',
    $where: '1==1',
    tenantId: 'other',
  });
  assert.deepEqual(out, { brandName: 'Acme', primaryColor: '#10B981', logoUrl: '/images/logo.svg' });
});

test('branding sanitiser rejects bad colours and script URLs', () => {
  assert.throws(() => sanitizeBranding({ primaryColor: 'red' }), ValidationError);
  assert.throws(() => sanitizeBranding({ logoUrl: 'javascript:alert(1)' }), ValidationError);
  assert.throws(() => sanitizeBranding({ logoUrl: '//evil.example/x.png' }), ValidationError);
  assert.throws(() => sanitizeBranding({ logoUrl: 'http://insecure.example/x.png' }), ValidationError);
  assert.throws(() => sanitizeBranding({ brandName: 42 }), ValidationError);
});

test('tenant update allowlist cannot change identity, domains or provisioning', () => {
  const out = sanitizeTenantUpdate({
    name: 'Renamed',
    id: 'other-id',
    slug: 'hijack',
    dbName: 'casmik_tenant_victim',
    customDomain: 'victim.com',
    dbProvisioned: true,
    createdAt: '2000-01-01',
  });
  assert.deepEqual(out, { name: 'Renamed' });
});

test('tenant update validates status and plan values', () => {
  assert.throws(() => sanitizeTenantUpdate({ status: 'root' }), ValidationError);
  assert.throws(() => sanitizeTenantUpdate({ subscription: { plan: 'god-mode' } }), ValidationError);
  assert.throws(() => sanitizeTenantUpdate({ subscription: { priceMonthly: -5 } }), ValidationError);
  assert.deepEqual(sanitizeTenantUpdate({ status: 'suspended' }), { status: 'suspended' });
});
