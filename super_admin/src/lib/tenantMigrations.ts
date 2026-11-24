import type { Tenant } from './types';
import { getTenantDatabase, provisionTenantDatabase } from './tenantDb';

/**
 * Versioned migrations for each tenant database. Applied versions are recorded in the tenant's
 * `tenant_migrations` collection, so a re-run skips anything already applied.
 *
 * Every migration must be safe to run twice. A reseed run (explicit operator action) re-runs all
 * migrations on purpose, and relies on that idempotence.
 */

export interface AdminDetails {
  email: string;
  name?: string;
  inviteTokenHash?: string;
  inviteExpiresAt?: string;
}

export interface MigrationContext {
  adminDetails?: AdminDetails;
  reseed: boolean;
}

export interface Migration {
  version: number;
  name: string;
  up(tenant: Tenant, ctx: MigrationContext): Promise<{ seeded?: Record<string, number> } | void>;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'base_schema_and_seed_catalog',
    async up(tenant, ctx) {
      // Existing seeding logic: upserts and $setOnInsert only, so tenant-changed values are kept.
      const result = await provisionTenantDatabase(tenant, ctx.adminDetails);
      if (!result.success) throw new Error(result.message);
      return { seeded: result.seeded };
    },
  },
  {
    version: 2,
    name: 'users_email_index',
    async up(tenant) {
      // Non-unique on purpose: existing tenant data is not checked for duplicates before migrating.
      const db = await getTenantDatabase(tenant);
      await db.collection('users').createIndex({ email: 1 });
    },
  },
];

export interface MigrationRunResult {
  applied: number[];
  skipped: number[];
  seeded: Record<string, number>;
}

export async function runPendingMigrations(tenant: Tenant, opts: { adminDetails?: AdminDetails; reseed?: boolean }): Promise<MigrationRunResult> {
  const db = await getTenantDatabase(tenant);
  const records = db.collection('tenant_migrations');
  await records.createIndex({ version: 1 }, { unique: true });

  const done = new Set((await records.find({}, { projection: { version: 1 } }).toArray()).map((d) => Number(d.version)));
  const result: MigrationRunResult = { applied: [], skipped: [], seeded: {} };
  const ctx: MigrationContext = { adminDetails: opts.adminDetails, reseed: !!opts.reseed };

  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version) && !ctx.reseed) {
      result.skipped.push(m.version);
      continue;
    }
    const out = await m.up(tenant, ctx);
    if (out && 'seeded' in out && out.seeded) result.seeded = { ...result.seeded, ...out.seeded };
    await records.updateOne(
      { version: m.version },
      { $set: { name: m.name, appliedAt: new Date().toISOString() } },
      { upsert: true }
    );
    result.applied.push(m.version);
  }
  return result;
}
