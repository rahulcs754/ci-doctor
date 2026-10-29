import type { FileChange } from "./fix.js";
import type { ScanResult } from "./scan.js";
import type { WhyResult } from "./why.js";

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function scanMarkdown(r: ScanResult, repo: string): string {
  const minutes = r.stats.reduce((s, w) => s + w.minutes, 0);
  const cost = r.stats.reduce((s, w) => s + w.cost, 0);
  const saved = r.findings.reduce((s, f) => s + (f.minutesSaved ?? 0), 0);
  const out: string[] = [
    `# CI Doctor report: ${repo}`,
    "",
    `Last ${r.days} days, ${r.runs} runs, **${minutes} billable minutes**, about **${money(cost)}** at list price.`,
    r.findings.length ? `${r.findings.length} findings. The ones we can measure would have saved about **${saved} minutes**.` : "No findings. Nice.",
    "",
    "## Workflows",
    "",
    "| Workflow | Runs | Failed | Minutes | Est. cost | Superseded min |",
    "|---|---:|---:|---:|---:|---:|",
    ...r.stats.map((w) => `| ${cell(w.name)} (\`${w.path.split("/").pop()}\`) | ${w.runs} | ${pct(w.failed, w.runs)} | ${w.minutes} | ${money(w.cost)} | ${w.supersededMinutes} |`),
    "",
  ];

  const jobs = r.stats
    .flatMap((w) => w.jobs.map((j) => ({ ...j, wf: w.path.split("/").pop() })))
    .sort((a, b) => b.cost - a.cost || b.minutes - a.minutes)
    .slice(0, 10);
  if (jobs.length) {
    out.push(
      "## Top jobs",
      "",
      "| Job | Workflow | Runner | Runs | Minutes | p95 min | Est. cost |",
      "|---|---|---|---:|---:|---:|---:|",
      ...jobs.map((j) => `| ${cell(j.name)} | ${j.wf} | ${j.os} | ${j.runs} | ${j.minutes} | ${j.p95Minutes} | ${money(j.cost)} |`),
      "",
    );
  }

  if (r.findings.length) {
    out.push(
      "## Findings",
      "",
      "| Rule | Where | Saves | What to do |",
      "|---|---|---:|---|",
      ...r.findings.map(
        (f) => `| ${f.level === "warn" ? "⚠️ " : ""}\`${f.rule}\` | \`${f.file}:${f.line}\` | ${f.minutesSaved == null ? "-" : `${f.minutesSaved} min`} | ${cell(f.message)} |`,
      ),
      "",
      "Run `ci-doctor fix` to see the YAML diff, or `ci-doctor fix --open-pr` to open a PR.",
      "",
    );
  }
  for (const s of r.skipped) out.push(`> Skipped \`${s.path}\`: ${s.reason}`);
  out.push("", "_Costs use GitHub list prices from `src/pricing.ts`. Free plan minutes are not subtracted. Savings are estimates._");
  return out.join("\n") + "\n";
}

export function whyMarkdown(r: WhyResult): string {
  const out = [`# Why did run ${r.run.id} fail?`, "", `${r.run.name} on \`${r.run.head_branch ?? r.run.head_sha.slice(0, 7)}\`: ${r.run.html_url}`, ""];
  if (!r.jobs.length) out.push(`No failed jobs (run conclusion: ${r.run.conclusion ?? r.run.status}).`);
  for (const { job, diagnosis: d, explanation } of r.jobs) {
    out.push(`## ${job.name}: ${d.title}${d.flaky ? " (likely flaky)" : ""}`, "", "```", ...d.keyLines, "```", "", `**Fix:** ${d.fix}`, "");
    if (explanation) out.push(`**Claude:** ${explanation}`, "");
  }
  out.push(`This workflow failed ${r.history.failed} of ${r.history.runs} runs in the last ${r.history.days} days.`);
  return out.join("\n") + "\n";
}

export function changesSummary(changes: FileChange[]): string {
  if (!changes.length) return "Nothing to fix automatically.\n";
  return changes.map((c) => c.diff).join("\n");
}
