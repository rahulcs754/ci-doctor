#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Octokit } from "@octokit/rest";
import { Command } from "commander";
import { planFixes } from "./fix.js";
import { openFixPr } from "./pr.js";
import { changesSummary, scanMarkdown, whyMarkdown } from "./report.js";
import { RULES } from "./rules/index.js";
import { scan } from "./scan.js";
import { FixtureSource, GitHubSource, parseRepo, RecordingSource, type CiSource, type Repo } from "./source.js";
import { why } from "./why.js";

interface Globals {
  repo?: string;
  fixtures?: string;
  record?: string;
}

const program = new Command()
  .name("ci-doctor")
  .description("Find slow, costly and failing GitHub Actions workflows, and fix them.")
  .version("0.1.0")
  .option("-r, --repo <owner/name>", "GitHub repository (default: $GITHUB_REPOSITORY)")
  .option("--fixtures <dir>", "read recorded API data from a folder instead of GitHub")
  .option("--record <dir>", "save every API response to a folder (for tests and demos)");

function octokit(): Octokit {
  const auth = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!auth) throw new Error("Set GITHUB_TOKEN (or GH_TOKEN). Scopes: actions:read, contents:read.");
  return new Octokit({ auth, userAgent: "ci-doctor" });
}

function setup(): { source: CiSource; repo: Repo; label: string } {
  const g = program.opts<Globals>();
  const repoArg = g.repo ?? process.env.GITHUB_REPOSITORY;
  if (g.fixtures) {
    const repo = repoArg ? parseRepo(repoArg) : { owner: "fixtures", repo: g.fixtures.split("/").pop() ?? "demo" };
    return { source: new FixtureSource(g.fixtures), repo, label: `${repo.owner}/${repo.repo}` };
  }
  if (!repoArg) throw new Error("Pass --repo owner/name");
  const repo = parseRepo(repoArg);
  let source: CiSource = new GitHubSource(octokit(), repo);
  if (g.record) source = new RecordingSource(source, g.record);
  return { source, repo, label: `${repo.owner}/${repo.repo}` };
}

const int = (v: string) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Expected a positive number, got "${v}"`);
  return n;
};
const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

async function save(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

program
  .command("scan")
  .description("Rank workflows by minutes and cost, and list fixes")
  .option("--days <n>", "how many days of runs to read", int, 30)
  .option("--max-runs <n>", "stop after this many runs", int, 300)
  .option("--rules <ids>", `only these rules: ${Object.keys(RULES).join(", ")}`, list)
  .option("--out <file>", "also write the Markdown report here")
  .option("--json <file>", "also write the full result as JSON")
  .action(async (o: { days: number; maxRuns: number; rules?: string[]; out?: string; json?: string }) => {
    const { source, label } = setup();
    const result = await scan(source, o);
    const md = scanMarkdown(result, label);
    process.stdout.write(md);
    if (o.out) await save(o.out, md);
    if (o.json) await save(o.json, JSON.stringify({ ...result, files: undefined }, null, 2));
  });

program
  .command("why <runId>")
  .description("Explain why a run failed, from its job logs")
  .option("--no-ai", "never call Claude, even when ANTHROPIC_API_KEY is set")
  .action(async (runId: string, o: { ai: boolean }) => {
    const { source } = setup();
    process.stdout.write(whyMarkdown(await why(source, int(runId), { ai: o.ai })));
  });

program
  .command("fix")
  .description("Show the YAML fixes as a diff, write them locally, or open a PR")
  .option("--days <n>", "how many days of runs to read", int, 30)
  .option("--max-runs <n>", "stop after this many runs", int, 300)
  .option("--rules <ids>", "only these rules", list)
  .option("--write [dir]", "write fixed files into a local checkout (default: current folder)")
  .option("--open-pr", "commit the fixes to a new branch and open a PR (token needs the workflow scope)")
  .action(async (o: { days: number; maxRuns: number; rules?: string[]; write?: string | boolean; openPr?: boolean }) => {
    const { source, repo } = setup();
    const result = await scan(source, o);
    const changes = planFixes(result.files, result.findings);
    process.stdout.write(changesSummary(changes));
    if (!changes.length) return;

    if (o.write) {
      const root = typeof o.write === "string" ? o.write : process.cwd();
      for (const c of changes) await save(join(root, c.path), c.after);
      console.error(`Wrote ${changes.length} file(s) under ${root}`);
    }
    if (o.openPr) {
      if (program.opts<Globals>().fixtures) throw new Error("--open-pr needs a real repo, not --fixtures");
      console.error(`Opened ${await openFixPr(octokit(), repo, changes, result.findings)}`);
    }
  });

program.parseAsync().catch((e: Error) => {
  console.error(`ci-doctor: ${e.message}`);
  process.exit(1);
});
