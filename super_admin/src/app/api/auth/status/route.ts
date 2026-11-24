import { adminCount } from '@/lib/auth';
import { errorResponse, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Tells the login page whether first-time setup (creating the first super admin) is still open. */
export async function GET() {
  try {
    return ok({ setupRequired: (await adminCount()) === 0 });
  } catch (e) {
    return errorResponse(e, 'auth.status');
  }
}
