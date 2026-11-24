import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicTenantConfig } from './publicConfig';
import type { ProjectTemplate, Tenant } from './types';

const template = {
  id: 'template-modern-buyback',
  tokens: {
    primaryColor: '#111111',
    secondaryColor: '#222222',
    accentColor: '#333333',
    fontHeading: 'Outfit',
    fontBody: 'Inter',
    borderRadius: '16px',
    isDarkTheme: true,
  },
} as unknown as ProjectTemplate;

function tenant(overrides: Partial<Tenant> = {}, branding: Partial<Tenant['branding']> = {}): Tenant {
  return {
    id: 'tenant_1',
    name: 'ReCycle Pro',
    slug: 'recyclepro',
    dbName: 'casmik_tenant_recyclepro',
    status: 'active',
    templateId: 'template-modern-buyback',
    branding: {
      brandName: 'ReCycle Pro',
      tagline: 'Sell smart',
      logoUrl: '/images/logo.svg',
      primaryColor: '#10B981',
      secondaryColor: '#0F172A',
      accentColor: '#059669',
      supportEmail: 'care@recyclepro.test',
      supportPhone: '+91 98765 00001',
      whatsappNumber: '919876500001',
      ...branding,
    },
    features: { buyback: true, rentals: false },
    subscription: {
      plan: 'growth',
      status: 'active',
      validUntil: '2030-01-01T00:00:00Z',
      maxOrdersPerMonth: 1500,
      customDomainEnabled: true,
      priceMonthly: 7999,
    },
    dbProvisioned: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Tenant;
}

test('never exposes database name, subscription, domains or provisioning state', () => {
  const cfg = toPublicTenantConfig(
    tenant({ customDomain: 'trade.example.com', domains: [{ domain: 'x' }] } as Partial<Tenant>),
    template,
    3
  ) as unknown as Record<string, unknown>;
  const json = JSON.stringify(cfg);
  for (const forbidden of ['casmik_tenant', 'subscription', 'priceMonthly', 'maxOrdersPerMonth', 'customDomain', 'dbProvisioned', 'domains', 'adminUser', 'inviteToken']) {
    assert.equal(json.includes(forbidden), false, `leaked: ${forbidden}`);
  }
  assert.equal(cfg.version, 3);
});

test('brand colours come from the tenant; fonts and radius come from the theme', () => {
  const cfg = toPublicTenantConfig(tenant(), template, 1);
  assert.equal(cfg.theme.primary, '#10B981');
  assert.equal(cfg.theme.secondary, '#0F172A');
  assert.equal(cfg.theme.headingFont, 'Outfit');
  assert.equal(cfg.theme.borderRadius, '16px');
  assert.equal(cfg.theme.isDarkTheme, true);
});

test('invalid colours fall back to the theme colours, never to raw input', () => {
  const cfg = toPublicTenantConfig(tenant({}, { primaryColor: 'javascript:alert(1)', accentColor: '#abc' }), template, 1);
  assert.equal(cfg.theme.primary, '#111111');
  assert.equal(cfg.theme.accent, '#333333');
});

test('whatsapp number is null unless it looks like a real phone number', () => {
  assert.equal(toPublicTenantConfig(tenant({}, { whatsappNumber: '' }), template, 1).whatsappNumber, null);
  assert.equal(toPublicTenantConfig(tenant({}, { whatsappNumber: 'call me' }), template, 1).whatsappNumber, null);
  assert.equal(toPublicTenantConfig(tenant(), template, 1).whatsappNumber, '919876500001');
});

test('features keep only boolean flags with safe keys', () => {
  const t = tenant({ features: { buyback: true, '../evil': true, rentals: 'yes' } as unknown as Tenant['features'] });
  const cfg = toPublicTenantConfig(t, template, 1);
  assert.deepEqual(cfg.features, { buyback: true });
});

test('long text is truncated and missing template falls back to defaults', () => {
  const cfg = toPublicTenantConfig(tenant({}, { tagline: 'x'.repeat(1000) }), undefined, 0);
  assert.equal(cfg.tagline.length, 300);
  assert.equal(cfg.theme.headingFont, 'Inter');
  assert.equal(cfg.theme.templateId, 'template-modern-buyback');
});
