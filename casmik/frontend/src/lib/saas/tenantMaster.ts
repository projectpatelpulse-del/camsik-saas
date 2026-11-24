import { Db } from 'mongodb';
import { getClientPromise } from '../mongodb';
import { Tenant } from './types';

/**
 * READ-ONLY view of the SaaS tenant registry for the public storefront and tenant-facing APIs.
 * All tenant creation, updates, deletion and provisioning are owned by the Super Admin control plane
 * (super_admin/). Do not add write functions here.
 */

const MASTER_DB_NAME = process.env.MONGODB_MASTER_DB || 'casmik_saas_platform';
const TENANTS_COLLECTION = 'tenants';

/** Fields safe to expose publicly. Subscription internals, domains and database names are excluded. */
const PUBLIC_PROJECTION = { _id: 0, id: 1, name: 1, slug: 1, status: 1, templateId: 1, branding: 1, features: 1 } as const;

export async function getMasterDatabase(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(MASTER_DB_NAME);
}

export async function getAllTenants(): Promise<Partial<Tenant>[]> {
  const db = await getMasterDatabase();
  return db
    .collection(TENANTS_COLLECTION)
    .find({ status: { $in: ['active', 'trial'] } }, { projection: PUBLIC_PROJECTION })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray() as unknown as Partial<Tenant>[];
}

/**
 * Looks up a tenant by id or slug. Returns the full record INCLUDING dbName, for server-side reads
 * only. Never return this object to the browser as-is.
 */
export async function getTenantBySlugOrId(key: string): Promise<Tenant | null> {
  const k = (key || '').trim().toLowerCase();
  if (!k || k.length > 64) return null;
  const db = await getMasterDatabase();
  const doc = await db
    .collection(TENANTS_COLLECTION)
    .findOne({ $or: [{ id: k }, { slug: k }] }, { projection: { _id: 0 } });
  return (doc as unknown as Tenant) ?? null;
}
