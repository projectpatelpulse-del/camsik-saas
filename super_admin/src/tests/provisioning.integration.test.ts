/**
 * Phase 2 end-to-end tests: step-based provisioning jobs, resume after interruption, tenant ownership
 * checks, invitation handling, and logo/favicon upload. Calls the real route handlers against a
 * throwaway in-memory MongoDB. Never uses MONGODB_URI.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer;
type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
const H: Record<string, Handler> = {};
let cookie = '';
let setStepFault: (key: any, fn: (() => void) | null) => void;
let getTenantDatabase: (t: { dbName: string }) => Promise<any>;
let getClientPromise: () => Promise<any>;
let sha256Hex: (s: string) => string;

const ORIGIN = 'http://localhost:4030';
const MASTER = 'test_master';

async function call(
  handler: Handler,
  opts: { method?: string; body?: unknown; params?: Record<string, string>; cookie?: string | null } = {}
) {
  const headers: Record<string, string> = { host: 'localhost:4030', 'content-type': 'application/json' };
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
  return { status: res.status, json, headers: res.headers, text };
}

async function callForm(handler: Handler, params: Record<string, string>, form: FormData, sessionCookie: string | null = cookie) {
  const headers: Record<string, string> = { host: 'localhost:4030' };
  if (sessionCookie) headers.cookie = sessionCookie;
  const req = new Request(`${ORIGIN}/api/x`, {
    method: 'POST',
    headers,
    body: form,
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function masterDb() {
  return (await getClientPromise()).db(MASTER);
}

let slugCounter = 0;
async function newTenant(name: string) {
  slugCounter += 1;
  const slug = `${name.toLowerCase().replace(/[^a-z]/g, '')}${slugCounter}`;
  const r = await call(H.clientsPost, {
    method: 'POST',
    body: { name: `${name} ${slugCounter}`, slug, supportEmail: `ops@${slug}.test`, autoProvision: false, templateId: 'modern-minimal' },
  });
  assert.equal(r.status, 201, `tenant created: ${JSON.stringify(r.json)}`);
  return r.json.client as { id: string; slug: string; dbName: string };
}

async function createJob(tenantId: string, extra: Record<string, unknown> = {}) {
  const r = await call(H.jobsPost, { method: 'POST', body: { tenantId, ...extra } });
  assert.ok(r.status === 201 || r.status === 200, `job created: ${JSON.stringify(r.json)}`);
  return r.json as { job: any; created: boolean; inviteToken?: string };
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_MASTER_DB = MASTER;
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PLATFORM_CNAME_TARGET = 'proxy.platform.test';
  process.env.PLATFORM_APEX_IPS = '203.0.113.10';

  H.setup = (await import('../app/api/auth/setup/route')).POST as Handler;
  H.clientsPost = (await import('../app/api/clients/route')).POST as Handler;
  H.provision = (await import('../app/api/clients/[id]/provision/route')).POST as Handler;
  H.jobsPost = (await import('../app/api/provisioning-jobs/route')).POST as Handler;
  H.jobsList = (await import('../app/api/provisioning-jobs/route')).GET as Handler;
  H.jobGet = (await import('../app/api/provisioning-jobs/[id]/route')).GET as Handler;
  H.jobRun = (await import('../app/api/provisioning-jobs/[id]/run/route')).POST as Handler;
  H.jobAbandon = (await import('../app/api/provisioning-jobs/[id]/abandon/route')).POST as Handler;
  H.assetsPost = (await import('../app/api/clients/[id]/assets/route')).POST as Handler;
  H.assetsGet = (await import('../app/api/clients/[id]/assets/route')).GET as Handler;
  H.publicAsset = (await import('../app/api/tenant-assets/[tenantId]/[kind]/route')).GET as Handler;

  ({ setStepFaultForTesting: setStepFault } = await import('../lib/provisioningJobs'));
  ({ getTenantDatabase } = await import('../lib/tenantDb'));
  ({ getClientPromise } = await import('../lib/mongodb'));
  ({ sha256Hex } = await import('../lib/security/crypto'));

  const setup = await call(H.setup, {
    method: 'POST',
    body: { email: 'root@camsik.test', name: 'Root', password: 'a-long-passphrase-1' },
    cookie: null,
  });
  assert.equal(setup.status, 201);
  cookie = (setup.headers.get('set-cookie') || '').split(';')[0];
});

after(async () => {
  try {
    (await getClientPromise()).close();
  } catch {}
  await mongod?.stop();
});

test('job: every step runs in order; web and mobile are reported skipped, not faked', async () => {
  const t = await newTenant('Alpha');
  const { job, created } = await createJob(t.id);
  assert.equal(created, true);
  assert.equal(job.steps.length, 11);
  assert.ok(job.steps.every((s: any) => s.status === 'pending'), 'nothing runs at creation');

  const run = await call(H.jobRun, { method: 'POST', params: { id: job.id } });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  const done = run.json.job;
  assert.equal(done.status, 'succeeded');
  assert.equal(done.active, false);
  const byKey = Object.fromEntries(done.steps.map((s: any) => [s.key, s]));
  for (const k of ['create_tenant', 'provision_database', 'apply_migrations', 'create_storage_namespace', 'apply_template', 'configure_domains', 'verify']) {
    assert.equal(byKey[k].status, 'succeeded', `${k} succeeded`);
  }
  assert.equal(byKey.prepare_web.status, 'skipped', 'web deployment is not claimed');
  assert.equal(byKey.prepare_mobile.status, 'skipped', 'mobile builds are not claimed');
  assert.equal(byKey.invite_admin.status, 'skipped', 'no owner email, so no invite');

  const db = await getTenantDatabase(t);
  const migrations = await db.collection('tenant_migrations').find({}).sort({ version: 1 }).toArray();
  assert.deepEqual(migrations.map((m: any) => m.version), [1, 2], 'both migrations recorded');
  const storage = await (await masterDb()).collection('tenant_storage').countDocuments({ tenantId: t.id });
  assert.equal(storage, 1, 'one storage namespace per tenant');
  const reg = await (await masterDb()).collection('tenants').findOne({ id: t.id });
  assert.equal(reg.dbProvisioned, true);
  assert.equal(reg.defaultDomain, `${t.slug}.camsik.com`);
  assert.equal(reg.provisioning.status, 'completed');
});

test('interrupted run resumes at the failed step without duplicating data', async () => {
  const t = await newTenant('Bravo');
  const { job } = await createJob(t.id, { adminEmail: 'owner@bravo.test', adminName: 'Owner' });

  // A transient failure in the middle of the run, fired once.
  let fired = false;
  setStepFault('apply_migrations', () => {
    if (!fired) {
      fired = true;
      throw new Error('simulated connection drop');
    }
  });
  const first = await call(H.jobRun, { method: 'POST', params: { id: job.id } });
  setStepFault('apply_migrations', null);

  assert.equal(first.status, 500);
  assert.equal(first.json.job.status, 'failed');
  const failed = first.json.job.steps.find((s: any) => s.status === 'failed');
  assert.equal(failed.key, 'apply_migrations', 'failure is attributed to the exact step');
  assert.match(failed.error, /simulated connection drop/);
  assert.equal(first.json.job.steps.find((s: any) => s.key === 'provision_database').status, 'succeeded', 'earlier steps kept');
  assert.equal(first.json.job.steps.find((s: any) => s.key === 'verify').status, 'pending', 'later steps did not run');

  // Retry resumes from the failed step.
  const retry = await call(H.jobRun, { method: 'POST', params: { id: job.id } });
  assert.equal(retry.status, 200, JSON.stringify(retry.json));
  assert.equal(retry.json.job.status, 'succeeded');
  assert.equal(retry.json.job.attempts, 2);

  // No duplicates anywhere.
  const db = await getTenantDatabase(t);
  assert.equal(await db.collection('tenant_migrations').countDocuments({ version: 1 }), 1);
  assert.equal(await db.collection('users').countDocuments({ role: 'owner' }), 1, 'one owner account, not two');
  assert.equal(await (await masterDb()).collection('tenant_storage').countDocuments({ tenantId: t.id }), 1);
  const jobs = await (await masterDb()).collection('provisioning_jobs').countDocuments({ tenantId: t.id });
  assert.equal(jobs, 1, 'retry reuses the same job');
  const meta = await db.collection('tenant_meta').countDocuments({ _id: 'tenant' });
  assert.equal(meta, 1);
});

test('the lease stops a second run; a crashed run is taken over after its lease expires', async () => {
  const t = await newTenant('Charlie');
  const { job } = await createJob(t.id);
  const m = await masterDb();

  // Another run holds a live lease.
  await m.collection('provisioning_jobs').updateOne(
    { id: job.id },
    { $set: { status: 'running', lockedUntil: new Date(Date.now() + 60_000).toISOString() } }
  );
  const blocked = await call(H.jobRun, { method: 'POST', params: { id: job.id } });
  assert.equal(blocked.status, 409, 'second run is refused while the lease is live');
  assert.match(blocked.json.message, /already running/);

  // The first run crashed in the middle of 'apply_branding': lease expired, step left 'running'.
  await m.collection('provisioning_jobs').updateOne(
    { id: job.id },
    {
      $set: {
        lockedUntil: new Date(Date.now() - 1000).toISOString(),
        'steps.$[s].status': 'running',
      },
    },
    { arrayFilters: [{ 's.key': 'apply_branding' }] }
  );
  const resumed = await call(H.jobRun, { method: 'POST', params: { id: job.id } });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.json));
  assert.equal(resumed.json.job.status, 'succeeded');
  assert.equal(resumed.json.job.steps.find((s: any) => s.key === 'apply_branding').status, 'skipped', 'interrupted step was re-run');
});

test('a database that belongs to another tenant is refused before anything is written', async () => {
  const t = await newTenant('Delta');
  const db = await getTenantDatabase(t);
  await db.collection('tenant_meta').insertOne({ _id: 'tenant', tenantId: 'tenant_someone_else', slug: 'other', dbName: t.dbName });

  const { job } = await createJob(t.id);
  const run = await call(H.jobRun, { method: 'POST', params: { id: job.id } });
  assert.equal(run.status, 500);
  const step = run.json.job.steps.find((s: any) => s.status === 'failed');
  assert.equal(step.key, 'provision_database');
  assert.match(step.error, /different tenant/);
  assert.equal(run.json.job.steps.find((s: any) => s.key === 'apply_migrations').status, 'pending', 'no migrations ran on a foreign database');
  assert.equal(await db.collection('tenant_migrations').countDocuments({}), 0);
});

test('owner invite: token is returned once, only its hash is stored, and the job never exposes it', async () => {
  const t = await newTenant('Echo');
  const { job, inviteToken } = await createJob(t.id, { adminEmail: 'Owner@Echo.test' });

  // While the job is active, a repeated request returns the same job and no new token.
  const again = await createJob(t.id, { adminEmail: 'Owner@Echo.test' });
  assert.equal(again.created, false);
  assert.equal(again.job.id, job.id);
  assert.equal(again.inviteToken, undefined);
  assert.ok(inviteToken && inviteToken.length >= 32, 'token returned on creation');
  assert.ok(!JSON.stringify(job).includes(inviteToken), 'job response does not contain the token');
  assert.equal(job.input.inviteTokenHash, undefined, 'hash is not returned to the browser either');

  const stored = await (await masterDb()).collection('provisioning_jobs').findOne({ id: job.id });
  assert.equal(stored.input.inviteTokenHash, sha256Hex(inviteToken), 'only the hash is stored');
  assert.ok(!JSON.stringify(stored).includes(inviteToken), 'plain token is not stored anywhere in the job');

  const run = await call(H.jobRun, { method: 'POST', params: { id: job.id } });
  assert.equal(run.json.job.steps.find((s: any) => s.key === 'invite_admin').status, 'succeeded');
  const db = await getTenantDatabase(t);
  const owner = await db.collection('users').findOne({ role: 'owner' });
  assert.equal(owner.email, 'owner@echo.test');
  assert.equal(owner.inviteTokenHash, sha256Hex(inviteToken), 'owner record has the matching hash');
  assert.equal(owner.passwordHash, null, 'no password is set by the control plane');

});

test('abandon releases a failed job without deleting data, and a new job can then start', async () => {
  const t = await newTenant('Foxtrot');
  const { job } = await createJob(t.id);
  setStepFault('verify', () => {
    throw new Error('verification failed on purpose');
  });
  const failed = await call(H.jobRun, { method: 'POST', params: { id: job.id } });
  setStepFault('verify', null);
  assert.equal(failed.json.job.status, 'failed');

  const db = await getTenantDatabase(t);
  const collectionsBefore = (await db.listCollections().toArray()).length;

  const abandoned = await call(H.jobAbandon, { method: 'POST', params: { id: job.id } });
  assert.equal(abandoned.status, 200);
  assert.equal(abandoned.json.job.status, 'abandoned');
  assert.equal(abandoned.json.job.active, false);
  assert.match(abandoned.json.message, /Nothing was deleted/);
  assert.equal((await db.listCollections().toArray()).length, collectionsBefore, 'no collections were dropped');
  assert.equal(await (await masterDb()).collection('tenants').countDocuments({ id: t.id }), 1, 'tenant record kept');

  const cannot = await call(H.jobAbandon, { method: 'POST', params: { id: job.id } });
  assert.equal(cannot.status, 400, 'an abandoned job cannot be abandoned again');

  const fresh = await createJob(t.id);
  assert.equal(fresh.created, true, 'a new job can start after abandon');
  assert.notEqual(fresh.job.id, job.id);
});

test('reseed re-runs migrations without duplicating records or overwriting tenant changes', async () => {
  slugCounter += 1;
  const created = await call(H.clientsPost, {
    method: 'POST',
    body: { name: `Golf Reseed ${slugCounter}`, slug: `golfreseed${slugCounter}`, supportEmail: `ops@golf${slugCounter}.test`, autoProvision: true },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const client = created.json.client;
  assert.equal(created.json.provisioning.success, true);

  const db = await getTenantDatabase(client);
  await db.collection('settings').updateOne({ _singleton: true }, { $set: { currency: 'USD' } });

  const again = await call(H.provision, { method: 'POST', params: { id: client.id } });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal((await db.collection('settings').findOne({ _singleton: true })).currency, 'USD', 'tenant change kept');
  assert.equal(await db.collection('tenant_migrations').countDocuments({}), 2, 'no duplicate migration records');
  assert.equal(await db.collection('users').countDocuments({ role: 'owner' }), 1);
});

// A minimal valid PNG header followed by padding. Only the magic bytes are checked for PNG.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);
const SAFE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#10B981"/></svg>');

function upload(kind: string, bytes: Buffer, name = 'logo.bin') {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', new File([new Uint8Array(bytes)], name));
  return form;
}

test('logo upload: the file bytes decide the type; unsafe or spoofed files are refused', async () => {
  const t = await newTenant('Hotel');

  const script = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const onload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"></svg>');
  const external = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/x.png"/></svg>');
  const doctype = Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>');
  const notImage = Buffer.from('MZ\x90\x00 this is an executable, not an image');

  const cases: [string, Buffer, RegExp][] = [
    ['logo', script, /Active SVG elements/],
    ['logo', onload, /Event handler/],
    ['logo', external, /External references/],
    ['logo', doctype, /DOCTYPE/],
    ['logo', notImage, /Unsupported file/],
    ['logo', Buffer.alloc(0), /empty/],
    ['logo', Buffer.alloc(600 * 1024, 0x41), /512 KB/],
    ['favicon', Buffer.alloc(200 * 1024, 0x41), /128 KB/],
  ];
  for (const [kind, bytes, expected] of cases) {
    const r = await callForm(H.assetsPost, { id: t.id }, upload(kind, bytes));
    assert.equal(r.status, 400, `refused: ${expected}`);
    assert.match(r.json.message, expected);
  }

  // A PNG renamed to .svg is stored as PNG, not as SVG.
  const renamed = await callForm(H.assetsPost, { id: t.id }, upload('logo', PNG, 'evil.svg'));
  assert.equal(renamed.status, 201);
  assert.equal(renamed.json.asset.mime, 'image/png', 'type comes from the bytes, not the file name');

  // A file with an image type name but SVG-breaking content is refused.
  const bad = await callForm(H.assetsPost, { id: t.id }, upload('logo', Buffer.from('<svg><script>x</script></svg>'), 'ok.png'));
  assert.equal(bad.status, 400);

  // Wrong kind is refused.
  const wrongKind = await callForm(H.assetsPost, { id: t.id }, upload('banner', SAFE_SVG));
  assert.equal(wrongKind.status, 400);

  // Nothing unsafe was stored.
  const listed = await call(H.assetsGet, { params: { id: t.id } });
  assert.equal(listed.json.assets.length, 1, 'only the one valid upload is stored');
  assert.ok(!JSON.stringify(listed.json).includes('"data"'), 'listing never includes file bytes');
});

test('logo is versioned, applied by provisioning, and served publicly with safe headers', async () => {
  const t = await newTenant('India');

  const v1 = await callForm(H.assetsPost, { id: t.id }, upload('logo', SAFE_SVG, 'logo.svg'));
  assert.equal(v1.status, 201);
  assert.equal(v1.json.asset.version, 1);
  assert.equal(v1.json.asset.mime, 'image/svg+xml');

  const v2 = await callForm(H.assetsPost, { id: t.id }, upload('logo', PNG, 'logo.png'));
  assert.equal(v2.json.asset.version, 2, 'second upload is a new version');

  const listed = await call(H.assetsGet, { params: { id: t.id } });
  assert.deepEqual(listed.json.assets.map((a: any) => a.version), [2, 1], 'previous version is kept');

  const job = await createJob(t.id);
  const run = await call(H.jobRun, { method: 'POST', params: { id: job.job.id } });
  assert.equal(run.json.job.status, 'succeeded');
  assert.equal(run.json.job.steps.find((s: any) => s.key === 'apply_branding').status, 'succeeded');
  const reg = await (await masterDb()).collection('tenants').findOne({ id: t.id });
  assert.equal(reg.branding.logoUrl, `/api/tenant-assets/${t.id}/logo?v=2`, 'registry points at the latest version');

  // Public read: latest version only, no session needed, safe headers.
  const pub = await call(H.publicAsset, { cookie: null, params: { tenantId: t.id, kind: 'logo' } });
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('content-type'), 'image/png', 'served as the stored type');
  assert.equal(pub.headers.get('x-content-type-options'), 'nosniff');
  assert.match(pub.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.ok(pub.text.startsWith('\u0089PNG') || pub.text.includes('PNG'), 'bytes are the uploaded PNG');

  const badKind = await call(H.publicAsset, { cookie: null, params: { tenantId: t.id, kind: 'banner' } });
  assert.equal(badKind.status, 404);
  const none = await call(H.publicAsset, { cookie: null, params: { tenantId: t.id, kind: 'favicon' } });
  assert.equal(none.status, 404, 'no favicon uploaded, so none is served');
});

test('control-plane job and asset routes stay closed without a session', async () => {
  const t = await newTenant('Kilo');
  const jobs = await call(H.jobsPost, { method: 'POST', body: { tenantId: t.id }, cookie: null });
  assert.equal(jobs.status, 401);
  const upload401 = await callForm(H.assetsPost, { id: t.id }, upload('logo', SAFE_SVG), null);
  assert.equal(upload401.status, 401, 'asset upload needs a session');
});
