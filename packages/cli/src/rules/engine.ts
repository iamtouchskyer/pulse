import type { Alert, Snapshot, RulesFile } from "@pulse/schema";
import type { GitHubClient } from "../github.js";
import { DEFAULT_KNOWN_DOMAINS } from "../rules-config.js";
import { runNewReferrerDomain } from "./new_referrer_domain.js";
import { runUnansweredIssue } from "./unanswered_issue.js";
import { runStarVelocitySpike } from "./star_velocity_spike.js";
import { runActiveFork } from "./active_fork.js";
import { runWatchlistSignal } from "./watchlist_signal.js";

export interface RunRulesDeps {
  snapshotsDir: string;
  watchlist: readonly string[];
  client: GitHubClient | null;
  /** Override "now" for deterministic tests; forwarded to active_fork. */
  now?: () => number;
}

export async function runAllRules(
  snapshots: Map<string, Snapshot>,
  rulesFile: RulesFile,
  deps: RunRulesDeps
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const knownList = rulesFile.known_list.length > 0 ? rulesFile.known_list : DEFAULT_KNOWN_DOMAINS;

  for (const snap of snapshots.values()) {
    for (const rule of rulesFile.rules) {
      switch (rule.type) {
        case "new_referrer_domain":
          alerts.push(
            ...runNewReferrerDomain(snap, {
              uniquesThreshold: rule.uniques_threshold,
              knownList,
            })
          );
          break;
        case "unanswered_issue":
          alerts.push(...runUnansweredIssue(snap, { ageHours: rule.age_hours }));
          break;
        case "star_velocity_spike":
          alerts.push(...runStarVelocitySpike(snap, deps.snapshotsDir, { sigma: rule.sigma }));
          break;
        case "active_fork":
          alerts.push(...(await runActiveFork(snap, { client: deps.client, now: deps.now })));
          break;
        case "watchlist_signal":
          alerts.push(...runWatchlistSignal(snap, deps.watchlist));
          break;
      }
    }
  }
  return alerts;
}
