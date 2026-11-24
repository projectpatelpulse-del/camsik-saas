import dns from 'node:dns/promises';
import type { DnsResolver } from './domainVerify';

/** Live DNS lookups for production verification. Errors (NXDOMAIN, no records) are thrown to the caller. */
export const systemDnsResolver: DnsResolver = {
  resolveCname: (host) => dns.resolveCname(host),
  resolveTxt: (host) => dns.resolveTxt(host),
  resolve4: (host) => dns.resolve4(host),
};
