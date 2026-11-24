import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok, readJson } from '@/lib/http';
import { listJobs, startOrGetJob } from '@/lib/provisioningJobs';
import { randomToken, sha256Hex } from '@/lib/security/crypto';
import { validateEmail, ValidationError } from '@/lib/security/validation';
import { getTenantBySlugOrId } from '@/lib/tenantMaster';

export const dynamic = 'force-dynamic';

/** Recent provisioning jobs, optionally for one tenant. */
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const tenantId = new URL(request.url).searchParams.get('tenantId') || undefined;
    return ok({ jobs: await listJobs(tenantId, 20) });
  } catch (e) {
    return errorResponse(e, 'provisioning.list');
  }
}

/**
 * Creates the tenant's provisioning job, or returns the active one. Does not run any step: the client
 * then calls /run and polls the job. The owner invite token is returned only when a new job is created.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const ctx = requestContext(request);
    const body = await readJson(request);

    const tenantKey = typeof body.tenantId === 'string' ? body.tenantId : '';
    if (!tenantKey) return fail('tenantId is required', 400);
    const tenant = await getTenantBySlugOrId(tenantKey);
    if (!tenant) return fail('Client not found', 404);

    const adminEmail = typeof body.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : '';
    if (adminEmail && !validateEmail(adminEmail)) throw new ValidationError('Owner email is not valid', { adminEmail: 'invalid' });

    const inviteToken = adminEmail ? randomToken(24) : undefined;
    const { job, created } = await startOrGetJob(tenant.id, {
      adminEmail: adminEmail || undefined,
      adminName: typeof body.adminName === 'string' ? body.adminName.slice(0, 120) : undefined,
      inviteTokenHash: inviteToken ? sha256Hex(inviteToken) : undefined,
      inviteExpiresAt: inviteToken ? new Date(Date.now() + 72 * 3600 * 1000).toISOString() : undefined,
      reseed: body.reseed === true,
      createdBy: auth.actor.email,
    });

    if (created) {
      await recordAudit({
        action: 'provisioning.job_create',
        actor: auth.actor,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        ctx,
        meta: { jobId: job.id },
      });
    }
    return ok({
      job,
      created,
      inviteToken: created && inviteToken ? inviteToken : undefined,
      inviteNote: created && inviteToken ? 'Shown once. Send it to the owner securely; it expires in 72 hours.' : undefined,
    }, created ? 201 : 200);
  } catch (e) {
    return errorResponse(e, 'provisioning.create');
  }
}
