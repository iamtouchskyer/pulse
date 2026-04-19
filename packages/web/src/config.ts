/**
 * Fixed display order for Pulse v1 dashboard.
 * Keep in sync with packages/cli/src/repos.ts DEFAULT_REPOS.
 */
export const DISPLAY_REPOS = ["opc", "memex", "logex", "blog"] as const;
export type DisplayRepo = (typeof DISPLAY_REPOS)[number];
