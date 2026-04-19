import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("token loader", () => {
  const ORIG_ENV = { ...process.env };
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "pulse-token-"));
    delete process.env.GITHUB_TOKEN_PULSE;
    delete process.env.GITHUB_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    process.env = { ...ORIG_ENV };
    vi.restoreAllMocks();
  });

  async function importToken(homeOverride: string) {
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => homeOverride };
    });
    return await import("./token.js");
  }

  it("prefers GITHUB_TOKEN_PULSE over GITHUB_TOKEN", async () => {
    process.env.GITHUB_TOKEN_PULSE = "tok-pulse";
    process.env.GITHUB_TOKEN = "tok-generic";
    const { loadToken } = await importToken(tmpHome);
    expect(loadToken()).toBe("tok-pulse");
  });

  it("falls back to GITHUB_TOKEN when GITHUB_TOKEN_PULSE missing", async () => {
    process.env.GITHUB_TOKEN = "tok-generic";
    const { loadToken } = await importToken(tmpHome);
    expect(loadToken()).toBe("tok-generic");
  });

  it("falls back to ~/.claude/.env file when env vars absent", async () => {
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude", ".env"),
      "OTHER=foo\nGITHUB_TOKEN_PULSE=tok-from-file\nMORE=bar\n",
      "utf8"
    );
    const { loadToken } = await importToken(tmpHome);
    expect(loadToken()).toBe("tok-from-file");
  });

  it("strips quotes from .env value", async () => {
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(join(tmpHome, ".claude", ".env"), `GITHUB_TOKEN_PULSE="tok-quoted"\n`, "utf8");
    const { loadToken } = await importToken(tmpHome);
    expect(loadToken()).toBe("tok-quoted");
  });

  it("strips leading 'export ' shell-style prefix", async () => {
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude", ".env"),
      "export GITHUB_TOKEN_PULSE=ghp_exportedtok\n",
      "utf8"
    );
    const { loadToken } = await importToken(tmpHome);
    expect(loadToken()).toBe("ghp_exportedtok");
  });

  it("strips trailing unquoted '# comment' from value", async () => {
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude", ".env"),
      "GITHUB_TOKEN_PULSE=ghp_commented # rotated 2026-04\n",
      "utf8"
    );
    const { loadToken } = await importToken(tmpHome);
    expect(loadToken()).toBe("ghp_commented");
  });

  it("warns on group-readable perms but still loads token", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    const envPath = join(tmpHome, ".claude", ".env");
    writeFileSync(envPath, "GITHUB_TOKEN_PULSE=ghp_permtest0000000000\n", "utf8");
    const { chmodSync } = await import("node:fs");
    chmodSync(envPath, 0o644);
    const { loadToken } = await importToken(tmpHome);
    expect(loadToken()).toBe("ghp_permtest0000000000");
    const joined = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(joined).toMatch(/accessible by group\/other/);
    // Token must NOT appear in warning.
    expect(joined).not.toMatch(/ghp_permtest/);
    warnSpy.mockRestore();
  });

  it("refuses to follow a symlink at ~/.claude/.env", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    const realPath = join(tmpHome, "real.env");
    writeFileSync(realPath, "GITHUB_TOKEN_PULSE=ghp_shouldnotleak0000\n", "utf8");
    const { symlinkSync } = await import("node:fs");
    symlinkSync(realPath, join(tmpHome, ".claude", ".env"));
    const { loadTokenOrNull } = await importToken(tmpHome);
    expect(loadTokenOrNull()).toBeNull();
    const joined = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(joined).toMatch(/refusing to follow symlink/);
    warnSpy.mockRestore();
  });

  it("throws with non-leaking message when not found", async () => {
    const { loadToken } = await importToken(tmpHome);
    expect(() => loadToken()).toThrow(/GitHub token not found.*GITHUB_TOKEN_PULSE/);
    try {
      loadToken();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toMatch(/tok-/);
    }
  });

  it("loadTokenOrNull returns null when missing", async () => {
    const { loadTokenOrNull } = await importToken(tmpHome);
    expect(loadTokenOrNull()).toBeNull();
  });
});
