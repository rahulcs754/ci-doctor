import { runRules } from "./rules/index.js";
import { mapLimit, type CiSource } from "./source.js";
import { buildStats } from "./stats.js";
import type { Finding, Job, WorkflowFile, WorkflowStats } from "./types.js";
import { parseWorkflow, type ParsedWorkflow } from "./workflow.js";

export interface ScanOptions {
  days: number;
  maxRuns: number;
  rules?: string[];
}

export interface ScanResult {
  days: number;
  runs: number;
  stats: WorkflowStats[];
  files: WorkflowFile[];
  findings: Finding[];
  /** Files we could not parse, with the reason. */
  skipped: { path: string; reason: string }[];
}

export async function scan(source: CiSource, opts: ScanOptions): Promise<ScanResult> {
  const [runs, files] = await Promise.all([source.listRuns(opts.days, opts.maxRuns), source.listWorkflowFiles()]);
  const jobLists = await mapLimit(runs, 8, (r) => source.listJobs(r.id));
  const jobsByRun = new Map<number, Job[]>(runs.map((r, i) => [r.id, jobLists[i]!]));
  const stats = buildStats(runs, jobsByRun);

  const parsed: ParsedWorkflow[] = [];
  const skipped: ScanResult["skipped"] = [];
  for (const f of files) {
    try {
      parsed.push(parseWorkflow(f));
    } catch (e) {
      skipped.push({ path: f.path, reason: (e as Error).message });
    }
  }

  return { days: opts.days, runs: runs.length, stats, files, findings: runRules(parsed, stats, opts.rules), skipped };
}
