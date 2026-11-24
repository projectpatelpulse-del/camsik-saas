import { getTenantBySlugOrId } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail } from '@/lib/http';
import { runProvisioning } from '@/lib/provisioning';

export const dynamic = 'force-dynamic';

/** Retry or re-run provisioning. Idempotent: existing data is kept, missing pieces are seeded. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const client = await getTenantBySlugOrId(id);
    if (!client) return fail('Client not found', 404);

    const result = await runProvisioning(client, undefined, { reseed: true, actorEmail: auth.actor.email });
    await recordAudit({
      action: result.success ? 'tenant.provision' : 'tenant.provision_failed',
      actor: auth.actor,
      tenantId: client.id,
      tenantSlug: client.slug,
      ctx: requestContext(request),
      meta: { message: result.message },
    });

    return new Response(
      JSON.stringify({ success: result.success, message: result.message, seeded: result.seeded, database: result.database }),
      { status: result.success ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return errorResponse(e, 'clients.provision');
  }
}
