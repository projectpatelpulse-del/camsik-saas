import { getMasterDatabase, getTenantBySlugOrId } from '@/lib/tenantMaster';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok, readJson } from '@/lib/http';
import { PANEL_TYPES, ValidationError } from '@/lib/security/validation';

export const dynamic = 'force-dynamic';

const ANDROID_TYPES = ['debug_apk', 'release_apk', 'aab'] as const;
const IOS_TYPES = ['ipa'] as const;

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const tenantId = new URL(request.url).searchParams.get('tenantId');
    const builds = await (await getMasterDatabase())
      .collection('build_jobs')
      .find(tenantId ? { tenantId } : {}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return ok({ builds, total: builds.length });
  } catch (e) {
    return errorResponse(e, 'builds.list');
  }
}

/**
 * Queues a build job. Nothing is compiled here: no build worker is connected yet, so the job stays
 * `queued` and carries no artifact. A job is never reported as completed without an artifact.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const ctx = requestContext(request);
    const body = await readJson(request);

    const tenantKey = typeof body.tenantId === 'string' ? body.tenantId : '';
    const panelType = typeof body.panelType === 'string' ? body.panelType : '';
    if (!tenantKey || !panelType) return fail('tenantId and panelType are required', 400);
    if (!PANEL_TYPES.includes(panelType as any)) throw new ValidationError('Unknown panel type', { panelType: 'unknown' });

    const platform = panelType.endsWith('_ios') ? 'ios' : 'android';
    const buildType = typeof body.buildType === 'string' ? body.buildType : platform === 'ios' ? 'ipa' : 'release_apk';
    const allowed: readonly string[] = platform === 'ios' ? IOS_TYPES : ANDROID_TYPES;
    if (!allowed.includes(buildType)) throw new ValidationError(`Build type '${buildType}' is not valid for ${platform}`, { buildType: 'invalid' });

    const versionName = typeof body.versionName === 'string' && /^\d+(\.\d+){0,2}$/.test(body.versionName) ? body.versionName : '1.0.0';
    const versionCode = Number.isInteger(body.versionCode) && (body.versionCode as number) > 0 ? (body.versionCode as number) : 1;

    const tenant = await getTenantBySlugOrId(tenantKey);
    if (!tenant) return fail('Tenant not found', 404);

    const entitled = platform === 'ios' ? tenant.subscription.iosBuildEnabled : tenant.subscription.androidBuildEnabled;
    if (!entitled) return fail(`This client's plan does not include ${platform === 'ios' ? 'iOS' : 'Android'} builds`, 403);

    const job = {
      id: `bld_${crypto.randomUUID()}`,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      panelType,
      platform,
      buildType,
      versionName,
      versionCode,
      appId: `in.camsik.${tenant.slug.replace(/[^a-z0-9]/g, '')}.${panelType.replace(/_(android|ios|web)$/, '')}`,
      appName: tenant.branding.brandName || tenant.name,
      status: 'queued' as const,
      artifactUrl: null,
      artifactSizeMb: null,
      buildLogs: [`[${new Date().toISOString()}] Queued. No build worker is connected for this platform yet.`],
      createdAt: new Date().toISOString(),
      completedAt: null,
      createdBy: auth.actor.email,
    };

    await (await getMasterDatabase()).collection('build_jobs').insertOne(job);
    await recordAudit({ action: 'build.enqueue', actor: auth.actor, tenantId: tenant.id, tenantSlug: tenant.slug, ctx, meta: { jobId: job.id, panelType, buildType } });

    return ok({ message: `Build job queued for ${panelType} (${buildType})`, build: job }, 201);
  } catch (e) {
    return errorResponse(e, 'builds.create');
  }
}
