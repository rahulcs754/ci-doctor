import { isMap, type YAMLMap } from "yaml";
import { RATES, runnerOs } from "../pricing.js";
import type { Finding, JobStats, WorkflowStats } from "../types.js";
import { isReleaseWorkflow, keyLine, runsOn, stepsOf, type ParsedWorkflow } from "../workflow.js";

/** A rule reads one workflow plus its run stats and returns findings. No I/O. */
export type Rule = (wf: ParsedWorkflow, stats: WorkflowStats | undefined) => Finding[];

/** Rough time a warm dependency cache saves on one job run. Kept low on purpose. */
const CACHE_SAVING_MIN = 0.5;
const LONG_JOB_MIN = 30;

const jobLine = (wf: ParsedWorkflow, key: string) => keyLine(wf, wf.doc.get("jobs") as YAMLMap, key);

const onLine = (wf: ParsedWorkflow) => keyLine(wf, wf.doc.contents as YAMLMap, "on");

/** Match a YAML job to its stats. API names are the job `name:` (expressions filled in) or the key. */
export function findJobStats(stats: WorkflowStats | undefined, job: { key: string; name: string }): JobStats | undefined {
  if (!stats) return undefined;
  const exact = stats.jobs.find((s) => s.name === job.name || s.name === job.key);
  if (exact) return exact;
  const prefix = job.name.split("${{")[0]!.trim();
  return job.name.includes("${{") && prefix ? stats.jobs.find((s) => s.name.startsWith(prefix)) : undefined;
}

const INSTALL = /\b(npm (ci|install|i)|pnpm (install|i)|yarn( install)?)(\s|$|;|&)/m;

function packageManager(cmd: string): "npm" | "pnpm" | "yarn" {
  if (/\bpnpm\b/.test(cmd)) return "pnpm";
  if (/\byarn\b/.test(cmd)) return "yarn";
  return "npm";
}

export const noCache: Rule = (wf, stats) => {
  // Caches in release workflows can be poisoned by PR runs, so leave those alone.
  if (isReleaseWorkflow(wf)) return [];
  const findings: Finding[] = [];
  for (const job of wf.jobs) {
    const steps = stepsOf(job.node);
    const install = steps.find((s) => s.run && INSTALL.test(s.run));
    const setup = steps.find((s) => s.uses?.startsWith("actions/setup-node"));
    if (!install || !setup) continue;
    if (steps.some((s) => s.uses?.startsWith("actions/cache"))) continue;
    const withNode = setup.node.get("with");
    if (isMap(withNode) && withNode.has("cache")) continue;

    const pm = packageManager(install.run!);
    const command = install.run!.match(INSTALL)![1]!;
    const runs = findJobStats(stats, job)?.runs;
    const needsPnpmSetup = pm === "pnpm" && !steps.some((s) => s.index < setup.index && s.uses?.startsWith("pnpm/action-setup"));
    findings.push({
      rule: "no-cache",
      level: "fix",
      file: wf.path,
      line: jobLine(wf, job.key),
      job: job.key,
      message:
        `Job "${job.key}" runs \`${command}\` with no dependency cache. Add \`cache: ${pm}\` to setup-node.` +
        (needsPnpmSetup ? " pnpm/action-setup must run before setup-node for this to work." : ""),
      minutesSaved: runs ? Math.round(runs * CACHE_SAVING_MIN) : null,
      patch: [{ op: "set", path: ["jobs", job.key, "steps", setup.index, "with", "cache"], value: pm }],
    });
  }
  return findings;
};

export const noConcurrency: Rule = (wf, stats) => {
  if (!wf.triggers.includes("pull_request") || isReleaseWorkflow(wf)) return [];
  if (wf.doc.has("concurrency") || wf.jobs.some((j) => j.node.has("concurrency"))) return [];
  return [
    {
      rule: "no-concurrency",
      level: "fix",
      file: wf.path,
      line: onLine(wf),
      message: "Every push to a PR starts a new run while the old one keeps going. Cancel the old run with a `concurrency` group.",
      minutesSaved: stats ? stats.supersededMinutes : null,
      patch: [
        {
          op: "insertAfter",
          path: [],
          after: "on",
          key: "concurrency",
          value: {
            group: "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
            // Only cancel on PRs, so pushes to main always finish.
            "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
          },
        },
      ],
    },
  ];
};

export const DOCS_ONLY = ["**.md", "docs/**", "LICENSE"];

export const noPathFilter: Rule = (wf) => {
  if (!wf.triggers.includes("pull_request") || isReleaseWorkflow(wf)) return [];
  const on = wf.doc.get("on");
  if (isMap(on)) {
    const pr = on.get("pull_request");
    if (isMap(pr) && (pr.has("paths") || pr.has("paths-ignore"))) return [];
  }
  const patch: Finding["patch"] = isMap(on)
    ? [{ op: "set", path: ["on", "pull_request", "paths-ignore"], value: DOCS_ONLY }]
    : // `on: pull_request` or `on: [push, pull_request]` must become a map first.
      [{ op: "set", path: ["on"], value: Object.fromEntries(wf.triggers.map((t) => [t, t === "pull_request" ? { "paths-ignore": DOCS_ONLY } : {}])) }];
  return [
    {
      rule: "no-path-filter",
      level: "fix",
      file: wf.path,
      line: onLine(wf),
      message:
        "Docs-only PRs run the full workflow. Skip them with `paths-ignore`. If this workflow is a required check, docs PRs will wait on it, so use a paths filter job instead.",
      minutesSaved: null,
      patch,
    },
  ];
};

/** Steps that really need macOS or Windows. */
const PLATFORM_ONLY = /\b(xcodebuild|xcrun|xcode-select|pod install|swift (build|test)|fastlane|codesign|notarytool|msbuild|choco|signtool|nuget|\.exe\b|Set-ExecutionPolicy|brew )/i;

export const costlyRunner: Rule = (wf, stats) => {
  const findings: Finding[] = [];
  for (const job of wf.jobs) {
    const label = runsOn(job.node);
    if (!label || label.includes("${{")) continue;
    const os = runnerOs([label]);
    if (os !== "macos" && os !== "windows") continue;
    const steps = stepsOf(job.node);
    const platformStep = steps.some(
      (s) =>
        (s.run && PLATFORM_ONLY.test(s.run)) ||
        (s.shell && /^(pwsh|powershell|cmd)$/.test(s.shell)) ||
        (s.uses && /xcode|apple|ios|windows|msbuild|swift/i.test(s.uses)),
    );
    if (platformStep) continue;
    const js = findJobStats(stats, job);
    const saving = js ? ` That would cut about $${(js.cost * (1 - RATES.linux / RATES[os])).toFixed(2)} of $${js.cost.toFixed(2)} in this window.` : "";
    findings.push({
      rule: "costly-runner",
      level: "warn",
      file: wf.path,
      line: jobLine(wf, job.key),
      job: job.key,
      message: `Job "${job.key}" runs on ${label} (${RATES[os] / RATES.linux}x the Linux price) and no step looks ${os}-only. Check if ubuntu-latest works.${saving}`,
      minutesSaved: null,
      patch: [],
    });
  }
  return findings;
};

export const noTimeout: Rule = (wf, stats) => {
  const findings: Finding[] = [];
  for (const job of wf.jobs) {
    if (job.node.has("timeout-minutes")) continue;
    const js = findJobStats(stats, job);
    if (!js || js.maxMinutes < LONG_JOB_MIN) continue;
    const timeout = Math.max(10, Math.ceil(js.p95Minutes * 1.5));
    const saved = js.durations.reduce((sum, d) => sum + Math.max(0, d - timeout), 0);
    findings.push({
      rule: "no-timeout",
      level: "fix",
      file: wf.path,
      line: jobLine(wf, job.key),
      job: job.key,
      message: `Job "${job.key}" has no timeout (GitHub default is 6 hours) and its longest run took ${Math.round(js.maxMinutes)} min. Set \`timeout-minutes: ${timeout}\` (p95 x 1.5).`,
      // Mostly protection against hung jobs, so often nothing to measure yet.
      minutesSaved: saved > 0 ? Math.round(saved) : null,
      patch: [{ op: "insertAfter", path: ["jobs", job.key], after: "runs-on", key: "timeout-minutes", value: timeout }],
    });
  }
  return findings;
};

export const RULES: Record<string, Rule> = {
  "no-cache": noCache,
  "no-concurrency": noConcurrency,
  "no-path-filter": noPathFilter,
  "costly-runner": costlyRunner,
  "no-timeout": noTimeout,
};

export function runRules(workflows: ParsedWorkflow[], stats: WorkflowStats[], only?: string[]): Finding[] {
  const rules = Object.entries(RULES).filter(([id]) => !only?.length || only.includes(id));
  return workflows.flatMap((wf) => {
    const s = stats.find((x) => x.path === wf.path);
    return rules.flatMap(([, rule]) => rule(wf, s));
  });
}
