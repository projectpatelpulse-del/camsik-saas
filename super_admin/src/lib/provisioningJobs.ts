import { getMasterDatabase, getTenantBySlugOrId, setTenantFields, NotFoundError } from './tenantMaster';
import type { Tenant } from './types';
import { getTenantDatabase } from './tenantDb';
import { isValidTenantDbName, ValidationError } from './security/validation';
import { AVAILABLE_TEMPLATES } from './templates';
import { assetUrl, getCurrentAssetFile } from './tenantAssets';
import { MIGRATIONS, runPendingMigrations } from './tenantMigrations';

/**
 * Step-based provisioning jobs.
 *
 * - One job per tenant at a time (partial unique index on `active: true`).
 * - Steps run in order. A step is recorded as succeeded or skipped only after its real operation returns.
 * - A failed step stops the job and keeps the error. Running the job again resumes at the first step
 *   that is not succeeded or skipped. Every step is idempotent, so a resumed step cannot duplicate data.
 * - A run takes a lease (lockedUntil). A crashed run leaves an expired lease, which the next run takes over.
 * - Abandon releases the job without deleting anything. Destructive cleanup stays a separate, typed action.
 */

export const STEP_DEFS = [
  { key: 'create_tenant', label: 'Creating tenant record' },
  { key: 'provision_database', label: 'Provisioning isolated database' },
  { key: 'apply_migrations', label: 'Applying database migrations' },
  { key: 'create_storage_namespace', label: 'Creating storage namespace' },
  { key: 'invite_admin', label: 'Creating owner invitation' },
  { key: 'apply_branding', label: 'Applying branding and assets' },
  { key: 'apply_template', label: 'Applying template' },
  { key: 'configure_domains', label: 'Configuring domains' },
  { key: 'prepare_web', label: 'Preparing web deployment' },
  { key: 'prepare_mobile', label: 'Preparing mobile applications' },
  { key: 'verify', label: 'Verifying tenant configuration' },
] as const;

export type StepKey = (typeof STEP_DEFS)[number]['key'];
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'skipped' | 'failed';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'abandoned';

export interface JobStep {
  key: StepKey;
  label: string;
  status: StepStatus;
  detail: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ProvisioningJob {
  id: string;
  tenantId: string;
  tenantSlug: string;
  status: JobStatus;
  active: boolean;
  steps: JobStep[];
  input: {
    adminEmail?: string;
    adminName?: string;
    inviteTokenHash?: string;
    inviteExpiresAt?: string;
    reseed?: boolean;
  };
  seeded: Record<string, number>;
  attempts: number;
  lockedUntil: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

const LEASE_MS = 120_000;
const JOBS = 'provisioning_jobs';

/* ---------- Fault injection (tests only) ---------- */

const faults = new Map<StepKey, () => void>();

/**
 * Lets tests make a step fail on purpose to exercise resume. Not reachable over HTTP; the map is
 * empty unless a test sets it.
 */
export function setStepFaultForTesting(key: StepKey, fn: (() => void) | null): void {
  if (fn) faults.set(key, fn);
  else faults.delete(key);
}

/* ---------- Step handlers ---------- */

interface StepContext {
  tenant: Tenant;
  job: ProvisioningJob;
  seeded: Record<string, number>;
}

type StepOutcome = { status: 'succeeded' | 'skipped'; detail: string };

const handlers: Record<StepKey, (ctx: StepContext) => Promise<StepOutcome>> = {
  async create_tenant({ tenant }) {
    const fresh = await getTenantBySlugOrId(tenant.id);
    if (!fresh) throw new NotFoundError('Tenant record is missing from the registry');
    return { status: 'succeeded', detail: `Registry record ${fresh.id} found` };
  },

  async provision_database({ tenant }) {
    if (!isValidTenantDbName(tenant.dbName)) throw new Error(`Invalid tenant database name '${tenant.dbName}'`);
    const db = await getTenantDatabase(tenant);
    await db.command({ ping: 1 });
    // The marker ties this database to exactly one tenant. Re-running keeps the marker unchanged.
    await db.collection('tenant_meta').updateOne(
      { _id: 'tenant' as any },
      { $setOnInsert: { tenantId: tenant.id, slug: tenant.slug, dbName: tenant.dbName, createdAt: new Date().toISOString() } },
      { upsert: true }
    );
    const marker = await db.collection('tenant_meta').findOne({ _id: 'tenant' as any });
    if (!marker || marker.tenantId !== tenant.id) {
      throw new Error('This database belongs to a different tenant. Refusing to use it.');
    }
    return { status: 'succeeded', detail: `Database ${tenant.dbName} reachable; ownership marker verified` };
  },

  async apply_migrations({ tenant, job, seeded }) {
    const result = await runPendingMigrations(tenant, {
      adminDetails: job.input.adminEmail
        ? { email: job.input.adminEmail, name: job.input.adminName, inviteTokenHash: job.input.inviteTokenHash, inviteExpiresAt: job.input.inviteExpiresAt }
        : undefined,
      reseed: job.input.reseed,
    });
    Object.assign(seeded, result.seeded);
    return {
      status: 'succeeded',
      detail: `Applied ${result.applied.length} migration(s): [${result.applied.join(', ') || 'none'}]; already applied: [${result.skipped.join(', ') || 'none'}]`,
    };
  },

  async create_storage_namespace({ tenant }) {
    const db = await getMasterDatabase();
    const namespace = `tenants/${tenant.slug}`;
    await db.collection('tenant_storage').updateOne(
      { tenantId: tenant.id },
      { $setOnInsert: { tenantId: tenant.id, namespace, createdAt: new Date().toISOString() } },
      { upsert: true }
    );
    const row = await db.collection('tenant_storage').findOne({ tenantId: tenant.id });
    if (!row || row.namespace !== namespace) throw new Error('Storage namespace could not be verified');
    return { status: 'succeeded', detail: `Namespace ${namespace}` };
  },

  async invite_admin({ tenant, job }) {
    const email = job.input.adminEmail;
    const db = await getTenantDatabase(tenant);
    const owners = db.collection('users');
    if (!email) {
      return { status: 'skipped', detail: 'No owner email supplied. The owner can be invited later.' };
    }
    const owner = await owners.findOne({ tenantId: tenant.id, role: 'owner', email: email.toLowerCase() });
    if (owner) return { status: 'succeeded', detail: `Owner ${owner.email} invited (status: ${owner.status})` };
    const anyOwner = await owners.findOne({ tenantId: tenant.id, role: 'owner' });
    if (anyOwner) {
      return { status: 'skipped', detail: 'Tenant already has an owner. Its invitation was not changed.' };
    }
    throw new Error('Owner invitation was not created');
  },

  async apply_branding({ tenant }) {
    const logo = await getCurrentAssetFile(tenant.id, 'logo');
    const favicon = await getCurrentAssetFile(tenant.id, 'favicon');
    if (!logo && !favicon) {
      return { status: 'skipped', detail: 'No logo or favicon uploaded. Default branding kept.' };
    }
    const patch: Record<string, string> = {};
    if (logo) patch['branding.logoUrl'] = assetUrl(tenant.id, 'logo', logo.version);
    if (favicon) patch['branding.faviconUrl'] = assetUrl(tenant.id, 'favicon', favicon.version);

    const master = await getMasterDatabase();
    await master.collection('tenants').updateOne({ id: tenant.id }, { $set: { ...patch, updatedAt: new Date().toISOString() } });
    const db = await getTenantDatabase(tenant);
    await db.collection('settings').updateOne({ _singleton: true }, { $set: patch }, { upsert: true });

    const check = await master.collection('tenants').findOne({ id: tenant.id });
    if (logo && check?.branding?.logoUrl !== patch['branding.logoUrl']) throw new Error('Logo URL did not persist');
    return {
      status: 'succeeded',
      detail: [logo && `logo v${logo.version}`, favicon && `favicon v${favicon.version}`].filter(Boolean).join(', ') + ' applied',
    };
  },

  async apply_template({ tenant }) {
    const template = AVAILABLE_TEMPLATES.find((t) => t.id === tenant.templateId);
    if (!template) throw new Error(`Template '${tenant.templateId}' is not in the catalogue`);
    const db = await getTenantDatabase(tenant);
    await db.collection('settings').updateOne({ _singleton: true }, { $set: { templateId: template.id } }, { upsert: true });
    const check = await db.collection('settings').findOne({ _singleton: true });
    if (check?.templateId !== template.id) throw new Error('Template assignment did not persist');
    return { status: 'succeeded', detail: `${template.name} (${template.id})` };
  },

  async configure_domains({ tenant }) {
    const root = process.env.PLATFORM_ROOT_DOMAIN || 'camsik.com';
    const defaultDomain = `${tenant.slug}.${root}`;
    const master = await getMasterDatabase();
    await master.collection('tenants').updateOne({ id: tenant.id }, { $set: { defaultDomain, updatedAt: new Date().toISOString() } });
    return {
      status: 'succeeded',
      detail: `Default domain ${defaultDomain} recorded. DNS and SSL are configured in Phase 6, not here.`,
    };
  },

  async prepare_web() {
    return { status: 'skipped', detail: 'Web deployment pipeline is not built yet (Phase 7). Nothing was deployed.' };
  },

  async prepare_mobile() {
    return { status: 'skipped', detail: 'Mobile build pipeline is not built yet (Phases 8 and 9). No artifacts were produced.' };
  },

  async verify({ tenant }) {
    const db = await getTenantDatabase(tenant);
    await db.command({ ping: 1 });

    const names = (await db.listCollections().toArray()).map((c) => c.name);
    const required = ['settings', 'categories', 'brands', 'models', 'questions', 'roles', 'users', 'orders', 'partners', 'delivery_agents', 'cms_sections', 'tenant_meta', 'tenant_migrations'];
    const missing = required.filter((n) => !names.includes(n));
    if (missing.length) throw new Error(`Missing collections: ${missing.join(', ')}`);

    const orderIndexes = (await db.collection('orders').indexes()).map((i) => i.name);
    if (!orderIndexes.includes('status_1')) throw new Error('Required index orders.status is missing');

    const marker = await db.collection('tenant_meta').findOne({ _id: 'tenant' as any });
    if (marker?.tenantId !== tenant.id) throw new Error('Ownership marker does not match this tenant');

    const master = await getMasterDatabase();
    const sameDbName = await master.collection('tenants').countDocuments({ dbName: tenant.dbName });
    if (sameDbName !== 1) throw new Error(`Database name is shared by ${sameDbName} tenants`);

    const applied = await db.collection('tenant_migrations').countDocuments({});
    if (applied < MIGRATIONS.length) throw new Error(`Only ${applied} of ${MIGRATIONS.length} migrations recorded`);

    const row = await master.collection('tenants').findOne({ id: tenant.id });
    if (!row?.dbProvisioned) throw new Error('Registry does not show the database as provisioned');

    return { status: 'succeeded', detail: `${names.length} collections, ${applied} migrations, isolation checks passed` };
  },
};

/* ---------- Persistence helpers ---------- */

let indexesReady: Promise<void> | null = null;

async function ensureJobIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      const db = await getMasterDatabase();
      await db.collection(JOBS).createIndex({ id: 1 }, { unique: true });
      // At most one active job per tenant. A failed job stays active until retried or abandoned.
      await db.collection(JOBS).createIndex(
        { tenantId: 1 },
        { unique: true, partialFilterExpression: { active: true } }
      );
      await db.collection('tenant_storage').createIndex({ tenantId: 1 }, { unique: true });
      await db.collection('tenant_assets').createIndex({ tenantId: 1, kind: 1, version: 1 }, { unique: true });
    })().catch((err) => {
      indexesReady = null;
      throw err;
    });
  }
  return indexesReady;
}

function initialSteps(): JobStep[] {
  return STEP_DEFS.map((s) => ({ key: s.key, label: s.label, status: 'pending', detail: null, error: null, startedAt: null, finishedAt: null }));
}

function nowIso() {
  return new Date().toISOString();
}

export interface StartJobInput {
  adminEmail?: string;
  adminName?: string;
  inviteTokenHash?: string;
  inviteExpiresAt?: string;
  reseed?: boolean;
  createdBy: string;
}

/**
 * Returns the tenant's active job, or creates one. Creating never runs any step.
 * Calling this twice returns the same job, so a retried HTTP request cannot create a second run.
 */
export async function startOrGetJob(tenantKey: string, input: StartJobInput): Promise<{ job: ProvisioningJob; created: boolean }> {
  await ensureJobIndexes();
  const db = await getMasterDatabase();
  const tenant = await getTenantBySlugOrId(tenantKey);
  if (!tenant) throw new NotFoundError('Client not found');

  const existing = (await db.collection(JOBS).findOne({ tenantId: tenant.id, active: true })) as unknown as ProvisioningJob | null;
  if (existing) return { job: strip(existing), created: false };

  const ts = nowIso();
  const job: ProvisioningJob = {
    id: `prov_${crypto.randomUUID()}`,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    status: 'queued',
    active: true,
    steps: initialSteps(),
    input: {
      adminEmail: input.adminEmail?.trim().toLowerCase() || undefined,
      adminName: input.adminName,
      inviteTokenHash: input.inviteTokenHash,
      inviteExpiresAt: input.inviteExpiresAt,
      reseed: !!input.reseed,
    },
    seeded: {},
    attempts: 0,
    lockedUntil: null,
    lastError: null,
    createdBy: input.createdBy,
    createdAt: ts,
    updatedAt: ts,
    finishedAt: null,
  };

  try {
    await db.collection(JOBS).insertOne(job as any);
  } catch (e: any) {
    if (e?.code === 11000) {
      const again = (await db.collection(JOBS).findOne({ tenantId: tenant.id, active: true })) as unknown as ProvisioningJob | null;
      if (again) return { job: strip(again), created: false };
    }
    throw e;
  }
  return { job: strip(job), created: true };
}

export async function getJob(id: string): Promise<ProvisioningJob | null> {
  await ensureJobIndexes();
  const db = await getMasterDatabase();
  const doc = await db.collection(JOBS).findOne({ id });
  return doc ? strip(doc as unknown as ProvisioningJob) : null;
}

export async function listJobs(tenantKey?: string, limit = 20): Promise<ProvisioningJob[]> {
  await ensureJobIndexes();
  const db = await getMasterDatabase();
  let filter: Record<string, unknown> = {};
  if (tenantKey) {
    const tenant = await getTenantBySlugOrId(tenantKey);
    if (!tenant) throw new NotFoundError('Client not found');
    filter = { tenantId: tenant.id };
  }
  const docs = await db.collection(JOBS).find(filter).sort({ createdAt: -1 }).limit(Math.min(limit, 100)).toArray();
  return docs.map((d) => strip(d as unknown as ProvisioningJob));
}

function strip(doc: ProvisioningJob): ProvisioningJob {
  const { _id, ...rest } = doc as ProvisioningJob & { _id?: unknown };
  // The invite hash is an internal value, never returned to the browser.
  const input = { ...rest.input };
  delete input.inviteTokenHash;
  return { ...rest, input };
}

async function setStepFields(jobId: string, key: StepKey, fields: Partial<JobStep>) {
  const db = await getMasterDatabase();
  const $set: Record<string, unknown> = { updatedAt: nowIso() };
  for (const [k, v] of Object.entries(fields)) $set[`steps.$[s].${k}`] = v;
  await db.collection(JOBS).updateOne({ id: jobId }, { $set }, { arrayFilters: [{ 's.key': key }] });
}

/**
 * Runs the job from its first unfinished step. Returns `ran: false` when another run holds the lease,
 * or when the job is no longer active.
 */
export async function runJob(jobId: string): Promise<{ job: ProvisioningJob; ran: boolean }> {
  await ensureJobIndexes();
  const db = await getMasterDatabase();
  const col = db.collection(JOBS);
  const nowMs = Date.now();
  const nowStr = new Date(nowMs).toISOString();

  // Take the lease atomically. Only one run can hold it at a time.
  const leased = (await col.findOneAndUpdate(
    {
      id: jobId,
      active: true,
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: nowStr } }],
    },
    {
      $set: { status: 'running', lockedUntil: new Date(nowMs + LEASE_MS).toISOString(), updatedAt: nowStr },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after' }
  )) as unknown as ProvisioningJob | null;

  if (!leased) {
    const current = await getJob(jobId);
    if (!current) throw new NotFoundError('Provisioning job not found');
    return { job: current, ran: false };
  }

  // Internal copy: keeps inviteTokenHash, which the owner account needs. Never returned to callers.
  const job = leased;
  const tenant = await getTenantBySlugOrId(job.tenantId);
  if (!tenant) {
    await finishWithError(jobId, 'Tenant record is missing from the registry');
    return { job: (await getJob(jobId))!, ran: true };
  }

  const seeded: Record<string, number> = { ...job.seeded };
  const ctx: StepContext = { tenant, job, seeded };

  for (const def of STEP_DEFS) {
    const step = job.steps.find((s) => s.key === def.key);
    if (step && (step.status === 'succeeded' || step.status === 'skipped')) continue;

    await setStepFields(jobId, def.key, { status: 'running', error: null, startedAt: nowIso(), finishedAt: null });
    try {
      const fault = faults.get(def.key);
      if (fault) fault();
      const outcome = await handlers[def.key](ctx);
      await setStepFields(jobId, def.key, { status: outcome.status, detail: outcome.detail, error: null, finishedAt: nowIso() });
    } catch (err: any) {
      const message = typeof err?.message === 'string' ? err.message : String(err);
      await setStepFields(jobId, def.key, { status: 'failed', error: message, finishedAt: nowIso() });
      await finishWithError(jobId, message, seeded);
      await setTenantFields(tenant.id, {
        provisioning: { status: 'failed', startedAt: job.createdAt, finishedAt: nowIso(), error: message, seeded } as any,
      });
      return { job: (await getJob(jobId))!, ran: true };
    }
  }

  const finished = nowIso();
  await col.updateOne(
    { id: jobId },
    { $set: { status: 'succeeded', active: false, lockedUntil: null, lastError: null, seeded, finishedAt: finished, updatedAt: finished } }
  );
  await setTenantFields(tenant.id, {
    provisioning: { status: 'completed', startedAt: job.createdAt, finishedAt: finished, error: null, seeded } as any,
  });
  return { job: (await getJob(jobId))!, ran: true };
}

async function finishWithError(jobId: string, message: string, seeded?: Record<string, number>) {
  const db = await getMasterDatabase();
  const ts = nowIso();
  const $set: Record<string, unknown> = { status: 'failed', lockedUntil: null, lastError: message, updatedAt: ts };
  if (seeded) $set.seeded = seeded;
  await db.collection(JOBS).updateOne({ id: jobId }, { $set });
}

/**
 * Releases a job that will not be retried. Nothing is deleted: the tenant record and any database
 * already created remain, and the owner can start a new job later.
 */
export async function abandonJob(jobId: string): Promise<ProvisioningJob> {
  const db = await getMasterDatabase();
  const nowStr = nowIso();
  const res = await db.collection(JOBS).findOneAndUpdate(
    {
      id: jobId,
      active: true,
      status: { $ne: 'running' },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: nowStr } }],
    },
    { $set: { status: 'abandoned', active: false, lockedUntil: null, finishedAt: nowStr, updatedAt: nowStr } },
    { returnDocument: 'after' }
  );
  if (!res) {
    const current = await getJob(jobId);
    if (!current) throw new NotFoundError('Provisioning job not found');
    throw new ValidationError(
      current.active ? 'Job is running right now. Wait for it to finish before abandoning.' : `Job is already ${current.status}`,
      { job: 'not_abandonable' }
    );
  }
  return strip(res as unknown as ProvisioningJob);
}

