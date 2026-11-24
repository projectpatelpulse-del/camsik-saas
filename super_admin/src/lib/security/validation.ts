import type { PanelType, Tenant, TenantStatus, SubscriptionPlan } from '../types';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const RESERVED_SLUGS = new Set(['api', 'admin', 'www', 'login', 'app', 'static', 'super', 'saas', 'mail', 'support']);
const DB_NAME_RE = /^casmik_tenant_[a-z0-9_]{3,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DOMAIN_LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export const TENANT_STATUSES: TenantStatus[] = ['active', 'inactive', 'trial', 'suspended', 'expired'];
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  'free_trial', 'starter', 'growth', 'professional', 'business', 'enterprise', 'custom',
];

export class ValidationError extends Error {
  constructor(message: string, public readonly fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export function validateSlug(slug: string): string | null {
  if (!SLUG_RE.test(slug)) return 'Slug must be 3–32 characters: lowercase letters, digits and hyphens';
  if (RESERVED_SLUGS.has(slug)) return `'${slug}' is a reserved name`;
  return null;
}

/** Each tenant gets its own Mongo database named from its slug. Derived, never caller-supplied. */
export function dbNameForSlug(slug: string): string {
  return `casmik_tenant_${slug.replace(/-/g, '_')}`;
}

export function isValidTenantDbName(dbName: string): boolean {
  return DB_NAME_RE.test(dbName);
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

/** Accepts hostnames with at least two labels. Rejects IPs, single labels and wildcard-only input. */
export function validateDomain(domain: string): string | null {
  if (!domain || domain.length > 253) return 'Domain is empty or too long';
  const labels = domain.split('.');
  if (labels.length < 2) return 'Domain must have at least two labels (e.g. shop.example.com)';
  if (!labels.every((l) => DOMAIN_LABEL_RE.test(l))) return 'Domain contains invalid characters';
  if (/^\d+$/.test(labels[labels.length - 1])) return 'Domain cannot be an IP address';
  return null;
}

export function validateEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

const BRANDING_TEXT_FIELDS = [
  'brandName', 'appName', 'websiteTitle', 'tagline', 'supportEmail', 'supportPhone',
  'whatsappNumber', 'address', 'currency', 'currencySymbol', 'timeZone', 'country',
] as const;
const BRANDING_URL_FIELDS = [
  'logoUrl', 'darkLogoUrl', 'lightLogoUrl', 'faviconUrl', 'androidIconUrl', 'iosIconUrl', 'splashScreenUrl',
] as const;
const BRANDING_COLOR_FIELDS = ['primaryColor', 'secondaryColor', 'accentColor'] as const;

/**
 * Keeps only known branding keys with valid types. Unknown keys are dropped, so a caller cannot
 * smuggle fields (e.g. tenant ids or Mongo operators) into the stored document.
 */
export function sanitizeBranding(input: unknown): Partial<Tenant['branding']> {
  if (!input || typeof input !== 'object') throw new ValidationError('branding must be an object');
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const key of BRANDING_TEXT_FIELDS) {
    if (src[key] === undefined) continue;
    if (typeof src[key] !== 'string' || (src[key] as string).length > 300) errors[key] = 'must be text (max 300 chars)';
    else out[key] = (src[key] as string).trim();
  }
  for (const key of BRANDING_URL_FIELDS) {
    if (src[key] === undefined) continue;
    const v = src[key];
    const ok = typeof v === 'string' && (v.startsWith('/') && !v.startsWith('//') || /^https:\/\//.test(v));
    if (!ok) errors[key] = 'must be an https:// URL or a relative path';
    else out[key] = v;
  }
  for (const key of BRANDING_COLOR_FIELDS) {
    if (src[key] === undefined) continue;
    if (typeof src[key] !== 'string' || !HEX_COLOR_RE.test(src[key] as string)) errors[key] = 'must be a #RRGGBB color';
    else out[key] = src[key];
  }
  if (src.brandName !== undefined && typeof src.brandName === 'string' && src.brandName.trim() === '') {
    errors.brandName = 'cannot be empty';
  }
  if (Object.keys(errors).length) throw new ValidationError('Invalid branding', errors);
  return out as Partial<Tenant['branding']>;
}

export const PANEL_TYPES: PanelType[] = [
  'user_web', 'user_android', 'user_ios', 'partner_web', 'partner_android', 'partner_ios',
  'delivery_web', 'delivery_android', 'delivery_ios', 'admin_web', 'admin_android', 'admin_ios',
];

/** Validates a create-tenant payload. Returns the cleaned values or throws ValidationError. */
export function validateNewTenant(input: unknown): {
  name: string;
  slug: string;
  dbName: string;
  templateId?: string;
  supportEmail: string;
} {
  if (!input || typeof input !== 'object') throw new ValidationError('Request body must be an object');
  const body = input as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 120) errors.name = 'Name must be 2–120 characters';

  const rawSlug = typeof body.slug === 'string' && body.slug.trim() ? body.slug : name;
  const slug = normalizeSlug(rawSlug);
  const slugError = validateSlug(slug);
  if (slugError) errors.slug = slugError;

  const brandingEmail = (body.branding as Record<string, unknown> | undefined)?.supportEmail;
  const rawEmail = typeof body.supportEmail === 'string' ? body.supportEmail : brandingEmail;
  const supportEmail = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!validateEmail(supportEmail)) errors.supportEmail = 'A valid support email is required';

  if (Object.keys(errors).length) throw new ValidationError('Invalid tenant', errors);
  return {
    name,
    slug,
    dbName: dbNameForSlug(slug),
    templateId: typeof body.templateId === 'string' ? body.templateId : undefined,
    supportEmail,
  };
}

/**
 * Allowlisted update for a tenant. Identity fields (id, slug, dbName, createdAt), domains and
 * provisioning state are NOT updatable here.
 */
export function sanitizeTenantUpdate(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new ValidationError('Request body must be an object');
  const body = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 2) errors.name = 'Name must be at least 2 characters';
    else out.name = body.name.trim();
  }
  if (body.templateId !== undefined) {
    if (typeof body.templateId !== 'string' || !body.templateId) errors.templateId = 'templateId must be a string';
    else out.templateId = body.templateId;
  }
  if (body.status !== undefined) {
    if (!TENANT_STATUSES.includes(body.status as TenantStatus)) errors.status = `Status must be one of ${TENANT_STATUSES.join(', ')}`;
    else out.status = body.status;
  }
  if (body.branding !== undefined) {
    try {
      out.branding = sanitizeBranding(body.branding);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      if (Object.keys(e.fields).length) Object.assign(errors, e.fields);
      else errors.branding = e.message;
    }
  }
  if (body.features !== undefined) {
    if (!body.features || typeof body.features !== 'object') errors.features = 'features must be an object';
    else {
      const f: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(body.features as Record<string, unknown>)) {
        if (typeof v !== 'boolean') errors[`features.${k}`] = 'must be true or false';
        else f[k] = v;
      }
      out.features = f;
    }
  }
  if (body.subscription !== undefined) {
    const s = body.subscription as Record<string, unknown>;
    if (!s || typeof s !== 'object') errors.subscription = 'subscription must be an object';
    else {
      const sub: Record<string, unknown> = {};
      if (s.plan !== undefined) {
        if (!SUBSCRIPTION_PLANS.includes(s.plan as SubscriptionPlan)) errors['subscription.plan'] = 'Unknown plan';
        else sub.plan = s.plan;
      }
      for (const key of ['maxOrdersPerMonth', 'priceMonthly', 'maxCustomDomains'] as const) {
        if (s[key] === undefined) continue;
        if (!Number.isInteger(s[key]) || (s[key] as number) < 0) errors[`subscription.${key}`] = 'must be a non-negative integer';
        else sub[key] = s[key];
      }
      if (s.validUntil !== undefined) {
        if (!isIsoDate(s.validUntil)) errors['subscription.validUntil'] = 'must be an ISO date';
        else sub.validUntil = s.validUntil;
      }
      for (const key of ['customDomainEnabled', 'androidBuildEnabled', 'iosBuildEnabled'] as const) {
        if (s[key] === undefined) continue;
        if (typeof s[key] !== 'boolean') errors[`subscription.${key}`] = 'must be boolean';
        else sub[key] = s[key];
      }
      if (Object.keys(sub).length) out.subscription = sub;
    }
  }

  if (Object.keys(errors).length) throw new ValidationError('Invalid update', errors);
  return out;
}
