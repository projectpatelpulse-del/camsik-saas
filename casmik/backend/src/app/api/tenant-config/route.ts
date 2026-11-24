import { NextResponse } from 'next/server';
import { getTenantBySlugOrId, getTenantByHost } from '@/lib/saas/tenantMaster';
import { getTemplateById } from '@/lib/saas/templates';
import { toPublicTenantConfig } from '@/lib/saas/publicConfig';

export const dynamic = 'force-dynamic';

/**
 * Public tenant configuration for the Flutter apps and web panels.
 *
 * Resolution order:
 *   1. A verified custom domain matching the request host.
 *   2. The `tenant` query parameter (slug or id), used by the apps built for a specific tenant.
 *
 * Only whitelisted fields are returned (see lib/saas/publicConfig.ts). Suspended, inactive and
 * expired tenants return 404 so their storefront and apps go dark.
 */
const LIVE_STATUSES = new Set(['active', 'trial']);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const host = request.headers.get('host') ?? '';

    let tenant = await getTenantByHost(host);
    if (!tenant) {
      const key = url.searchParams.get('tenant')?.trim();
      if (key && key.length <= 64) tenant = await getTenantBySlugOrId(key);
    }

    if (!tenant || !LIVE_STATUSES.has(tenant.status)) {
      return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    }

    const version = Number((tenant as { brandingVersion?: number }).brandingVersion ?? 0);
    const config = toPublicTenantConfig(tenant, getTemplateById(tenant.templateId), version);
    return NextResponse.json(
      { success: true, config },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } }
    );
  } catch (error) {
    console.error('[tenant-config]', error);
    return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
  }
}
