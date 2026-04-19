import type { Alert, Snapshot } from "@pulse/schema";
import { listDateDirs, loadSnapshotsAt } from "../diff.js";

export interface StarVelocityParams {
  sigma: number;
}

interface WeekSample {
  endDate: string;
  delta: number;
}

/**
 * Look 28 days back and build 4 weekly buckets of star deltas. Each bucket
 * compares snapshot at D-7k vs D-7(k+1) for k=0..3. If any required day is
 * missing, the function returns null (insufficient history).
 */
export function computeWeeklyDeltas(
  snapshotsDir: string,
  repo: string,
  latestDate: string
): { current: number; previous: WeekSample[] } | null {
  const dates = new Set(listDateDirs(snapshotsDir));
  if (!dates.has(latestDate)) return null;

  const need: string[] = [latestDate];
  for (let i = 1; i <= 4; i += 1) {
    need.push(subtractDays(latestDate, 7 * i));
  }
  for (const d of need) {
    if (!dates.has(d)) return null;
  }

  const getStars = (date: string): number | null => {
    try {
      const snaps = loadSnapshotsAt(snapshotsDir, date);
      const s = snaps.get(repo);
      return s ? s.stars : null;
    } catch {
      return null;
    }
  };

  const starsByDate: Record<string, number> = {};
  for (const d of need) {
    const v = getStars(d);
    if (v === null) return null;
    starsByDate[d] = v;
  }

  const latestDateStars = starsByDate[latestDate];
  const weekAgoStars = starsByDate[need[1] as string];
  if (latestDateStars === undefined || weekAgoStars === undefined) return null;
  const current = latestDateStars - weekAgoStars;

  const previous: WeekSample[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const end = need[i];
    const start = need[i + 1];
    if (end === undefined || start === undefined) return null;
    const endVal = starsByDate[end];
    const startVal = starsByDate[start];
    if (endVal === undefined || startVal === undefined) return null;
    previous.push({ endDate: end, delta: endVal - startVal });
  }
  return { current, previous };
}

function subtractDays(dateStr: string, nDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`invalid date: ${dateStr}`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - nDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

export function runStarVelocitySpike(
  snap: Snapshot,
  snapshotsDir: string,
  params: StarVelocityParams
): Alert[] {
  const weeks = computeWeeklyDeltas(snapshotsDir, snap.repo, snap.date);
  if (weeks === null) return [];
  const prevValues = weeks.previous.map((w) => w.delta);
  const { mean, std } = meanStd(prevValues);
  if (mean <= 0) return [];
  const threshold = mean + params.sigma * std;
  if (weeks.current <= threshold) return [];
  return [
    {
      schema_version: 1,
      rule: "star_velocity_spike",
      repo: snap.repo,
      severity: "info",
      message: `Stars spike: ${weeks.current} this week vs mean ${mean.toFixed(2)} (σ=${std.toFixed(2)})`,
      captured_at: snap.captured_at,
      data: {
        delta: weeks.current,
        mean: Math.round(mean * 100) / 100,
        std: Math.round(std * 100) / 100,
        sigma: params.sigma,
      },
    },
  ];
}
