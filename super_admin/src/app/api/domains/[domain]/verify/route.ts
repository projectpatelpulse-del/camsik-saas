import { getMasterDatabase, setTenantFields } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok } from '@/lib/http';
import { normalizeDomain } from '@/lib/security/validation';
import { checkDomain } from '@/lib/security/domainVerify';
import { systemDnsResolver } from '@/lib/security/dnsResolver';

export const dynamic = 'force-dynamic';

/**
 * Checks live DNS for a registered domain. "verified" requires BOTH the TXT ownership record and the
 * routing record. SSL is reported as "pending": certificate issuance is a provider integration step
 * and is not claimed as active here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ domain: string }> }) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { domain: raw } = await params;
    const domain = normalizeDomain(decodeURIComponent(raw));

    const db = await getMasterDatabase();
    const record = await db.collection('domains').findOne({ domain });
    if (!record) return fail('Domain not registered', 404);

    const apexIps = (process.env.PLATFORM_APEX_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cnameTarget = process.env.PLATFORM_CNAME_TARGET;
    if (!cnameTarget) return fail('PLATFORM_CNAME_TARGET is not configured on the server', 500);

    const check = await checkDomain(
      { domain, txtToken: record.txtToken, cnameTarget, apexIps },
      systemDnsResolver
    );
    const verified = check.ownershipVerified && check.routingVerified;
    const now = new Date().toISOString();

    await db.collection('domains').updateOne(
      { domain },
      {
        $set: {
          status: verified ? 'verified' : 'pending_dns',
          sslStatus: 'pending',
          verifiedAt: verified ? now : null,
          diagnostics: check.diagnostics,
          lastCheckedAt: now,
        },
      }
    );

    if (verified && record.isPrimary) {
      await setTenantFields(record.tenantId, { customDomain: domain });
    }

    await recordAudit({
      action: 'domain.verify',
      actor: auth.actor,
      tenantId: record.tenantId,
      tenantSlug: record.tenantSlug,
      ctx: requestContext(request),
      meta: { domain, verified },
    });

    return ok({
      domain,
      verified,
      status: verified ? 'verified' : 'pending_dns',
      sslStatus: 'pending',
      ownershipVerified: check.ownershipVerified,
      routingVerified: check.routingVerified,
      diagnostics: check.diagnostics,
    });
  } catch (e) {
    return errorResponse(e, 'domains.verify');
  }
}
