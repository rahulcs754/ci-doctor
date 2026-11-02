import { percentile } from "./stats.js";
import type { Job, Run } from "./types.js";

/**
 * Queue wait = time a job sat waiting for a runner (created -> started).
 * Heavy agent traffic (many PRs, many pushes) can push this to 30-45 minutes,
 * and it is invisible in billable minutes because waiting is not billed.
 */

export interface QueueGroup {
  /** Runner label, e.g. "ubuntu-latest", "macos-14", "self-hosted". */
  runner: string;
  jobs: number;
  p50Minutes: number;
  p95Minutes: number;
  maxMinutes: number;
  /** Total minutes developers (or agents) spent waiting. */
  totalMinutes: number;
}

export interface QueuePeak {
  /** Hour of day in UTC, 0-23. */
  hour: number;
  jobs: number;
  p95Minutes: number;
}

export interface QueueStats {
  jobs: number;
  p50Minutes: number;
  p95Minutes: number;
  maxMinutes: number;
  totalMinutes: number;
  byRunner: QueueGroup[];
  /** The busiest hour by p95 wait, when there is enough data. */
  peak?: QueuePeak;
  /** Advice when the wait is long. Empty when the queue looks fine. */
  advice: string[];
}

/** p95 wait above this many minutes gets advice. */
export const SLOW_QUEUE_MINUTES = 10;

const round = (n: number) => Math.round(n * 10) / 10;

/** Minutes a job waited for a runner, or null when the API did not give us both times. */
export function queueMinutes(job: Job): number | null {
  if (!job.created_at || !job.started_at || job.conclusion === "skipped") return null;
  const ms = Date.parse(job.started_at) - Date.parse(job.created_at);
  return Number.isFinite(ms) ? Math.max(0, ms / 60_000) : null;
}

/** The label that picks the runner pool. "self-hosted" plus its first custom label. */
export function runnerLabel(labels: string[]): string {
  if (!labels.length) return "unknown";
  const self = labels.findIndex((l) => l.toLowerCase() === "self-hosted");
  if (self >= 0) {
    const extra = labels.find((l, i) => i !== self && !/^(linux|windows|macos|x64|arm64)$/i.test(l));
    return extra ? `self-hosted (${extra})` : "self-hosted";
  }
  return labels[0]!;
}

function summarize(waits: number[]) {
  return {
    p50Minutes: round(percentile(waits, 50)),
    p95Minutes: round(percentile(waits, 95)),
    maxMinutes: round(Math.max(0, ...waits)),
    totalMinutes: Math.round(waits.reduce((s, w) => s + w, 0)),
  };
}

export function buildQueueStats(runs: Run[], jobsByRun: Map<number, Job[]>): QueueStats {
  const all: number[] = [];
  const byRunner = new Map<string, number[]>();
  const byHour = new Map<number, number[]>();

  for (const run of runs) {
    for (const job of jobsByRun.get(run.id) ?? []) {
      const wait = queueMinutes(job);
      if (wait == null) continue;
      all.push(wait);
      const label = runnerLabel(job.labels);
      byRunner.set(label, [...(byRunner.get(label) ?? []), wait]);
      const hour = new Date(job.created_at!).getUTCHours();
      byHour.set(hour, [...(byHour.get(hour) ?? []), wait]);
    }
  }

  const groups: QueueGroup[] = [...byRunner].map(([runner, waits]) => ({ runner, jobs: waits.length, ...summarize(waits) }));
  groups.sort((a, b) => b.p95Minutes - a.p95Minutes || b.totalMinutes - a.totalMinutes);

  let peak: QueuePeak | undefined;
  for (const [hour, waits] of byHour) {
    if (waits.length < 3) continue; // one slow job is not a pattern
    const p95 = round(percentile(waits, 95));
    if (!peak || p95 > peak.p95Minutes) peak = { hour, jobs: waits.length, p95Minutes: p95 };
  }

  const overall = summarize(all);
  return { jobs: all.length, ...overall, byRunner: groups, peak, advice: advise(overall.p95Minutes, groups) };
}

function advise(p95: number, groups: QueueGroup[]): string[] {
  const slow = groups.filter((g) => g.p95Minutes >= SLOW_QUEUE_MINUTES);
  if (!slow.length && p95 < SLOW_QUEUE_MINUTES) return [];
  const out: string[] = [];
  for (const g of slow) {
    const where = g.runner.startsWith("self-hosted")
      ? "Add runners to this pool or turn on autoscaling (for example actions-runner-controller)."
      : /macos|windows/i.test(g.runner)
        ? "macOS and Windows hosted runners have small concurrency limits. Move jobs that do not need this OS to Linux."
        : "You may be at your plan's concurrent job limit. Larger runners or a higher plan raise it.";
    out.push(`\`${g.runner}\`: p95 wait ${g.p95Minutes} min (max ${g.maxMinutes}). ${where}`);
  }
  out.push(
    "Cut queue load from many PRs and agent pushes: add `concurrency` with `cancel-in-progress` on PR workflows (the `no-concurrency` fix), skip docs-only changes (`no-path-filter`), and batch merges with a merge queue.",
  );
  return out;
}
