/**
 * Domain ownership and routing checks. Pure logic with an injected DNS resolver so it can be tested
 * without the network.
 *
 * Rules (no development bypass, no substring matching):
 *  - Ownership: a TXT record at `_camsik-challenge.<domain>` must contain the tenant's token exactly.
 *  - Routing, subdomain (www / shop.example.com): CNAME must resolve to the configured platform target.
 *  - Routing, apex (example.com): A records must match the configured platform IPs.
 */

export interface DnsResolver {
  resolveCname(host: string): Promise<string[]>;
  resolveTxt(host: string): Promise<string[][]>;
  resolve4(host: string): Promise<string[]>;
}

export interface DomainExpectation {
  domain: string;
  txtToken: string;
  cnameTarget: string;
  apexIps: string[];
}

export interface DomainCheck {
  ownershipVerified: boolean;
  routingVerified: boolean;
  isApex: boolean;
  diagnostics: string[];
}

export const CHALLENGE_PREFIX = '_camsik-challenge';

export function isApexDomain(domain: string): boolean {
  // Naive apex detection: two labels (example.com). Multi-part public suffixes (co.in) would be
  // misclassified, so the admin can set routing explicitly later via PSL-aware logic if needed.
  return domain.split('.').length === 2;
}

function normalizeHost(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, '');
}

function errCode(e: unknown): string {
  const code = (e as { code?: string })?.code;
  return code ? String(code) : (e as Error)?.message ?? 'unknown error';
}

export async function checkDomain(
  exp: DomainExpectation,
  resolver: DnsResolver
): Promise<DomainCheck> {
  const diagnostics: string[] = [];
  const domain = normalizeHost(exp.domain);
  const isApex = isApexDomain(domain);

  // 1. Ownership via TXT
  let ownershipVerified = false;
  try {
    const records = await resolver.resolveTxt(`${CHALLENGE_PREFIX}.${domain}`);
    const values = records.map((parts) => parts.join(''));
    if (values.includes(exp.txtToken)) {
      ownershipVerified = true;
      diagnostics.push('Ownership TXT record verified');
    } else {
      diagnostics.push(`Ownership TXT record not found or mismatched (found ${values.length} TXT record(s))`);
    }
  } catch (e) {
    diagnostics.push(`TXT lookup failed: ${errCode(e)}`);
  }

  // 2. Routing via CNAME (subdomain) or A records (apex)
  let routingVerified = false;
  if (isApex) {
    try {
      const ips = await resolver.resolve4(domain);
      const expected = new Set(exp.apexIps.map(normalizeHost));
      routingVerified = ips.length > 0 && ips.every((ip) => expected.has(normalizeHost(ip)));
      diagnostics.push(
        routingVerified
          ? 'Apex A records point to the platform'
          : `Apex A records ${ips.join(', ') || '(none)'} do not match the platform IPs`
      );
    } catch (e) {
      diagnostics.push(`A lookup failed: ${errCode(e)}`);
    }
  } else {
    try {
      const targets = (await resolver.resolveCname(domain)).map(normalizeHost);
      const target = normalizeHost(exp.cnameTarget);
      routingVerified = targets.includes(target);
      diagnostics.push(
        routingVerified
          ? `CNAME points to ${target}`
          : `CNAME points to ${targets.join(', ') || '(none)'}, expected ${target}`
      );
    } catch (e) {
      diagnostics.push(`CNAME lookup failed: ${errCode(e)}`);
    }
  }

  return { ownershipVerified, routingVerified, isApex, diagnostics };
}

/** Records the owner must create. Shown in the UI as-is. */
export function requiredDnsRecords(exp: Pick<DomainExpectation, 'domain' | 'txtToken' | 'cnameTarget' | 'apexIps'>) {
  const domain = normalizeHost(exp.domain);
  const records: Array<{ type: 'TXT' | 'CNAME' | 'A'; host: string; value: string; purpose: string }> = [
    { type: 'TXT', host: `${CHALLENGE_PREFIX}.${domain}`, value: exp.txtToken, purpose: 'Proves ownership' },
  ];
  if (isApexDomain(domain)) {
    for (const ip of exp.apexIps) {
      records.push({ type: 'A', host: '@', value: ip, purpose: 'Routes traffic to the platform' });
    }
  } else {
    // Host is relative to the registrable zone: shop.example.com -> "shop", a.b.example.com -> "a.b"
    const host = domain.split('.').slice(0, -2).join('.');
    records.push({ type: 'CNAME', host, value: exp.cnameTarget, purpose: 'Routes traffic to the platform' });
  }
  return records;
}
