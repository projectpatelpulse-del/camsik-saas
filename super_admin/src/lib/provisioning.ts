import type { Tenant } from './types';
import { provisionTenantDatabase, getTenantDatabaseStatus } from './tenantDb';
import { setTenantFields } from './tenantMaster';

/**
 * Runs tenant database provisioning and records the outcome on the tenant document, so the UI can
 * show status, the error, and offer retry. Failures are recorded, not swallowed.
 */
export async function runProvisioning(
  tenant: Tenant,
  adminDetails?: { email: string; name?: string; inviteTokenHash?: string; inviteExpiresAt?: string }
) {
  const startedAt = new Date().toISOString();
  await setTenantFields(tenant.id, { provisioning: { status: 'running', startedAt } as any });

  const result = await provisionTenantDatabase(tenant, adminDetails);
  const finishedAt = new Date().toISOString();
  await setTenantFields(tenant.id, {
    provisioning: {
      status: result.success ? 'completed' : 'failed',
      startedAt,
      finishedAt,
      error: result.success ? null : result.message,
      seeded: result.seeded,
    } as any,
  });

  const database = await getTenantDatabaseStatus(tenant);
  return { success: result.success, message: result.message, seeded: result.seeded, database };
}
