import type { Tenant } from './types';
import { getTenantDatabaseStatus } from './tenantDb';
import { startOrGetJob, runJob, type ProvisioningJob } from './provisioningJobs';
import type { AdminDetails } from './tenantMigrations';

/**
 * Provisions a tenant through its step-based job. Creates the job if none is active, then runs it from
 * the first unfinished step. Safe to call again: a completed tenant gets a no-op run, and a failed job
 * resumes where it stopped.
 */
export async function runProvisioning(
  tenant: Tenant,
  adminDetails?: AdminDetails,
  opts: { reseed?: boolean; actorEmail?: string } = {}
): Promise<{
  success: boolean;
  message: string;
  seeded: Record<string, number>;
  database: Awaited<ReturnType<typeof getTenantDatabaseStatus>>;
  job: ProvisioningJob;
}> {
  const { job: created } = await startOrGetJob(tenant.id, {
    adminEmail: adminDetails?.email,
    adminName: adminDetails?.name,
    inviteTokenHash: adminDetails?.inviteTokenHash,
    inviteExpiresAt: adminDetails?.inviteExpiresAt,
    reseed: opts.reseed,
    createdBy: opts.actorEmail ?? 'system',
  });
  const { job, ran } = await runJob(created.id);
  const success = job.status === 'succeeded';
  const failed = job.steps.find((s) => s.status === 'failed');
  const message = success
    ? `Dedicated database '${tenant.dbName}' provisioned and verified.`
    : !ran
      ? 'Provisioning is already running for this client.'
      : `Provisioning stopped at '${failed?.label ?? 'unknown step'}': ${failed?.error ?? job.lastError ?? 'unknown error'}`;
  const database = await getTenantDatabaseStatus(tenant);
  return { success, message, seeded: job.seeded, database, job };
}
