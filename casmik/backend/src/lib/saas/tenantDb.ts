import { Db } from 'mongodb';
import { getClientPromise } from '../mongodb';
import { Tenant } from './types';

/**
 * READ-ONLY access to tenant databases for storefront reads and health checks.
 * Provisioning lives in super_admin/. Database names are validated against the tenant pattern so a
 * caller cannot point this at an arbitrary database.
 */

const TENANT_DB_RE = /^casmik_tenant_[a-z0-9_]{3,40}$/;

export async function getTenantDatabase(tenantOrDbName: Pick<Tenant, 'dbName'> | string): Promise<Db> {
  const dbName = typeof tenantOrDbName === 'string' ? tenantOrDbName : tenantOrDbName.dbName;
  if (!TENANT_DB_RE.test(dbName)) throw new Error(`Refusing to open non-tenant database '${dbName}'`);
  const client = await getClientPromise();
  return client.db(dbName);
}

export async function getTenantDatabaseStatus(tenant: Pick<Tenant, 'dbName'>): Promise<{
  connected: boolean;
  collections: { name: string; count: number }[];
  error?: string;
}> {
  try {
    const db = await getTenantDatabase(tenant);
    await db.command({ ping: 1 });
    const collections = await db.listCollections().toArray();
    const stats: { name: string; count: number }[] = [];
    for (const col of collections) {
      stats.push({ name: col.name, count: await db.collection(col.name).estimatedDocumentCount() });
    }
    return { connected: true, collections: stats };
  } catch (error: any) {
    return { connected: false, collections: [], error: error?.message || 'Database connection error' };
  }
}
