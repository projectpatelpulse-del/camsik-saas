import type { ProjectTemplate, Tenant } from './types';

/**
 * Public, client-safe tenant configuration for the Flutter apps and web panels.
 *
 * Whitelist by design: only the fields listed here leave the server. Database names, subscription
 * data, domains, provisioning state and anything under `subscription` or `features.*Enabled` internals
 * are never copied.
 */

export interface PublicTenantConfig {
  tenantId: string;
  slug: string;
  name: string;
  brandName: string;
  tagline: string;
  logoUrl: string;
  supportEmail: string;
  supportPhone: string;
  whatsappNumber: string | null;
  address: string;
  currency: string;
  currencySymbol: string;
  timeZone: string;
  country: string;
  features: Record<string, boolean>;
  theme: {
    templateId: string;
    primary: string;
    secondary: string;
    accent: string;
    headingFont: string;
    bodyFont: string;
    borderRadius: string;
    isDarkTheme: boolean;
  };
  version: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_THEME = {
  primary: '#059669',
  secondary: '#0F172A',
  accent: '#4F46E5',
};

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toUpperCase() : fallback;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, 300) : fallback;
}

/** Only true/false values are passed on; any other shape is dropped. */
function publicFeatures(features: Tenant['features'] | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(features ?? {})) {
    if (typeof value === 'boolean' && /^[a-zA-Z]{2,40}$/.test(key)) out[key] = value;
  }
  return out;
}

export function toPublicTenantConfig(
  tenant: Tenant,
  template: ProjectTemplate | undefined,
  version = 0
): PublicTenantConfig {
  const b = tenant.branding ?? ({} as Tenant['branding']);
  const tokens = template?.tokens;

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    name: text(tenant.name, tenant.slug),
    brandName: text(b.brandName, tenant.name),
    tagline: text(b.tagline),
    logoUrl: text(b.logoUrl, '/images/default-logo.svg'),
    supportEmail: text(b.supportEmail),
    supportPhone: text(b.supportPhone),
    // Empty or invalid WhatsApp number means "hide the button", never a placeholder.
    whatsappNumber: /^\+?[0-9]{8,15}$/.test(b.whatsappNumber ?? '') ? (b.whatsappNumber as string) : null,
    address: text(b.address),
    currency: text(b.currency, 'INR'),
    currencySymbol: text(b.currencySymbol, '₹'),
    timeZone: text(b.timeZone, 'Asia/Kolkata'),
    country: text(b.country, 'India'),
    features: publicFeatures(tenant.features),
    theme: {
      templateId: template?.id ?? tenant.templateId,
      primary: color(b.primaryColor, color(tokens?.primaryColor, DEFAULT_THEME.primary)),
      secondary: color(b.secondaryColor, color(tokens?.secondaryColor, DEFAULT_THEME.secondary)),
      accent: color(b.accentColor, color(tokens?.accentColor, DEFAULT_THEME.accent)),
      headingFont: text(tokens?.fontHeading, 'Inter'),
      bodyFont: text(tokens?.fontBody, 'Inter'),
      borderRadius: text(tokens?.borderRadius, '12px'),
      isDarkTheme: tokens?.isDarkTheme === true,
    },
    version,
  };
}
