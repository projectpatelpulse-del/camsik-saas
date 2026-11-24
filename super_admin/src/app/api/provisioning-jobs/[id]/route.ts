import { requireAdmin } from '@/lib/auth';
import { errorResponse, fail, ok } from '@/lib/http';
import { getJob } from '@/lib/provisioningJobs';

export const dynamic = 'force-dynamic';

/** Current state of one job. The client polls this while a run is in progress. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const job = await getJob(id);
    if (!job) return fail('Provisioning job not found', 404);
    return ok({ job });
  } catch (e) {
    return errorResponse(e, 'provisioning.get');
  }
}
