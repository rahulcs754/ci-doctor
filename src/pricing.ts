import type { RunnerOs } from "./types.js";

/**
 * USD per billable minute for GitHub-hosted standard runners.
 * GitHub changes these from time to time, so they live in one place.
 * Ratios follow GitHub's minute multipliers: Windows 2x, macOS 10x Linux.
 */
export const RATES: Record<RunnerOs, number> = {
  linux: 0.008,
  windows: 0.016,
  macos: 0.08,
  "self-hosted": 0,
};

export function runnerOs(labels: string[]): RunnerOs {
  const all = labels.join(" ").toLowerCase();
  if (all.includes("self-hosted")) return "self-hosted";
  if (all.includes("macos")) return "macos";
  if (all.includes("windows")) return "windows";
  return "linux";
}

/** GitHub bills each job rounded up to the next whole minute. */
export function billableMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}
