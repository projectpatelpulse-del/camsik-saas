import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok } from '@/lib/http';
import { runJob } from '@/lib/provisioningJobs';
import { getTenantBySlugOrId } from '@/lib/tenantMaster';

export const dynamic = 'force-dynamic';

/**
 * Runs or resumes a job from its first unfinished step. This is also the retry action: a failed step
 * is run again, and completed steps are not repeated.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const ctx = requestContext(request);

    const { job, ran } = await runJob(id);
    if (!ran) {
      return fail(
        job.status === 'succeeded' || job.status === 'abandoned'
          ? `Job is already ${job.status}`
          : 'Provisioning is already running for this client',
        409
      );
    }

    const tenant = await getTenantBySlugOrId(job.tenantId);
    const succeeded = job.status === 'succeeded';
    await recordAudit({
      action: succeeded ? 'provisioning.job_succeeded' : 'provisioning.job_failed',
      actor: auth.actor,
      tenantId: job.tenantId,
      tenantSlug: tenant?.slug ?? job.tenantSlug,
      ctx,
      meta: { jobId: job.id, attempts: job.attempts, error: job.lastError },
    });

    const failedStep = job.steps.find((s) => s.status === 'failed');
    return new Response(
      JSON.stringify({
        success: succeeded,
        message: succeeded
          ? 'Provisioning completed and verified.'
          : `Stopped at '${failedStep?.label ?? 'unknown step'}': ${failedStep?.error ?? job.lastError ?? 'unknown error'}`,
        job,
      }),
      { status: succeeded ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return errorResponse(e, 'provisioning.run');
  }
}
