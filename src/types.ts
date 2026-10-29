// Shapes we keep from the GitHub REST API. Only the fields CI Doctor reads.

export interface Run {
  id: number;
  name: string;
  /** Workflow file path, e.g. ".github/workflows/ci.yml". */
  path: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string;
  run_attempt: number;
  created_at: string;
  run_started_at: string;
  updated_at: string;
  html_url: string;
}

export interface Job {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  labels: string[];
  html_url: string;
}

export interface WorkflowFile {
  path: string;
  content: string;
}

export type RunnerOs = "linux" | "windows" | "macos" | "self-hosted";

export interface JobStats {
  /** Job name as the API shows it, matrix suffix removed. */
  name: string;
  os: RunnerOs;
  runs: number;
  minutes: number;
  cost: number;
  p95Minutes: number;
  maxMinutes: number;
  /** Each completed run's duration in minutes, used by the timeout rule. */
  durations: number[];
}

export interface WorkflowStats {
  path: string;
  name: string;
  runs: number;
  failed: number;
  minutes: number;
  cost: number;
  /** Minutes spent on runs that a newer push to the same branch made useless. */
  supersededMinutes: number;
  jobs: JobStats[];
}

/** One edit to a workflow file, applied with the yaml Document API. */
export type PatchOp =
  | { op: "set"; path: (string | number)[]; value: unknown }
  /** Add a key to the map at `path`, right after `after`, so the file stays readable. */
  | { op: "insertAfter"; path: (string | number)[]; after: string; key: string; value: unknown };

export interface Finding {
  rule: string;
  level: "fix" | "warn";
  file: string;
  line: number;
  job?: string;
  message: string;
  /** Rough minutes saved over the scanned window, or null when we can't tell. */
  minutesSaved: number | null;
  patch: PatchOp[];
}
