import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Octokit } from "@octokit/rest";
import type { Job, Run, WorkflowFile } from "./types.js";

/** Everything CI Doctor reads from GitHub. Tests and demos use FixtureSource. */
export interface CiSource {
  listRuns(sinceDays: number, maxRuns: number): Promise<Run[]>;
  listJobs(runId: number): Promise<Job[]>;
  getRun(runId: number): Promise<Run>;
  getJobLog(jobId: number): Promise<string>;
  listWorkflowFiles(): Promise<WorkflowFile[]>;
}

export interface Repo {
  owner: string;
  repo: string;
}

export function parseRepo(value: string): Repo {
  const [owner, repo] = value.replace(/^https:\/\/github\.com\//, "").split("/");
  if (!owner || !repo) throw new Error(`Expected owner/name, got "${value}"`);
  return { owner, repo: repo.replace(/\.git$/, "") };
}

const pickRun = (r: Record<string, any>): Run => ({
  id: r.id,
  name: r.name ?? "",
  path: r.path,
  event: r.event,
  status: r.status,
  conclusion: r.conclusion,
  head_branch: r.head_branch,
  head_sha: r.head_sha,
  run_attempt: r.run_attempt ?? 1,
  created_at: r.created_at,
  run_started_at: r.run_started_at ?? r.created_at,
  updated_at: r.updated_at,
  html_url: r.html_url,
});

const pickJob = (j: Record<string, any>): Job => ({
  id: j.id,
  run_id: j.run_id,
  name: j.name,
  status: j.status,
  conclusion: j.conclusion,
  started_at: j.started_at,
  completed_at: j.completed_at,
  labels: j.labels ?? [],
  html_url: j.html_url,
});

export class GitHubSource implements CiSource {
  constructor(
    readonly octokit: Octokit,
    readonly repo: Repo,
  ) {}

  async listRuns(sinceDays: number, maxRuns: number): Promise<Run[]> {
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
    const runs: Run[] = [];
    for await (const page of this.octokit.paginate.iterator(this.octokit.actions.listWorkflowRunsForRepo, {
      ...this.repo,
      created: `>=${since}`,
      per_page: 100,
    })) {
      for (const r of page.data) {
        // Dynamic workflows (Dependabot, Pages) have no file we can fix.
        if (r.path?.startsWith(".github/workflows/") && r.status === "completed") runs.push(pickRun(r));
      }
      if (runs.length >= maxRuns) break;
    }
    return runs.slice(0, maxRuns);
  }

  async listJobs(runId: number): Promise<Job[]> {
    const jobs = await this.octokit.paginate(this.octokit.actions.listJobsForWorkflowRun, {
      ...this.repo,
      run_id: runId,
      filter: "all",
      per_page: 100,
    });
    return jobs.map(pickJob);
  }

  async getRun(runId: number): Promise<Run> {
    const { data } = await this.octokit.actions.getWorkflowRun({ ...this.repo, run_id: runId });
    return pickRun(data);
  }

  async getJobLog(jobId: number): Promise<string> {
    const { data } = await this.octokit.actions.downloadJobLogsForWorkflowRun({ ...this.repo, job_id: jobId });
    return String(data);
  }

  async listWorkflowFiles(): Promise<WorkflowFile[]> {
    const { data } = await this.octokit.repos.getContent({ ...this.repo, path: ".github/workflows" });
    if (!Array.isArray(data)) return [];
    const files: WorkflowFile[] = [];
    for (const entry of data) {
      if (entry.type !== "file" || !/\.ya?ml$/.test(entry.name)) continue;
      const { data: file } = await this.octokit.repos.getContent({ ...this.repo, path: entry.path });
      if (!Array.isArray(file) && file.type === "file") {
        files.push({ path: entry.path, content: Buffer.from(file.content, "base64").toString("utf8") });
      }
    }
    return files;
  }
}

/**
 * Reads a folder laid out like:
 *   runs.json, jobs/<runId>.json, logs/<jobId>.txt, workflows/<name>.yml
 * Used by tests, by `--fixtures` for offline demos, and written by `--record`.
 */
export class FixtureSource implements CiSource {
  constructor(readonly dir: string) {}

  private async json<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(join(this.dir, file), "utf8")) as T;
  }

  async listRuns(_sinceDays: number, maxRuns: number) {
    return (await this.json<Run[]>("runs.json")).slice(0, maxRuns);
  }
  async listJobs(runId: number) {
    return this.json<Job[]>(`jobs/${runId}.json`).catch(() => []);
  }
  async getRun(runId: number) {
    const run = (await this.json<Run[]>("runs.json")).find((r) => r.id === runId);
    if (!run) throw new Error(`Run ${runId} not in fixtures`);
    return run;
  }
  async getJobLog(jobId: number) {
    return readFile(join(this.dir, "logs", `${jobId}.txt`), "utf8");
  }
  async listWorkflowFiles() {
    const names = (await readdir(join(this.dir, "workflows"))).filter((n) => /\.ya?ml$/.test(n)).sort();
    return Promise.all(
      names.map(async (n) => ({ path: `.github/workflows/${n}`, content: await readFile(join(this.dir, "workflows", n), "utf8") })),
    );
  }
}

/** Wraps a source and saves every response in FixtureSource layout. */
export class RecordingSource implements CiSource {
  private runs: Run[] = [];
  constructor(
    readonly inner: CiSource,
    readonly dir: string,
  ) {}

  private async save(file: string, data: string) {
    const path = join(this.dir, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, data);
  }

  async listRuns(sinceDays: number, maxRuns: number) {
    this.runs = await this.inner.listRuns(sinceDays, maxRuns);
    await this.save("runs.json", JSON.stringify(this.runs, null, 2));
    return this.runs;
  }
  async listJobs(runId: number) {
    const jobs = await this.inner.listJobs(runId);
    await this.save(`jobs/${runId}.json`, JSON.stringify(jobs, null, 2));
    return jobs;
  }
  async getRun(runId: number) {
    const run = await this.inner.getRun(runId);
    if (!this.runs.some((r) => r.id === run.id)) {
      this.runs.push(run);
      await this.save("runs.json", JSON.stringify(this.runs, null, 2));
    }
    return run;
  }
  async getJobLog(jobId: number) {
    const log = await this.inner.getJobLog(jobId);
    await this.save(`logs/${jobId}.txt`, log);
    return log;
  }
  async listWorkflowFiles() {
    const files = await this.inner.listWorkflowFiles();
    for (const f of files) await this.save(`workflows/${f.path.split("/").pop()}`, f.content);
    return files;
  }
}

/** Runs `fn` over items with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
