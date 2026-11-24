import { getMasterDatabase, getTenantBySlugOrId } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok, readJson } from '@/lib/http';
import { normalizeDomain, validateDomain, ValidationError } from '@/lib/security/validation';
import { randomToken } from '@/lib/security/crypto';
import { requiredDnsRecords } from '@/lib/security/domainVerify';

export const dynamic = 'force-dynamic';

function platformConfig() {
  const cnameTarget = process.env.PLATFORM_CNAME_TARGET;
  if (!cnameTarget) throw new Error('PLATFORM_CNAME_TARGET is not set');
  return {
    cnameTarget,
    apexIps: (process.env.PLATFORM_APEX_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
    baseDomain: (process.env.PLATFORM_BASE_DOMAIN || '').toLowerCase(),
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const tenantId = new URL(request.url).searchParams.get('tenantId');
    const query = tenantId ? { tenantId } : {};
    const domains = await (await getMasterDatabase())
      .collection('domains')
      .find(query, { projection: { txtToken: 0 } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    return ok({ domains, total: domains.length });
  } catch (e) {
    return errorResponse(e, 'domains.list');
  }
}

/**
 * Registers a custom domain for a tenant and returns the DNS records the owner must create.
 * A domain can belong to only one tenant; it must be removed from the previous tenant first.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const ctx = requestContext(request);
    const body = await readJson(request);
    const tenantKey = typeof body.tenantId === 'string' ? body.tenantId : '';
    const domain = typeof body.domain === 'string' ? normalizeDomain(body.domain) : '';
    if (!tenantKey || !domain) return fail('tenantId and domain are required', 400);

    const domainError = validateDomain(domain);
    if (domainError) throw new ValidationError(domainError, { domain: domainError });

    const cfg = platformConfig();
    if (cfg.baseDomain && (domain === cfg.baseDomain || domain.endsWith(`.${cfg.baseDomain}`))) {
      return fail('Platform subdomains are provisioned automatically and cannot be registered here', 400);
    }

    const tenant = await getTenantBySlugOrId(tenantKey);
    if (!tenant) return fail('Tenant not found', 404);
    if (!tenant.subscription.customDomainEnabled) {
      return fail("This client's plan does not include custom domains", 403);
    }

    const db = await getMasterDatabase();
    const used = await db.collection('domains').countDocuments({ tenantId: tenant.id });
    const limit = tenant.subscription.maxCustomDomains ?? 1;
    if (used >= limit) return fail(`Domain limit reached (${limit} for this plan)`, 403);

    const txtToken = `camsik-verify-${randomToken(18)}`;
    const record = {
      id: `dom_${randomToken(9)}`,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      domain,
      isCustom: true,
      isPrimary: used === 0,
      status: 'pending_dns' as const,
      sslStatus: 'pending' as const,
      txtToken,
      dnsRecords: requiredDnsRecords({ domain, txtToken, cnameTarget: cfg.cnameTarget, apexIps: cfg.apexIps }),
      createdAt: new Date().toISOString(),
      verifiedAt: null,
      diagnostics: [] as string[],
    };

    try {
      await db.collection('domains').insertOne(record);
    } catch (e: any) {
      if (e?.code === 11000) return fail(`'${domain}' is already registered to another client`, 409);
      throw e;
    }

    await recordAudit({ action: 'domain.register', actor: auth.actor, tenantId: tenant.id, tenantSlug: tenant.slug, ctx, meta: { domain } });
    const { txtToken: _omit, ...publicRecord } = record;
    return ok({
      message: `Domain '${domain}' registered. Add the DNS records below, then verify.`,
      domain: publicRecord,
    }, 201);
  } catch (e) {
    return errorResponse(e, 'domains.create');
  }
}
