import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError } from "zod";
import { loadRulesFile, loadRulesFileOrNull, loadWatchlistOrEmpty } from "./rules-config.js";

describe("rules-config", () => {
  it("loads a valid rules.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-rules-"));
    try {
      const p = join(dir, "rules.yaml");
      writeFileSync(
        p,
        [
          "known_list: [github.com]",
          "notify_channel: null",
          "rules:",
          "  - type: new_referrer_domain",
          "    uniques_threshold: 20",
        ].join("\n"),
        "utf8"
      );
      const parsed = loadRulesFile(p);
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.rules[0]?.type).toBe("new_referrer_domain");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws ZodError on malformed rules.yaml (missing discriminator)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-rules-"));
    try {
      const p = join(dir, "rules.yaml");
      writeFileSync(
        p,
        ["known_list: []", "notify_channel: null", "rules:", "  - uniques_threshold: 20"].join(
          "\n"
        ),
        "utf8"
      );
      expect(() => loadRulesFile(p)).toThrow(ZodError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadRulesFileOrNull returns null for ENOENT", () => {
    expect(loadRulesFileOrNull(join(tmpdir(), "nope-" + Date.now() + ".yaml"))).toBeNull();
  });

  it("loadWatchlistOrEmpty returns [] for missing file", () => {
    expect(loadWatchlistOrEmpty(join(tmpdir(), "nope-" + Date.now() + ".yaml"))).toEqual([]);
  });

  it("loadWatchlistOrEmpty parses array", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-wl-"));
    try {
      const p = join(dir, "w.yaml");
      writeFileSync(p, "- alice\n- bob\n", "utf8");
      expect(loadWatchlistOrEmpty(p)).toEqual(["alice", "bob"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadWatchlistOrEmpty handles empty file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-wl-"));
    try {
      const p = join(dir, "w.yaml");
      writeFileSync(p, "", "utf8");
      expect(loadWatchlistOrEmpty(p)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadWatchlistOrEmpty degrades to [] on malformed content (not an array)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-wl-"));
    try {
      const p = join(dir, "w.yaml");
      writeFileSync(p, "alice: true\nbob: false\n", "utf8");
      // Malformed (object, not array) → should warn and return [], NOT throw.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(loadWatchlistOrEmpty(p)).toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadRulesFile throws ENOENT when file missing", () => {
    const p = join(tmpdir(), "definitely-not-here-" + Date.now() + ".yaml");
    expect(() => loadRulesFile(p)).toThrow(/ENOENT|no such file/);
  });

  it("loadRulesFile throws when root is not an object", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-rules-"));
    try {
      const p = join(dir, "r.yaml");
      writeFileSync(p, "- just\n- an\n- array\n", "utf8");
      expect(() => loadRulesFile(p)).toThrow(ZodError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadRulesFile: extra unknown top-level fields — passthrough (non-strict schema, documented)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pulse-rules-"));
    try {
      const p = join(dir, "r.yaml");
      writeFileSync(
        p,
        [
          "known_list: []",
          "notify_channel: null",
          "rules: []",
          "notify_channels: typo_that_should_probably_fail_strict",
        ].join("\n"),
        "utf8"
      );
      // Current schema is NOT `.strict()`, so unknown top-level fields pass.
      // This test documents that behavior so any future strict-mode change is
      // an intentional break, not a silent regression.
      const parsed = loadRulesFile(p);
      expect(parsed.rules).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
