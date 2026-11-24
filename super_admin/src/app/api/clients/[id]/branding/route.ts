import { getMasterDatabase, getTenantBySlugOrId, setTenantFields } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok, readJson } from '@/lib/http';
import { AVAILABLE_TEMPLATES } from '@/lib/templates';
import { sanitizeBranding, ValidationError } from '@/lib/security/validation';
import type { Tenant } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Branding Studio persistence.
 *   GET    → current draft, published version number, version history
 *   PUT    → save a draft (not visible to the tenant's apps until published)
 *   POST   → { action: 'publish' }  or  { action: 'rollback', version: n }
 * Versions are append-only: publishing and rolling back both create a new version record.
 */

async function versionsCol() {
  return (await getMasterDatabase()).collection('theme_versions');
}

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const tenant = await getTenantBySlugOrId(id);
    if (!tenant) return fail('Client not found', 404);

    const history = await (await versionsCol())
      .find({ tenantId: tenant.id }, { projection: { _id: 0, branding: 0 } })
      .sort({ version: -1 })
      .limit(100)
      .toArray();

    return ok({
      draft: (tenant as any).brandingDraft ?? null,
      publishedVersion: (tenant as any).brandingVersion ?? 0,
      templateId: tenant.templateId,
      versions: history,
    });
  } catch (e) {
    return errorResponse(e, 'branding.get');
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const tenant = await getTenantBySlugOrId(id);
    if (!tenant) return fail('Client not found', 404);

    const body = await readJson(request);
    const draft: Record<string, unknown> = {};
    if (body.branding !== undefined) draft.branding = sanitizeBranding(body.branding);
    if (body.templateId !== undefined) {
      if (typeof body.templateId !== 'string' || !AVAILABLE_TEMPLATES.some((t) => t.id === body.templateId)) {
        throw new ValidationError('Unknown theme', { templateId: 'unknown' });
      }
      draft.templateId = body.templateId;
    }
    if (Object.keys(draft).length === 0) throw new ValidationError('Nothing to save');
    draft.savedAt = new Date().toISOString();

    await setTenantFields(tenant.id, { brandingDraft: draft } as Partial<Tenant>);
    await recordAudit({
      action: 'branding.draft_save',
      actor: auth.actor,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      ctx: requestContext(request),
      meta: { keys: Object.keys(draft) },
    });
    return ok({ draft });
  } catch (e) {
    return errorResponse(e, 'branding.save');
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const tenant = await getTenantBySlugOrId(id);
    if (!tenant) return fail('Client not found', 404);

    const body = await readJson(request);
    const ctx = requestContext(request);
    const current = (tenant as any).brandingVersion ?? 0;
    const col = await versionsCol();

    if (body.action === 'publish') {
      const draft = (tenant as any).brandingDraft as { branding?: Partial<Tenant['branding']>; templateId?: string } | null;
      if (!draft || (!draft.branding && !draft.templateId)) return fail('No draft to publish', 409);

      const branding = { ...tenant.branding, ...(draft.branding ?? {}) };
      const templateId = draft.templateId ?? tenant.templateId;
      const version = current + 1;
      await col.insertOne({
        tenantId: tenant.id,
        version,
        branding,
        templateId,
        note: typeof body.note === 'string' ? body.note.slice(0, 200) : null,
        createdBy: auth.actor.email,
        createdAt: new Date().toISOString(),
        source: 'publish',
      });
      await setTenantFields(tenant.id, { branding, templateId, brandingVersion: version, brandingDraft: null } as Partial<Tenant>);
      await recordAudit({ action: 'branding.publish', actor: auth.actor, tenantId: tenant.id, tenantSlug: tenant.slug, ctx, meta: { version } });
      return ok({ message: `Published version ${version}`, version });
    }

    if (body.action === 'rollback') {
      const target = Number(body.version);
      if (!Number.isInteger(target) || target < 1) throw new ValidationError('version must be a positive integer');
      const snapshot = await col.findOne({ tenantId: tenant.id, version: target });
      if (!snapshot) return fail(`Version ${target} does not exist`, 404);

      const version = current + 1;
      await col.insertOne({
        tenantId: tenant.id,
        version,
        branding: snapshot.branding,
        templateId: snapshot.templateId,
        note: `Rollback to version ${target}`,
        createdBy: auth.actor.email,
        createdAt: new Date().toISOString(),
        source: 'rollback',
      });
      await setTenantFields(tenant.id, {
        branding: snapshot.branding,
        templateId: snapshot.templateId,
        brandingVersion: version,
      } as Partial<Tenant>);
      await recordAudit({ action: 'branding.rollback', actor: auth.actor, tenantId: tenant.id, tenantSlug: tenant.slug, ctx, meta: { to: target, version } });
      return ok({ message: `Rolled back to version ${target} (now version ${version})`, version });
    }

    throw new ValidationError("action must be 'publish' or 'rollback'");
  } catch (e) {
    return errorResponse(e, 'branding.action');
  }
}
