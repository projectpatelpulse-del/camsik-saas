import { Db } from 'mongodb';
import { getClientPromise } from './mongodb';
import { Tenant } from './types';
import { AVAILABLE_TEMPLATES } from './templates';
import { DEMO_TENANTS } from './demoTenants';
import { dbNameForSlug, validateNewTenant, sanitizeTenantUpdate } from './security/validation';

/**
 * Master (control-plane) database access. MongoDB only: no in-memory fallback, so a failed write
 * is reported instead of silently showing data that was never saved.
 */

const MASTER_DB_NAME = process.env.MONGODB_MASTER_DB || 'casmik_saas_platform';
const TENANTS_COLLECTION = 'tenants';

export class ConflictError extends Error {}
export class NotFoundError extends Error {}

let indexesPromise: Promise<void> | null = null;

export async function getMasterDatabase(): Promise<Db> {
  const client = await getClientPromise();
  const db = client.db(MASTER_DB_NAME);
  if (!indexesPromise) {
    indexesPromise = ensureMasterIndexes(db).catch((err) => {
      indexesPromise = null; // retry on next request
      throw err;
    });
  }
  await indexesPromise;
  return db;
}

async function ensureMasterIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection(TENANTS_COLLECTION).createIndex({ id: 1 }, { unique: true }),
    db.collection(TENANTS_COLLECTION).createIndex({ slug: 1 }, { unique: true }),
    db.collection(TENANTS_COLLECTION).createIndex({ dbName: 1 }, { unique: true }),
    db.collection('domains').createIndex({ domain: 1 }, { unique: true }),
    db.collection('domains').createIndex({ tenantId: 1 }),
    db.collection('super_admins').createIndex({ email: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('theme_versions').createIndex({ tenantId: 1, version: 1 }, { unique: true }),
    db.collection('saas_audit_logs').createIndex({ createdAt: -1 }),
    db.collection('build_jobs').createIndex({ tenantId: 1, createdAt: -1 }),
  ]);

  // Demo tenants are opt-in for local development only.
  if (process.env.SEED_DEMO_TENANTS === 'true') {
    for (const t of DEMO_TENANTS) {
      await db.collection(TENANTS_COLLECTION).updateOne({ id: t.id }, { $setOnInsert: t }, { upsert: true });
    }
  }
}

function withId<T extends { id?: string; _id?: unknown }>(doc: T): T {
  const { _id, ...rest } = doc as T & { _id?: unknown };
  return rest as T;
}

export async function getAllTenants(): Promise<Tenant[]> {
  const db = await getMasterDatabase();
  const docs = await db.collection<Tenant>(TENANTS_COLLECTION).find({}).sort({ createdAt: -1 }).limit(500).toArray();
  return docs.map((d) => withId(d as Tenant));
}

/** Looks up by tenant id or slug only. Domains and database names are NOT accepted as identifiers. */
export async function getTenantBySlugOrId(key: string): Promise<Tenant | null> {
  const k = (key || '').trim().toLowerCase();
  if (!k || k.length > 64) return null;
  const db = await getMasterDatabase();
  const doc = await db.collection<Tenant>(TENANTS_COLLECTION).findOne({ $or: [{ id: k }, { slug: k }] });
  return doc ? withId(doc as Tenant) : null;
}

export async function createTenant(input: unknown): Promise<Tenant> {
  const v = validateNewTenant(input);
  const body = input as Record<string, any>;
  const templateId = v.templateId && AVAILABLE_TEMPLATES.some((t) => t.id === v.templateId)
    ? v.templateId
    : AVAILABLE_TEMPLATES[0].id;

  const now = new Date().toISOString();
  const tenant: Tenant = {
    id: `tenant_${crypto.randomUUID()}`,
    name: v.name,
    slug: v.slug,
    dbName: dbNameForSlug(v.slug),
    status: 'trial',
    templateId,
    branding: {
      brandName: (body.branding?.brandName as string) || v.name,
      tagline: (body.branding?.tagline as string) || 'Sell & Exchange Used Electronics Instantly',
      logoUrl: '/images/default-logo.svg',
      faviconUrl: '/favicon.ico',
      primaryColor: '#10B981',
      secondaryColor: '#0F172A',
      accentColor: '#3B82F6',
      supportEmail: v.supportEmail,
      supportPhone: (body.branding?.supportPhone as string) || '',
      address: (body.branding?.address as string) || '',
      currency: (body.branding?.currency as string) || 'INR',
      currencySymbol: '₹',
      timeZone: (body.branding?.timeZone as string) || 'Asia/Kolkata',
      country: (body.branding?.country as string) || 'India',
    },
    features: {
      buyback: true,
      refurbished: true,
      rentals: false,
      repairs: true,
      exchange: true,
    },
    subscription: {
      plan: 'free_trial',
      status: 'trial',
      validUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
      trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      maxOrdersPerMonth: 200,
      customDomainEnabled: false,
      priceMonthly: 0,
    },
    dbProvisioned: false,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getMasterDatabase();
  try {
    await db.collection<Tenant>(TENANTS_COLLECTION).insertOne(tenant as any);
  } catch (e: any) {
    if (e?.code === 11000) throw new ConflictError(`Slug '${v.slug}' is already taken`);
    throw e;
  }
  return tenant;
}

export async function updateTenant(id: string, updates: Partial<Tenant> | Record<string, unknown>): Promise<Tenant | null> {
  const db = await getMasterDatabase();
  const safe = sanitizeTenantUpdate(updates);
  const doc = await db.collection<Tenant>(TENANTS_COLLECTION).findOneAndUpdate(
    { id },
    { $set: { ...safe, updatedAt: new Date().toISOString() } },
    { returnDocument: 'after' }
  );
  return doc ? withId(doc as Tenant) : null;
}

/** Internal updates that bypass the public allowlist (provisioning state, branding versions, domains). */
export async function setTenantFields(id: string, fields: Partial<Tenant>): Promise<void> {
  const db = await getMasterDatabase();
  await db.collection<Tenant>(TENANTS_COLLECTION).updateOne(
    { id },
    { $set: { ...fields, updatedAt: new Date().toISOString() } }
  );
}

export async function deleteTenant(id: string): Promise<boolean> {
  const db = await getMasterDatabase();
  const res = await db.collection(TENANTS_COLLECTION).deleteOne({ id });
  return res.deletedCount === 1;
}
