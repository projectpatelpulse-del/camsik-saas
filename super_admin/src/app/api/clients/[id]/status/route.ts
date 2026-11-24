import { getTenantBySlugOrId, updateTenant } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok, readJson } from '@/lib/http';
import { TENANT_STATUSES } from '@/lib/security/validation';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const client = await getTenantBySlugOrId(id);
    if (!client) return fail('Client not found', 404);

    const body = await readJson(request);
    const status = body.status;
    if (typeof status !== 'string' || !TENANT_STATUSES.includes(status as any)) {
      return fail(`Status must be one of: ${TENANT_STATUSES.join(', ')}`, 400);
    }

    const updated = await updateTenant(client.id, { status: status as any });
    await recordAudit({
      action: 'tenant.status',
      actor: auth.actor,
      tenantId: client.id,
      tenantSlug: client.slug,
      ctx: requestContext(request),
      meta: { from: client.status, to: status },
    });
    return ok({ message: `Tenant status updated to '${status}'`, client: updated });
  } catch (e) {
    return errorResponse(e, 'clients.status');
  }
}
