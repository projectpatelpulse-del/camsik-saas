import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, ok } from '@/lib/http';
import { abandonJob } from '@/lib/provisioningJobs';

export const dynamic = 'force-dynamic';

/**
 * Rollback option. Releases the active job so a new one can be started. Nothing is deleted: the tenant
 * record and any database already created are kept for review. Destructive cleanup is a separate,
 * typed action on the client page.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const job = await abandonJob(id);
    await recordAudit({
      action: 'provisioning.job_abandoned',
      actor: auth.actor,
      tenantId: job.tenantId,
      tenantSlug: job.tenantSlug,
      ctx: requestContext(request),
      meta: { jobId: job.id, lastError: job.lastError },
    });
    return ok({ job, message: 'Job abandoned. Nothing was deleted.' });
  } catch (e) {
    return errorResponse(e, 'provisioning.abandon');
  }
}
