import { getTenantBySlugOrId, updateTenant, deleteTenant, getMasterDatabase, NotFoundError } from '@/lib/tenantMaster';
import { getTenantDatabaseStatus, getTenantDatabase } from '@/lib/tenantDb';
import { requireAdmin, requestContext } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { errorResponse, fail, ok, readJson } from '@/lib/http';
import { ValidationError } from '@/lib/security/validation';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const client = await getTenantBySlugOrId(id);
    if (!client) return fail('Client not found', 404);

    const database = await getTenantDatabaseStatus(client);
    const domains = await (await getMasterDatabase()).collection('domains').find({ tenantId: client.id }).toArray();
    return ok({ client, database, domains });
  } catch (e) {
    return errorResponse(e, 'clients.get');
  }
}

/** Partial update. Only allowlisted fields are applied (see sanitizeTenantUpdate). */
export async function PUT(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const client = await getTenantBySlugOrId(id);
    if (!client) return fail('Client not found', 404);

    const body = await readJson(request);
    const updated = await updateTenant(client.id, body);
    if (!updated) return fail('Client not found or update failed', 404);

    await recordAudit({
      action: 'tenant.update',
      actor: auth.actor,
      tenantId: client.id,
      tenantSlug: client.slug,
      ctx: requestContext(request),
      meta: { fields: Object.keys(body) },
    });
    return ok({ message: 'Client updated successfully', client: updated });
  } catch (e) {
    return errorResponse(e, 'clients.update');
  }
}

/**
 * Permanent delete. Requires the tenant to be suspended or inactive first, the slug typed back as
 * confirmation, and optionally drops the tenant database (`dropDatabase: true`). Audit is written
 * before anything is removed.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    const { id } = await params;
    const client = await getTenantBySlugOrId(id);
    if (!client) return fail('Client not found', 404);

    const body = await readJson(request).catch(() => ({} as Record<string, unknown>));
    if (body.confirmSlug !== client.slug) {
      throw new ValidationError(`Type the client slug '${client.slug}' to confirm deletion`, { confirmSlug: 'mismatch' });
    }
    if (client.status !== 'suspended' && client.status !== 'inactive') {
      return fail('Suspend or deactivate the client before deleting it', 409);
    }

    const ctx = requestContext(request);
    await recordAudit({
      action: 'tenant.delete',
      actor: auth.actor,
      tenantId: client.id,
      tenantSlug: client.slug,
      ctx,
      meta: { dropDatabase: body.dropDatabase === true, dbName: client.dbName },
    });

    if (body.dropDatabase === true) {
      await (await getTenantDatabase(client)).dropDatabase();
    }
    await (await getMasterDatabase()).collection('domains').deleteMany({ tenantId: client.id });
    const removed = await deleteTenant(client.id);
    if (!removed) throw new NotFoundError('Client was already deleted');

    return ok({ message: `Client '${client.name}' deleted`, databaseDropped: body.dropDatabase === true });
  } catch (e) {
    return errorResponse(e, 'clients.delete');
  }
}
