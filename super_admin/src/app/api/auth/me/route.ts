import { requireAdmin } from '@/lib/auth';
import { errorResponse, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('response' in auth) return auth.response;
    return ok({ actor: auth.actor });
  } catch (e) {
    return errorResponse(e, 'auth.me');
  }
}
