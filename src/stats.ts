import { billableMinutes, RATES, runnerOs } from "./pricing.js";
import type { Job, JobStats, Run, WorkflowStats } from "./types.js";

const seconds = (from: string | null, to: string | null) =>
  from && to ? Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000) : 0;

/** "test (ubuntu, 20)" -> "test". Matrix jobs share one entry. */
export function baseJobName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").trim();
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function buildStats(runs: Run[], jobsByRun: Map<number, Job[]>): WorkflowStats[] {
  const byPath = new Map<string, Run[]>();
  for (const run of runs) {
    const list = byPath.get(run.path) ?? [];
    list.push(run);
    byPath.set(run.path, list);
  }

  const result: WorkflowStats[] = [];
  for (const [path, wfRuns] of byPath) {
    const jobs = new Map<string, JobStats>();
    const runMinutes = new Map<number, number>();
    let minutes = 0;
    let cost = 0;

    for (const run of wfRuns) {
      let thisRun = 0;
      for (const job of jobsByRun.get(run.id) ?? []) {
        if (!job.started_at || !job.completed_at || job.conclusion === "skipped") continue;
        const os = runnerOs(job.labels);
        const secs = seconds(job.started_at, job.completed_at);
        const billed = billableMinutes(secs);
        const name = baseJobName(job.name);
        const stats = jobs.get(name) ?? { name, os, runs: 0, minutes: 0, cost: 0, p95Minutes: 0, maxMinutes: 0, durations: [] };
        stats.runs += 1;
        stats.minutes += billed;
        stats.cost += billed * RATES[os];
        stats.durations.push(round(secs / 60));
        jobs.set(name, stats);
        thisRun += billed;
        minutes += billed;
        cost += billed * RATES[os];
      }
      runMinutes.set(run.id, thisRun);
    }

    for (const j of jobs.values()) {
      j.cost = round(j.cost);
      j.p95Minutes = round(percentile(j.durations, 95));
      j.maxMinutes = round(Math.max(0, ...j.durations));
    }

    result.push({
      path,
      name: wfRuns[0]!.name,
      runs: wfRuns.length,
      failed: wfRuns.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length,
      minutes,
      cost: round(cost),
      supersededMinutes: supersededMinutes(wfRuns, runMinutes),
      jobs: [...jobs.values()].sort((a, b) => b.cost - a.cost || b.minutes - a.minutes),
    });
  }
  return result.sort((a, b) => b.cost - a.cost || b.minutes - a.minutes);
}

/**
 * A PR run is superseded when a newer run of the same workflow starts on the
 * same branch before it finishes. `concurrency: cancel-in-progress` saves those minutes.
 */
function supersededMinutes(runs: Run[], runMinutes: Map<number, number>): number {
  const prRuns = runs.filter((r) => r.event === "pull_request" && r.head_branch);
  let total = 0;
  for (const run of prRuns) {
    const finished = Date.parse(run.updated_at);
    const started = Date.parse(run.run_started_at);
    const newer = prRuns.some(
      (o) => o.id !== run.id && o.head_branch === run.head_branch && Date.parse(o.run_started_at) > started && Date.parse(o.run_started_at) < finished,
    );
    if (newer) total += runMinutes.get(run.id) ?? 0;
  }
  return total;
}
