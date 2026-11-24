import { createTenant, getTenantBySlugOrId, setTenantFields } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok, readJson } from '@/lib/http';
import { runProvisioning } from '@/lib/provisioning';
import { normalizeSlug } from '@/lib/security/validation';
import { randomToken } from '@/lib/security/crypto';

export const dynamic = 'force-dynamic';

/**
 * Copies a tenant's branding, features and template into a new trial tenant with its own database.
 * Content (catalog, orders, users) is NOT copied: a duplicate starts with a fresh database.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const source = await getTenantBySlugOrId(id);
    if (!source) return fail('Source client not found', 404);

    const body = await readJson(request).catch(() => ({} as Record<string, unknown>));
    const newName = typeof body.newName === 'string' && body.newName.trim()
      ? body.newName.trim()
      : `${source.name} (Copy)`;
    const newSlug = typeof body.newSlug === 'string' && body.newSlug.trim()
      ? normalizeSlug(body.newSlug)
      : `${normalizeSlug(source.slug).slice(0, 22)}-copy-${randomToken(3).replace(/[^a-z0-9]/gi, 'x').toLowerCase()}`;

    const copy = await createTenant({
      name: newName,
      slug: newSlug,
      templateId: source.templateId,
      supportEmail: source.branding.supportEmail,
      branding: { brandName: newName, tagline: source.branding.tagline, supportPhone: source.branding.supportPhone },
    });

    await setTenantFields(copy.id, {
      branding: { ...source.branding, brandName: newName },
      features: { ...source.features },
      subscription: { ...source.subscription, status: 'trial', plan: source.subscription.plan },
      status: 'trial',
    });

    const ctx = requestContext(request);
    await recordAudit({
      action: 'tenant.duplicate',
      actor: auth.actor,
      tenantId: copy.id,
      tenantSlug: copy.slug,
      ctx,
      meta: { sourceTenantId: source.id, sourceSlug: source.slug },
    });

    const provisioning = await runProvisioning(copy, undefined, { actorEmail: auth.actor.email });
    return ok({
      message: `Client duplicated as '${newName}'`,
      client: await getTenantBySlugOrId(copy.id),
      provisioning,
    }, 201);
  } catch (e) {
    return errorResponse(e, 'clients.duplicate');
  }
}
