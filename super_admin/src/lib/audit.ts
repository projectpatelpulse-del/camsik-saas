import { getMasterDatabase } from './tenantMaster';
import type { AdminActor, RequestContext } from './auth';

/**
 * Audit trail for every control-plane action that changes state or touches a tenant.
 * A failed audit write throws, so the action fails rather than running unlogged.
 */
export interface AuditEntry {
  action: string;
  actor: AdminActor;
  tenantId?: string;
  tenantSlug?: string;
  ctx?: RequestContext;
  meta?: Record<string, unknown>;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const db = await getMasterDatabase();
  await db.collection('saas_audit_logs').insertOne({
    action: entry.action,
    actorId: entry.actor.id,
    actorEmail: entry.actor.email,
    tenantId: entry.tenantId ?? null,
    tenantSlug: entry.tenantSlug ?? null,
    ip: entry.ctx?.ip ?? null,
    userAgent: entry.ctx?.userAgent ?? null,
    meta: entry.meta ?? {},
    createdAt: new Date(),
  });
}

export async function listAudit(limit = 100, tenantId?: string) {
  const db = await getMasterDatabase();
  return db
    .collection('saas_audit_logs')
    .find(tenantId ? { tenantId } : {})
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 500))
    .toArray();
}
