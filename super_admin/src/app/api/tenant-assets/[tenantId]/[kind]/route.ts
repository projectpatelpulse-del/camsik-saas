import { errorResponse, fail } from '@/lib/http';
import { getCurrentAssetFile, isAssetKind } from '@/lib/tenantAssets';

export const dynamic = 'force-dynamic';

/**
 * Public read of a tenant's current logo or favicon. Branding is public by nature, so no session is
 * required. Only the latest version is served, and the response forbids sniffing and active content.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ tenantId: string; kind: string }> }) {
  try {
    const { tenantId, kind } = await params;
    if (!isAssetKind(kind)) return fail('Not found', 404);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return fail('Not found', 404);
    const file = await getCurrentAssetFile(tenantId, kind);
    if (!file) return fail('Not found', 404);
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.mime,
        'Cache-Control': 'public, max-age=300',
        ETag: `"${file.sha256}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      },
    });
  } catch (e) {
    return errorResponse(e, 'tenantAssets.get');
  }
}
