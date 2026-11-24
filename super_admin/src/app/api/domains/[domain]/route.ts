import { getMasterDatabase, setTenantFields } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok } from '@/lib/http';
import { normalizeDomain } from '@/lib/security/validation';

export const dynamic = 'force-dynamic';

/** Removes a domain registration. Frees it so another client can register it. */
export async function DELETE(request: Request, { params }: { params: Promise<{ domain: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { domain: raw } = await params;
    const domain = normalizeDomain(decodeURIComponent(raw));

    const db = await getMasterDatabase();
    const record = await db.collection('domains').findOne({ domain });
    if (!record) return fail('Domain not registered', 404);

    await recordAudit({
      action: 'domain.remove',
      actor: auth.actor,
      tenantId: record.tenantId,
      tenantSlug: record.tenantSlug,
      ctx: requestContext(request),
      meta: { domain, wasVerified: record.status === 'verified' || record.status === 'active' },
    });
    await db.collection('domains').deleteOne({ domain });

    if (record.isPrimary) await setTenantFields(record.tenantId, { customDomain: null } as any);
    return ok({ message: `Domain '${domain}' removed` });
  } catch (e) {
    return errorResponse(e, 'domains.remove');
  }
}
