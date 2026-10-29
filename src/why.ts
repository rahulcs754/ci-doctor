import { describe, diagnose, type Diagnosis } from "./diagnose.js";
import { explain } from "./explain.js";
import type { CiSource } from "./source.js";
import type { Job, Run } from "./types.js";

export interface JobDiagnosis {
  job: Job;
  diagnosis: Diagnosis;
  explanation: string | null;
}

export interface WhyResult {
  run: Run;
  jobs: JobDiagnosis[];
  history: { days: number; runs: number; failed: number };
}

const FAILED = new Set(["failure", "timed_out"]);

export async function why(source: CiSource, runId: number, opts: { ai: boolean; days?: number }): Promise<WhyResult> {
  const days = opts.days ?? 30;
  const run = await source.getRun(runId);
  const failedJobs = (await source.listJobs(runId)).filter((j) => FAILED.has(j.conclusion ?? ""));

  const jobs: JobDiagnosis[] = [];
  for (const job of failedJobs) {
    const diagnosis = diagnose(await source.getJobLog(job.id));
    if (job.conclusion === "timed_out" && diagnosis.category === "unknown") {
      Object.assign(diagnosis, describe("timeout"));
    }
    const explanation = opts.ai && diagnosis.category === "unknown" ? await explain(diagnosis, job.name).catch(() => null) : null;
    jobs.push({ job, diagnosis, explanation });
  }

  const recent = (await source.listRuns(days, 500)).filter((r) => r.path === run.path);
  return {
    run,
    jobs,
    history: { days, runs: recent.length, failed: recent.filter((r) => FAILED.has(r.conclusion ?? "")).length },
  };
}
