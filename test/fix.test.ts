import { describe, expect, it } from "vitest";
import { applyPatch, planFixes } from "../src/fix.js";
import { scan } from "../src/scan.js";
import { sample } from "./helpers.js";

describe("applyPatch", () => {
  it("keeps comments, key order and flow lists", () => {
    const src = "# top comment\nname: CI\non:\n  pull_request:\n    branches: [main] # only main\njobs:\n  a:\n    runs-on: ubuntu-latest # cheap\n    steps: []\n";
    const out = applyPatch(src, [
      { op: "insertAfter", path: ["jobs", "a"], after: "runs-on", key: "timeout-minutes", value: 20 },
      { op: "set", path: ["on", "pull_request", "paths-ignore"], value: ["**.md"] },
    ]);
    expect(out).toContain("# top comment");
    expect(out).toContain("branches: [main] # only main");
    expect(out).toContain("runs-on: ubuntu-latest # cheap\n    timeout-minutes: 20\n    steps: []");
  });

  it("turns an empty trigger into a map", () => {
    const out = applyPatch("on:\n  pull_request:\njobs: {}\n", [{ op: "set", path: ["on", "pull_request", "paths-ignore"], value: ["docs/**"] }]);
    expect(out).toContain("pull_request:\n    paths-ignore:\n      - docs/**");
  });
});

describe("planFixes on the sample repo", () => {
  it("changes only files with patchable findings and produces valid diffs", async () => {
    const r = await scan(sample(), { days: 30, maxRuns: 100 });
    const changes = planFixes(r.files, r.findings);
    expect(changes.map((c) => c.path).sort()).toEqual([".github/workflows/ci.yml", ".github/workflows/e2e.yml"]);
    const ci = changes.find((c) => c.path.endsWith("ci.yml"))!;
    expect(ci.after).toContain("# Node version matches .nvmrc");
    expect(ci.after).toContain("cache: pnpm");
    expect(ci.after).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(ci.diff).toContain("+          cache: npm");
  });
});
