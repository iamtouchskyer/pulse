import type { Alert, Snapshot } from "@pulse/schema";

/** Extract host from a referrer string. GitHub's traffic API returns host-like
 * strings ("github.com", "Google") or occasionally full URLs — normalize both. */
export function extractDomain(referrer: string): string {
  const trimmed = referrer.trim().toLowerCase();
  if (trimmed.length === 0) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.hostname;
  } catch {
    return trimmed;
  }
}

export interface NewReferrerParams {
  uniquesThreshold: number;
  knownList: readonly string[];
}

/**
 * Returns true if `host` exactly matches any known domain OR is a subdomain
 * thereof. E.g. `mobile.twitter.com` is considered known when `twitter.com`
 * is in `knownList`. Case-insensitive; callers are expected to lowercase
 * both sides (we defensively lowercase again).
 */
export function isKnownDomain(host: string, knownList: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const k of knownList) {
    const kk = k.toLowerCase();
    if (h === kk) return true;
    if (h.endsWith("." + kk)) return true;
  }
  return false;
}

export function runNewReferrerDomain(snap: Snapshot, params: NewReferrerParams): Alert[] {
  const out: Alert[] = [];
  for (const r of snap.top_referrers) {
    if (r.uniques < params.uniquesThreshold) continue;
    const domain = extractDomain(r.referrer);
    if (domain.length === 0) continue;
    if (isKnownDomain(domain, params.knownList)) continue;
    out.push({
      schema_version: 1,
      rule: "new_referrer_domain",
      repo: snap.repo,
      severity: "info",
      message: `New referrer ${domain} (${r.uniques} uniques)`,
      captured_at: snap.captured_at,
      data: { domain, uniques: r.uniques },
    });
  }
  return out;
}
