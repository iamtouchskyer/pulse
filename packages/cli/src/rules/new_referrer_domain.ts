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

export function runNewReferrerDomain(snap: Snapshot, params: NewReferrerParams): Alert[] {
  const known = new Set(params.knownList.map((d) => d.toLowerCase()));
  const out: Alert[] = [];
  for (const r of snap.top_referrers) {
    if (r.uniques < params.uniquesThreshold) continue;
    const domain = extractDomain(r.referrer);
    if (domain.length === 0) continue;
    if (known.has(domain)) continue;
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
