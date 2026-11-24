import { getTenantBySlugOrId } from '@/lib/tenantMaster';
import { createImpersonationSession, requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

const PORTAL_BASE = process.env.TENANT_PORTAL_URL || 'http://localhost:3000/admin';

/**
 * Starts an impersonation session for a tenant's administrator.
 * - Requires an authenticated super admin; the audit row records the real actor.
 * - Token is valid 30 minutes, bound to this tenant, and returned once (only its hash is stored).
 * - It is placed in the URL fragment so it is not sent to servers or written to access logs.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const client = await getTenantBySlugOrId(id);
    if (!client) return fail('Client not found', 404);
    if (client.status === 'suspended' || client.status === 'inactive') {
      return fail('Cannot impersonate a suspended or inactive client', 409);
    }

    const ctx = requestContext(request);
    const { token, expiresAt } = await createImpersonationSession(auth.actor, client.id, ctx);
    await recordAudit({
      action: 'tenant.impersonate',
      actor: auth.actor,
      tenantId: client.id,
      tenantSlug: client.slug,
      ctx,
      meta: { expiresAt },
    });

    return ok({
      message: `Impersonation session started for '${client.name}'`,
      expiresAt,
      portalUrl: `${PORTAL_BASE}?tenant=${encodeURIComponent(client.slug)}#impersonation=${token}`,
    });
  } catch (e) {
    return errorResponse(e, 'clients.impersonate');
  }
}
