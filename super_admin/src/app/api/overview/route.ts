import { requireAdmin } from "@/lib/auth";
import { errorResponse, ok } from "@/lib/http";
import { getOverviewStats } from "@/lib/overview";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("response" in auth) return auth.response;
    return ok({ stats: await getOverviewStats() });
  } catch (e) {
    return errorResponse(e, "overview.get");
  }
}
