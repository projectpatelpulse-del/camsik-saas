import { NextResponse } from 'next/server';
import { getAllTenants, createTenant, getTenantBySlugOrId, setTenantFields } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, readJson } from '@/lib/http';
import { runProvisioning } from '@/lib/provisioning';
import { randomToken, sha256Hex } from '@/lib/security/crypto';
import { sanitizeBranding, validateEmail, ValidationError } from '@/lib/security/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const clients = await getAllTenants();
    return NextResponse.json({ success: true, clients, total: clients.length, timestamp: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e, 'clients.list');
  }
}

/**
 * Creates a tenant, optionally invites its owner, and provisions its database.
 * The invite token is returned once; only its SHA-256 hash is stored.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const ctx = requestContext(request);
    const body = await readJson(request);

    const adminEmail = typeof body.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : '';
    if (adminEmail && !validateEmail(adminEmail)) throw new ValidationError('Owner email is not valid', { adminEmail: 'invalid' });

    // Validate branding before creating anything, so a bad colour does not leave a half-made tenant.
    const brandingPatch = body.branding !== undefined ? sanitizeBranding(body.branding) : undefined;

    const tenant = await createTenant(body);
    if (brandingPatch) {
      await setTenantFields(tenant.id, { branding: { ...tenant.branding, ...brandingPatch } });
    }
    await recordAudit({
      action: 'tenant.create',
      actor: auth.actor,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      ctx,
      meta: { name: tenant.name, dbName: tenant.dbName },
    });

    let inviteToken: string | undefined;
    let adminDetails: { email: string; name?: string; inviteTokenHash?: string; inviteExpiresAt?: string } | undefined;
    if (adminEmail) {
      inviteToken = randomToken(24);
      adminDetails = {
        email: adminEmail,
        name: typeof body.adminName === 'string' ? body.adminName.slice(0, 120) : undefined,
        inviteTokenHash: sha256Hex(inviteToken),
        inviteExpiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      };
    }

    let provisioning = null;
    if (body.autoProvision !== false) {
      provisioning = await runProvisioning(tenant, adminDetails, { actorEmail: auth.actor.email });
      await recordAudit({
        action: provisioning.success ? 'tenant.provision' : 'tenant.provision_failed',
        actor: auth.actor,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        ctx,
        meta: { message: provisioning.message },
      });
    }

    const fresh = (await getTenantBySlugOrId(tenant.id)) ?? tenant;
    return NextResponse.json(
      {
        success: true,
        message: `Client '${tenant.name}' created${provisioning?.success ? ` with dedicated database '${tenant.dbName}'` : ''}.`,
        client: fresh,
        provisioning,
        inviteToken,
        inviteNote: inviteToken ? 'Shown once. Send it to the owner securely; it expires in 72 hours.' : undefined,
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e, 'clients.create');
  }
}
