import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDomain, DnsResolver, requiredDnsRecords } from './domainVerify';

const TOKEN = 'camsik-verify-abc123';
const TARGET = 'proxy.platform.example';
const APEX_IPS = ['203.0.113.10'];

function resolverWith(partial: Partial<DnsResolver>): DnsResolver {
  const fail = async () => {
    const err: any = new Error('queryNotFound');
    err.code = 'ENOTFOUND';
    throw err;
  };
  return {
    resolveCname: partial.resolveCname ?? fail,
    resolveTxt: partial.resolveTxt ?? fail,
    resolve4: partial.resolve4 ?? fail,
  };
}

const sub = { domain: 'shop.example.com', txtToken: TOKEN, cnameTarget: TARGET, apexIps: APEX_IPS };
const apex = { domain: 'example.com', txtToken: TOKEN, cnameTarget: TARGET, apexIps: APEX_IPS };

test('subdomain fully verifies when TXT token and CNAME target both match', async () => {
  const r = await checkDomain(sub, resolverWith({
    resolveTxt: async () => [[TOKEN]],
    resolveCname: async () => [TARGET],
  }));
  assert.equal(r.ownershipVerified, true);
  assert.equal(r.routingVerified, true);
});

test('TXT token split across chunks is joined before comparison', async () => {
  const r = await checkDomain(sub, resolverWith({
    resolveTxt: async () => [['camsik-verify-', 'abc123']],
    resolveCname: async () => [TARGET],
  }));
  assert.equal(r.ownershipVerified, true);
});

test('a CNAME that merely contains the platform name is rejected (no substring match)', async () => {
  const r = await checkDomain(sub, resolverWith({
    resolveTxt: async () => [[TOKEN]],
    resolveCname: async () => ['proxy.platform.example.attacker.net'],
  }));
  assert.equal(r.routingVerified, false);
});

test('wrong or missing TXT token does not verify ownership', async () => {
  const wrong = await checkDomain(sub, resolverWith({
    resolveTxt: async () => [['camsik-verify-OTHER']],
    resolveCname: async () => [TARGET],
  }));
  assert.equal(wrong.ownershipVerified, false);

  const missing = await checkDomain(sub, resolverWith({
    resolveCname: async () => [TARGET],
  }));
  assert.equal(missing.ownershipVerified, false);
  assert.match(missing.diagnostics.join(' '), /TXT lookup failed: ENOTFOUND/);
});

test('DNS lookup failure is reported, never treated as verified', async () => {
  const r = await checkDomain(sub, resolverWith({}));
  assert.equal(r.ownershipVerified, false);
  assert.equal(r.routingVerified, false);
  assert.ok(r.diagnostics.length >= 2);
});

test('apex domain verifies only when A records equal the platform IPs', async () => {
  const good = await checkDomain(apex, resolverWith({
    resolveTxt: async () => [[TOKEN]],
    resolve4: async () => ['203.0.113.10'],
  }));
  assert.equal(good.isApex, true);
  assert.equal(good.routingVerified, true);

  const bad = await checkDomain(apex, resolverWith({
    resolveTxt: async () => [[TOKEN]],
    resolve4: async () => ['198.51.100.7'],
  }));
  assert.equal(bad.routingVerified, false);
});

test('required DNS records: TXT always; CNAME host is relative to the zone', () => {
  const recs = requiredDnsRecords({ domain: 'a.b.example.com', txtToken: TOKEN, cnameTarget: TARGET, apexIps: APEX_IPS });
  const txt = recs.find((r) => r.type === 'TXT');
  const cname = recs.find((r) => r.type === 'CNAME');
  assert.equal(txt?.host, '_camsik-challenge.a.b.example.com');
  assert.equal(cname?.host, 'a.b');
  assert.equal(cname?.value, TARGET);
});

test('required DNS records for apex use A records, not CNAME', () => {
  const recs = requiredDnsRecords(apex);
  assert.ok(recs.some((r) => r.type === 'A' && r.value === '203.0.113.10'));
  assert.ok(!recs.some((r) => r.type === 'CNAME'));
});
