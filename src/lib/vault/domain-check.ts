/**
 * Authorized domain checking for vault secrets.
 *
 * Domains are stored encrypted in the vault (key: `${vaultKey}_domains`)
 * so the agent can never access them. When a vault entry has authorized
 * domains set, use-secret will only allow "fill" actions on pages whose
 * hostname matches one of them.
 */

/**
 * Parse a comma-separated domain string into an array of authorized domains.
 * Handles null, empty, single values, and comma-separated lists.
 */
export function parseAuthorizedDomains(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Check whether a URL's hostname is authorized against a list of domains.
 *
 * Returns true if:
 * - authorizedDomains is empty (no restriction)
 * - hostname exactly matches an authorized domain
 * - hostname is a subdomain of an authorized domain (dot-boundary match)
 *
 * e.g. "api.openai.com" matches "openai.com", but "evilopenai.com" does not.
 */
export function isDomainAuthorized(currentUrl: string, authorizedDomains: string[]): boolean {
  if (authorizedDomains.length === 0) return true;

  let hostname: string;
  try {
    hostname = new URL(currentUrl).hostname.toLowerCase();
  } catch {
    return false; // Malformed URL — fail closed
  }

  return authorizedDomains.some((domain) => {
    if (hostname === domain) return true;
    // Subdomain match: hostname must end with ".domain"
    return hostname.endsWith(`.${domain}`);
  });
}
