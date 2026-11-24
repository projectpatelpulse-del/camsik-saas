import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok } from '@/lib/http';
import { assetUrl, isAssetKind, listTenantAssets, storeTenantAsset } from '@/lib/tenantAssets';
import { getMasterDatabase, getTenantBySlugOrId } from '@/lib/tenantMaster';
import { ValidationError } from '@/lib/security/validation';

export const dynamic = 'force-dynamic';

// Upper bound for the whole multipart body, checked before it is read into memory.
const MAX_BODY_BYTES = 700 * 1024;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    return ok({ assets: await listTenantAssets(id) });
  } catch (e) {
    return errorResponse(e, 'assets.list');
  }
}

/** Uploads a new version of the logo or favicon. Form fields: `kind` (logo | favicon) and `file`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;

    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return fail('Upload is too large', 413);

    const tenant = await getTenantBySlugOrId(id);
    if (!tenant) return fail('Client not found', 404);

    const form = await request.formData();
    const kind = form.get('kind');
    const file = form.get('file');
    if (!isAssetKind(kind)) throw new ValidationError('kind must be logo or favicon', { kind: 'invalid' });
    if (!(file instanceof File)) throw new ValidationError('A file is required', { file: 'missing' });

    const bytes = Buffer.from(await file.arrayBuffer());
    const record = await storeTenantAsset(tenant.id, kind, bytes, auth.actor.email);

    // Point the registry at the new version now; the provisioning run re-syncs it too.
    const urlField = kind === 'logo' ? 'branding.logoUrl' : 'branding.faviconUrl';
    const db = await getMasterDatabase();
    await db.collection('tenants').updateOne(
      { id: tenant.id },
      { $set: { [urlField]: assetUrl(tenant.id, kind, record.version), updatedAt: new Date().toISOString() } }
    );

    await recordAudit({
      action: 'tenant.asset_upload',
      actor: auth.actor,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      ctx: requestContext(request),
      meta: { kind, version: record.version, sha256: record.sha256, sizeBytes: record.sizeBytes },
    });
    return ok({ asset: record, url: assetUrl(tenant.id, kind, record.version) }, 201);
  } catch (e) {
    return errorResponse(e, 'assets.upload');
  }
}
