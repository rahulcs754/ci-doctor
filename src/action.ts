import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import { scanMarkdown } from "./report.js";
import { scan } from "./scan.js";
import { GitHubSource, parseRepo } from "./source.js";

async function main() {
  const token = core.getInput("github-token", { required: true });
  const repoName = core.getInput("repo") || process.env.GITHUB_REPOSITORY!;
  const days = Number(core.getInput("days") || 30);
  const maxRuns = Number(core.getInput("max-runs") || 300);

  const repo = parseRepo(repoName);
  const result = await scan(new GitHubSource(new Octokit({ auth: token, userAgent: "ci-doctor-action" }), repo), { days, maxRuns });
  const md = scanMarkdown(result, repoName);

  await core.summary.addRaw(md).write();
  core.setOutput("minutes", result.stats.reduce((s, w) => s + w.minutes, 0));
  core.setOutput("cost", result.stats.reduce((s, w) => s + w.cost, 0).toFixed(2));
  core.setOutput("findings", result.findings.length);
  core.setOutput("queue-p50-minutes", result.queue.p50Minutes);
  core.setOutput("queue-p95-minutes", result.queue.p95Minutes);
  core.setOutput("report", md);

  const maxQueue = Number(core.getInput("max-queue-minutes") || 0);
  if (maxQueue > 0 && result.queue.p95Minutes > maxQueue) {
    core.setFailed(`CI queue p95 wait is ${result.queue.p95Minutes} min, above max-queue-minutes (${maxQueue}).`);
  }

  if (core.getBooleanInput("fail-on-findings") && result.findings.some((f) => f.level === "fix")) {
    core.setFailed(`CI Doctor found ${result.findings.length} issue(s). See the job summary.`);
  }
}

main().catch((e: Error) => core.setFailed(e.message));
