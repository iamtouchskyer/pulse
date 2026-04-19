import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { RulesFileSchema, type RulesFile } from "@pulse/schema";

export const DEFAULT_KNOWN_DOMAINS = [
  "github.com",
  "google.com",
  "t.co",
  "bing.com",
  "duckduckgo.com",
  "news.ycombinator.com",
  "reddit.com",
];

/**
 * Loads and validates a rules.yaml from disk. The schema is re-exported from
 * @pulse/schema (RulesFileSchema). Throws a ZodError with the original issues
 * on malformed input — caller is expected to render exit code != 0.
 */
export function loadRulesFile(path: string): RulesFile {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = parseYaml(raw);
  return RulesFileSchema.parse(parsed);
}

/** Best-effort optional loader — returns null if file missing. */
export function loadRulesFileOrNull(path: string): RulesFile | null {
  try {
    return loadRulesFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export const WatchlistSchema = z.array(z.string().min(1));
export type Watchlist = z.infer<typeof WatchlistSchema>;

export function loadWatchlistOrEmpty(path: string): Watchlist {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = parseYaml(raw);
    if (parsed === null || parsed === undefined) return [];
    return WatchlistSchema.parse(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    // Malformed YAML or schema violation: degrade to empty list with a warn
    // rather than bricking the whole pipeline. The "or empty" name promises
    // tolerance.
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`pulse: watchlist load failed (${msg}); using empty list`);
    return [];
  }
}
