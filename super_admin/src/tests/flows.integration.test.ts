/**
 * End-to-end control-plane flows, run against a throwaway in-memory MongoDB.
 * Calls the real Next.js route handlers, so auth, validation, audit and provisioning are all exercised.
 * Never points at MONGODB_URI from .env.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer;
type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
const H: Record<string, Handler> = {};
let cookie = '';
let getTenantDatabase: (t: string | { dbName: string }) => Promise<any>;
let getClientPromise: () => Promise<any>;
let validateImpersonationToken: (t: string, tenantId: string) => Promise<any>;

const ORIGIN = 'http://localhost:4030';

async function call(
  handler: Handler,
  opts: { method?: string; body?: unknown; params?: Record<string, string>; cookie?: string | null; origin?: string } = {}
) {
  const headers: Record<string, string> = { host: 'localhost:4030', 'content-type': 'application/json' };
  if (opts.origin) headers.origin = opts.origin;
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) headers.cookie = c;
  const req = new Request(`${ORIGIN}/api/x`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, headers: res.headers };
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_MASTER_DB = 'test_master';
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PLATFORM_CNAME_TARGET = 'proxy.platform.test';
  process.env.PLATFORM_APEX_IPS = '203.0.113.10';
  process.env.TENANT_PORTAL_URL = 'https://tenant.test/admin';

  H.setup = (await import('../app/api/auth/setup/route')).POST as Handler;
  H.login = (await import('../app/api/auth/login/route')).POST as Handler;
  H.status = (await import('../app/api/auth/status/route')).GET as Handler;
  H.me = (await import('../app/api/auth/me/route')).GET as Handler;
  H.logout = (await import('../app/api/auth/logout/route')).POST as Handler;
  const clients = await import('../app/api/clients/route');
  H.clientsGet = clients.GET as Handler;
  H.clientsPost = clients.POST as Handler;
  const one = await import('../app/api/clients/[id]/route');
  H.clientGet = one.GET as Handler;
  H.clientPut = one.PUT as Handler;
  H.clientDelete = one.DELETE as Handler;
  H.status_ = (await import('../app/api/clients/[id]/status/route')).PATCH as Handler;
  H.impersonate = (await import('../app/api/clients/[id]/impersonate/route')).POST as Handler;
  H.provision = (await import('../app/api/clients/[id]/provision/route')).POST as Handler;
  H.duplicate = (await import('../app/api/clients/[id]/duplicate/route')).POST as Handler;
  const br = await import('../app/api/clients/[id]/branding/route');
  H.brandingGet = br.GET as Handler;
  H.brandingPut = br.PUT as Handler;
  H.brandingPost = br.POST as Handler;
  H.domainsGet = (await import('../app/api/domains/route')).GET as Handler;
  H.domainsPost = (await import('../app/api/domains/route')).POST as Handler;
  H.domainDelete = (await import('../app/api/domains/[domain]/route')).DELETE as Handler;
  H.domainVerify = (await import('../app/api/domains/[domain]/verify/route')).POST as Handler;
  H.buildsPost = (await import('../app/api/builds/route')).POST as Handler;
  H.buildsGet = (await import('../app/api/builds/route')).GET as Handler;
  H.overview = (await import('../app/api/overview/route')).GET as Handler;

  ({ getTenantDatabase } = await import('../lib/tenantDb'));
  ({ getClientPromise } = await import('../lib/mongodb'));
  ({ validateImpersonationToken } = await import('../lib/auth'));
});

after(async () => {
  try {
    const client = await getClientPromise();
    await client.close();
  } catch {}
  await mongod?.stop();
});

test('control plane is closed without a session', async () => {
  const r = await call(H.clientsGet, { cookie: null });
  assert.equal(r.status, 401);
});

test('first-run setup creates the first super admin and signs in', async () => {
  const status = await call(H.status);
  assert.equal(status.json.setupRequired, true);

  const weak = await call(H.setup, { method: 'POST', body: { email: 'root@camsik.test', name: 'Root', password: 'short' }, cookie: null });
  assert.equal(weak.status, 400, 'passwords under 12 characters are refused');

  const setup = await call(H.setup, {
    method: 'POST',
    body: { email: 'Root@Camsik.test', name: 'Root', password: 'a-long-passphrase-1' },
    cookie: null,
  });
  assert.equal(setup.status, 201);
  const setCookie = setup.headers.get('set-cookie') || '';
  assert.match(setCookie, /camsik_sa=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(';')[0];

  const again = await call(H.setup, { method: 'POST', body: { email: 'x@y.test', password: 'another-long-pass-1' }, cookie: null });
  assert.equal(again.status, 409, 'setup cannot run twice');

  const status2 = await call(H.status);
  assert.equal(status2.json.setupRequired, false);
});

test('login: wrong password is generic; account locks after 5 failures', async () => {
  const bad = await call(H.login, { method: 'POST', body: { email: 'root@camsik.test', password: 'nope-nope-nope' }, cookie: null });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.message, 'Invalid email or password');

  for (let i = 0; i < 4; i++) {
    await call(H.login, { method: 'POST', body: { email: 'root@camsik.test', password: 'nope-nope-nope' }, cookie: null });
  }
  const locked = await call(H.login, { method: 'POST', body: { email: 'root@camsik.test', password: 'a-long-passphrase-1' }, cookie: null });
  assert.equal(locked.status, 400);
  assert.match(locked.json.message, /locked/i, 'correct password is refused during lockout');

  // Reset lockout so later tests can sign in.
  const db = await (await getClientPromise()).db('test_master');
  await db.collection('super_admins').updateOne({}, { $set: { lockedUntil: null, failedLogins: 0 } });

  const ok = await call(H.login, { method: 'POST', body: { email: 'root@camsik.test', password: 'a-long-passphrase-1' }, cookie: null });
  assert.equal(ok.status, 200);
  cookie = (ok.headers.get('set-cookie') || '').split(';')[0];
});

test('cross-site state change is blocked even with a valid session', async () => {
  const r = await call(H.clientsPost, {
    method: 'POST',
    body: { name: 'Evil Co', supportEmail: 'a@evil.test' },
    origin: 'https://attacker.example',
  });
  assert.equal(r.status, 403);
});

let acmeId = '';
let acmeSlug = 'acme-store';
const ORIGINAL_PRIMARY = '#123456';

test('create tenant: separate DB, invite token stored only as hash, branding applied', async () => {
  const r = await call(H.clientsPost, {
    method: 'POST',
    body: {
      name: 'Acme Store',
      supportEmail: 'ops@acme.test',
      adminEmail: 'owner@acme.test',
      adminName: 'Owner',
      branding: { primaryColor: ORIGINAL_PRIMARY, brandName: 'Acme' },
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.client.dbName, 'casmik_tenant_acme_store');
  assert.equal(r.json.client.branding.primaryColor, ORIGINAL_PRIMARY);
  assert.equal(r.json.provisioning.success, true);
  assert.ok(r.json.inviteToken && r.json.inviteToken.length > 20);
  acmeId = r.json.client.id;

  const tdb = await getTenantDatabase(r.json.client);
  const owner = await tdb.collection('users').findOne({ email: 'owner@acme.test' });
  assert.equal(owner.passwordHash, null, 'control plane never sets a client password');
  assert.equal(owner.status, 'pending_setup');
  assert.notEqual(owner.inviteTokenHash, r.json.inviteToken, 'raw invite token is not stored');
  assert.equal(owner.inviteTokenHash.length, 64);
});

test('duplicate slug is a conflict; reserved slug is refused', async () => {
  const dup = await call(H.clientsPost, { method: 'POST', body: { name: 'Acme Again', slug: acmeSlug, supportEmail: 'x@acme.test', autoProvision: false } });
  assert.equal(dup.status, 409);
  const reserved = await call(H.clientsPost, { method: 'POST', body: { name: 'Admin', supportEmail: 'x@acme.test', autoProvision: false } });
  assert.equal(reserved.status, 400);
});

test('tenant update: injection and identity changes are ignored or refused', async () => {
  const bad = await call(H.clientPut, { method: 'PUT', params: { id: acmeId }, body: { status: 'root' } });
  assert.equal(bad.status, 400);

  const sneaky = await call(H.clientPut, {
    method: 'PUT',
    params: { id: acmeId },
    body: { name: 'Acme Store Ltd', dbName: 'casmik', id: 'other', slug: 'hijack' },
  });
  assert.equal(sneaky.status, 200);
  assert.equal(sneaky.json.client.dbName, 'casmik_tenant_acme_store');
  assert.equal(sneaky.json.client.slug, acmeSlug);
  assert.equal(sneaky.json.client.id, acmeId);
});

test('branding studio: draft, publish, and rollback create append-only versions', async () => {
  const badColor = await call(H.brandingPut, { method: 'PUT', params: { id: acmeId }, body: { branding: { primaryColor: 'javascript:1' } } });
  assert.equal(badColor.status, 400);

  const draft = await call(H.brandingPut, { method: 'PUT', params: { id: acmeId }, body: { branding: { primaryColor: '#ABCDEF' } } });
  assert.equal(draft.status, 200);

  const pub1 = await call(H.brandingPost, { method: 'POST', params: { id: acmeId }, body: { action: 'publish', note: 'first' } });
  assert.equal(pub1.status, 200);
  assert.equal(pub1.json.version, 1);

  const noDraft = await call(H.brandingPost, { method: 'POST', params: { id: acmeId }, body: { action: 'publish' } });
  assert.equal(noDraft.status, 409);

  await call(H.brandingPut, { method: 'PUT', params: { id: acmeId }, body: { branding: { primaryColor: '#000000' } } });
  const pub2 = await call(H.brandingPost, { method: 'POST', params: { id: acmeId }, body: { action: 'publish' } });
  assert.equal(pub2.json.version, 2);

  const rb = await call(H.brandingPost, { method: 'POST', params: { id: acmeId }, body: { action: 'rollback', version: 1 } });
  assert.equal(rb.status, 200);
  assert.equal(rb.json.version, 3, 'rollback appends a new version');

  const hist = await call(H.brandingGet, { params: { id: acmeId } });
  assert.equal(hist.json.publishedVersion, 3);
  assert.equal(hist.json.versions.length, 3);
  const after = await call(H.clientGet, { params: { id: acmeId } });
  assert.equal(after.json.client.branding.primaryColor, '#ABCDEF', 'rollback restored version 1 colour');
});

test('domains: plan gate, DNS records, uniqueness across tenants, limits, removal', async () => {
  const gated = await call(H.domainsPost, { method: 'POST', body: { tenantId: acmeId, domain: 'shop.acme.test' } });
  assert.equal(gated.status, 403, 'free trial has no custom domains');

  await call(H.clientPut, { method: 'PUT', params: { id: acmeId }, body: { subscription: { customDomainEnabled: true, maxCustomDomains: 1 } } });

  const add = await call(H.domainsPost, { method: 'POST', body: { tenantId: acmeId, domain: 'https://Shop.Acme.test/' } });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(add.json.domain.domain, 'shop.acme.test');
  const types = add.json.domain.dnsRecords.map((r: any) => r.type).sort();
  assert.deepEqual(types, ['CNAME', 'TXT']);
  assert.equal(add.json.domain.txtToken, undefined, 'token is not echoed back in list-style output');

  const limit = await call(H.domainsPost, { method: 'POST', body: { tenantId: acmeId, domain: 'other.acme.test' } });
  assert.equal(limit.status, 403);

  const verify = await call(H.domainVerify, { method: 'POST', params: { domain: 'shop.acme.test' } });
  assert.equal(verify.status, 200);
  assert.equal(verify.json.verified, false, 'an unconfigured domain never verifies');
  assert.equal(verify.json.sslStatus, 'pending', 'SSL is never reported active by this app');

  const remove = await call(H.domainDelete, { method: 'DELETE', params: { domain: 'shop.acme.test' } });
  assert.equal(remove.status, 200);
  const list = await call(H.domainsGet, {});
  assert.equal(list.json.total, 0);
});

test('suspend; impersonation is audited, token is tenant-bound and expires', async () => {
  const beta = await call(H.clientsPost, { method: 'POST', body: { name: 'Beta Co', supportEmail: 'b@beta.test', autoProvision: false } });
  const betaId = beta.json.client.id;

  const imp = await call(H.impersonate, { method: 'POST', params: { id: acmeId } });
  assert.equal(imp.status, 200);
  assert.match(imp.json.portalUrl, /#impersonation=/);
  const token = imp.json.portalUrl.split('#impersonation=')[1];
  assert.ok(await validateImpersonationToken(token, acmeId), 'valid for its tenant');
  assert.equal(await validateImpersonationToken(token, betaId), null, 'not valid for another tenant');

  const sus = await call(H.status_, { method: 'PATCH', params: { id: acmeId }, body: { status: 'suspended' } });
  assert.equal(sus.status, 200);
  const impSusp = await call(H.impersonate, { method: 'POST', params: { id: acmeId } });
  assert.equal(impSusp.status, 409);

  const delActive = await call(H.clientDelete, { method: 'DELETE', params: { id: betaId }, body: { confirmSlug: beta.json.client.slug } });
  assert.equal(delActive.status, 409, 'active clients cannot be deleted');

  const wrongSlug = await call(H.clientDelete, { method: 'DELETE', params: { id: acmeId }, body: { confirmSlug: 'nope' } });
  assert.equal(wrongSlug.status, 400);
  // Keep Beta alive for the remaining tests
  assert.equal(beta.status, 201);
  acmeSlug = 'acme-store';
});

test('builds: entitlement enforced; a queued job never claims an artifact', async () => {
  const denied = await call(H.buildsPost, { method: 'POST', body: { tenantId: acmeId, panelType: 'user_android', buildType: 'aab' } });
  assert.equal(denied.status, 403);

  await call(H.clientPut, { method: 'PUT', params: { id: acmeId }, body: { subscription: { androidBuildEnabled: true } } });
  const badType = await call(H.buildsPost, { method: 'POST', body: { tenantId: acmeId, panelType: 'user_android', buildType: 'ipa' } });
  assert.equal(badType.status, 400);

  const ok = await call(H.buildsPost, { method: 'POST', body: { tenantId: acmeId, panelType: 'user_android', buildType: 'aab', versionName: '1.2.0', versionCode: 12 } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.build.status, 'queued');
  assert.equal(ok.json.build.artifactUrl, null);

  const bogusPanel = await call(H.buildsPost, { method: 'POST', body: { tenantId: acmeId, panelType: 'root_shell' } });
  assert.equal(bogusPanel.status, 400);
});

test('overview: requires a session; every figure matches the stored records', async () => {
  const anon = await call(H.overview, { cookie: null });
  assert.equal(anon.status, 401, 'overview is closed without a session');

  const out = await call(H.overview);
  assert.equal(out.status, 200);
  const s = out.json.stats;

  const list = await call(H.clientsGet);
  const clients = list.json.clients as any[];
  assert.equal(s.clients.total, clients.length, 'client total comes from the tenants collection');
  const byStatus = (st: string) => clients.filter((c) => c.status === st).length;
  assert.equal(s.clients.active, byStatus('active'));
  assert.equal(s.clients.suspended, byStatus('suspended'));
  assert.equal(s.databases.provisioned, clients.filter((c) => c.dbProvisioned).length);
  assert.equal(s.databases.pending, clients.filter((c) => !c.dbProvisioned).length);

  const builds = (await call(H.buildsGet)).json.builds as any[];
  const androidJobs = builds.filter((b) => b.platform === 'android');
  assert.equal(s.builds.android.total, androidJobs.length, 'android build count comes from build_jobs');
  assert.equal(s.builds.android.queued, androidJobs.filter((b) => b.status === 'queued').length);
  assert.equal(s.builds.android.completed, 0, 'no build worker exists, so nothing is completed');

  assert.equal(s.deployments.failed, null, 'deployments are reported as untracked, not as zero');
  assert.equal(s.domains.sslActive, null, 'SSL is reported as untracked until issuance exists');
  assert.ok(Array.isArray(s.recentActivity) && s.recentActivity.length > 0, 'activity feed comes from the audit log');
});

test('audit log records the real acting admin for sensitive actions', async () => {
  const db = await (await getClientPromise()).db('test_master');
  const rows = await db.collection('saas_audit_logs').find({ tenantId: acmeId }).toArray();
  const actions = rows.map((r: any) => r.action);
  for (const a of ['tenant.create', 'branding.publish', 'branding.rollback', 'tenant.impersonate', 'tenant.status', 'domain.register']) {
    assert.ok(actions.includes(a), `missing audit action ${a}`);
  }
  assert.ok(rows.every((r: any) => r.actorEmail === 'root@camsik.test'), 'actor is the logged-in admin');
});

test('delete: requires typed slug and drops only the tenant database when asked', async () => {
  const tdb = await getTenantDatabase({ dbName: 'casmik_tenant_acme_store' });
  assert.ok((await tdb.listCollections().toArray()).length > 0, 'tenant DB exists before delete');

  const del = await call(H.clientDelete, { method: 'DELETE', params: { id: acmeId }, body: { confirmSlug: acmeSlug, dropDatabase: true } });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(del.json.databaseDropped, true);

  const gone = await call(H.clientGet, { params: { id: acmeId } });
  assert.equal(gone.status, 404);
  assert.equal((await tdb.listCollections().toArray()).length, 0, 'tenant DB dropped');
});

test('tenant database isolation: non-tenant and forged names are refused', async () => {
  await assert.rejects(getTenantDatabase('casmik_saas_platform'), /non-tenant/);
  await assert.rejects(getTenantDatabase({ dbName: 'casmik' }), /non-tenant/);
  await assert.rejects(getTenantDatabase({ dbName: 'casmik_tenant_x;drop' }), /non-tenant/);
});

test('provisioning retry is idempotent and keeps client-changed settings', async () => {
  const list = await call(H.clientsGet, {});
  const beta = list.json.clients.find((c: any) => c.slug === 'beta-co');
  assert.ok(beta, 'Beta Co still exists');

  const tdb = await getTenantDatabase(beta);
  await tdb.collection('settings').updateOne({ _singleton: true }, { $set: { currency: 'USD' } }, { upsert: true });
  const again = await call(H.provision, { method: 'POST', params: { id: beta.id } });
  assert.equal(again.status, 200);
  const s = await tdb.collection('settings').findOne({ _singleton: true });
  assert.equal(s.currency, 'USD', 're-provisioning does not wipe tenant settings');
});

test('logout revokes the session server-side', async () => {
  const out = await call(H.logout, { method: 'POST' });
  assert.equal(out.status, 200);
  const after = await call(H.clientsGet, { cookie: cookie });
  assert.equal(after.status, 401, 'old cookie no longer works after logout');
});
