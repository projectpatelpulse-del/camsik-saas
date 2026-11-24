import { createHash } from 'node:crypto';
import { Binary } from 'mongodb';
import { ConflictError, NotFoundError, getMasterDatabase, getTenantBySlugOrId } from './tenantMaster';
import { ValidationError } from './security/validation';

/**
 * Tenant branding assets (logo, favicon). Stored append-only in the master database, one row per
 * upload, so earlier versions are kept when a new file is uploaded.
 *
 * File type is decided from the bytes (magic numbers, or a strict SVG check), never from the file name
 * or the browser-supplied MIME type. Rows are stored in MongoDB for now; object storage (decision D7)
 * can replace the data field later without changing the public URL.
 */

export const ASSET_KINDS = ['logo', 'favicon'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const MAX_BYTES: Record<AssetKind, number> = {
  logo: 512 * 1024,
  favicon: 128 * 1024,
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === 'string' && (ASSET_KINDS as readonly string[]).includes(value);
}

export function maxAssetBytes(kind: AssetKind): number {
  return MAX_BYTES[kind];
}

export interface DetectedAsset {
  mime: string;
  ext: 'png' | 'webp' | 'svg';
}

/** SVG is accepted only when it is plain vector markup: no scripts, no event handlers, no external references. */
export function checkSvgSafety(buf: Buffer): string | null {
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) return 'SVG must be UTF-8 text';
  if (!/<svg[\s>]/i.test(text)) return 'File is not an SVG document';
  const forbidden: [RegExp, string][] = [
    [/<!DOCTYPE/i, 'DOCTYPE declarations are not allowed in SVG'],
    [/<!ENTITY/i, 'Entity declarations are not allowed in SVG'],
    [/<\s*(script|foreignObject|iframe|object|embed|animate|set|handler|listener)\b/i, 'Active SVG elements are not allowed'],
    [/\son[a-z]+\s*=/i, 'Event handler attributes are not allowed in SVG'],
    [/javascript\s*:/i, 'javascript: URLs are not allowed in SVG'],
    [/\b(href|src)\s*=\s*["'](?!#)/i, 'External references are not allowed in SVG'],
    [/url\(\s*["']?(?!#)/i, 'External url() references are not allowed in SVG'],
  ];
  for (const [re, message] of forbidden) {
    if (re.test(text)) return message;
  }
  return null;
}

/** Returns the detected type, or throws ValidationError with the reason. */
export function detectAsset(buf: Buffer, kind: AssetKind): DetectedAsset {
  if (buf.length === 0) throw new ValidationError('File is empty', { file: 'empty' });
  if (buf.length > MAX_BYTES[kind]) {
    throw new ValidationError(`${kind} must be ${Math.round(MAX_BYTES[kind] / 1024)} KB or smaller`, { file: 'too_large' });
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  const svgProblem = checkSvgSafety(buf);
  if (!svgProblem) return { mime: 'image/svg+xml', ext: 'svg' };
  // A file that is neither a PNG, a WebP, nor a safe SVG is refused. Reporting the SVG reason for
  // non-SVG content would be misleading, so say what is accepted.
  const looksLikeSvg = /<svg[\s>]/i.test(buf.toString('utf8'));
  throw new ValidationError(
    looksLikeSvg ? svgProblem : 'Unsupported file. Upload SVG, PNG or WebP.',
    { file: 'unsupported_type' }
  );
}

export interface AssetRecord {
  tenantId: string;
  kind: AssetKind;
  version: number;
  mime: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  uploadedBy: string;
  createdAt: string;
}

const ASSET_META_PROJECTION = { _id: 0, data: 0 } as const;

/** Public URL the tenant apps use. Includes the version so browsers fetch a new upload immediately. */
export function assetUrl(tenantId: string, kind: AssetKind, version: number): string {
  return `/api/tenant-assets/${encodeURIComponent(tenantId)}/${kind}?v=${version}`;
}

/** Validates and stores one new version of a tenant's asset. Earlier versions are kept. */
export async function storeTenantAsset(
  tenantKey: string,
  kind: AssetKind,
  buf: Buffer,
  uploadedBy: string
): Promise<AssetRecord> {
  const tenant = await getTenantBySlugOrId(tenantKey);
  if (!tenant) throw new NotFoundError('Client not found');

  const detected = detectAsset(buf, kind);
  const db = await getMasterDatabase();
  const col = db.collection('tenant_assets');

  const latest = await col.findOne({ tenantId: tenant.id, kind }, { sort: { version: -1 }, projection: { version: 1 } });
  const version = (latest?.version ?? 0) + 1;

  const record: AssetRecord & { data: Binary } = {
    tenantId: tenant.id,
    kind,
    version,
    mime: detected.mime,
    sizeBytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    storageKey: `tenants/${tenant.slug}/assets/${kind}-v${version}.${detected.ext}`,
    uploadedBy,
    createdAt: new Date().toISOString(),
    data: new Binary(buf),
  };

  try {
    await col.insertOne(record);
  } catch (e: any) {
    if (e?.code === 11000) throw new ConflictError('Another upload finished at the same time. Please upload again.');
    throw e;
  }

  const { data: _data, ...meta } = record;
  return meta;
}

export async function listTenantAssets(tenantKey: string): Promise<AssetRecord[]> {
  const tenant = await getTenantBySlugOrId(tenantKey);
  if (!tenant) throw new NotFoundError('Client not found');
  const db = await getMasterDatabase();
  return (await db
    .collection('tenant_assets')
    .find({ tenantId: tenant.id }, { projection: ASSET_META_PROJECTION })
    .sort({ kind: 1, version: -1 })
    .toArray()) as unknown as AssetRecord[];
}

/** Latest version of one asset, with its bytes. Used by the public file endpoint and branding sync. */
export async function getCurrentAssetFile(
  tenantId: string,
  kind: AssetKind
): Promise<{ mime: string; version: number; sha256: string; bytes: Buffer } | null> {
  const db = await getMasterDatabase();
  const row = await db.collection('tenant_assets').findOne({ tenantId, kind }, { sort: { version: -1 } });
  if (!row) return null;
  const bin = row.data as Binary;
  return {
    mime: String(row.mime),
    version: Number(row.version),
    sha256: String(row.sha256),
    bytes: Buffer.from(bin.buffer).subarray(0, bin.position),
  };
}
