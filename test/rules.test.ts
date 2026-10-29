import { describe, expect, it } from "vitest";
import { costlyRunner, noCache, noConcurrency, noPathFilter, noTimeout } from "../src/rules/index.js";
import type { WorkflowStats } from "../src/types.js";
import { wf } from "./helpers.js";

const stats = (jobs: Partial<WorkflowStats["jobs"][number]>[], extra: Partial<WorkflowStats> = {}): WorkflowStats => ({
  path: ".github/workflows/x.yml",
  name: "X",
  runs: 10,
  failed: 0,
  minutes: 0,
  cost: 0,
  supersededMinutes: 0,
  jobs: jobs.map((j) => ({ name: "test", os: "linux", runs: 10, minutes: 0, cost: 0, p95Minutes: 0, maxMinutes: 0, durations: [], ...j })),
  ...extra,
});

describe("no-cache", () => {
  const yml = `on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
`;
  it("flags install without cache and points at the job line", () => {
    const [f] = noCache(wf(yml), stats([{}]));
    expect(f).toMatchObject({ rule: "no-cache", line: 3, job: "test", minutesSaved: 5 });
    expect(f!.patch).toEqual([{ op: "set", path: ["jobs", "test", "steps", 0, "with", "cache"], value: "npm" }]);
  });
  it("skips jobs that already cache", () => {
    expect(noCache(wf(yml.replace("{ node-version: 22 }", "{ node-version: 22, cache: npm }")), undefined)).toEqual([]);
    expect(noCache(wf(yml.replace("      - run: npm ci", "      - uses: actions/cache@v4\n      - run: npm ci")), undefined)).toEqual([]);
  });
  it("skips release workflows (cache poisoning risk)", () => {
    expect(noCache(wf(yml, ".github/workflows/release.yml"), undefined)).toEqual([]);
  });
  it("warns when pnpm is set up after setup-node", () => {
    const [f] = noCache(wf(yml.replace("npm ci", "pnpm install")), undefined);
    expect(f!.message).toContain("pnpm/action-setup must run before setup-node");
  });
});

describe("no-concurrency", () => {
  it("adds a cancel group to PR workflows and reports superseded minutes", () => {
    const [f] = noConcurrency(wf("on: [push, pull_request]\njobs: {}\n"), stats([], { supersededMinutes: 42 }));
    expect(f!.minutesSaved).toBe(42);
    expect(f!.patch[0]).toMatchObject({ op: "insertAfter", after: "on", key: "concurrency" });
  });
  it("leaves workflows that already have one", () => {
    expect(noConcurrency(wf("on: pull_request\nconcurrency: ci\njobs: {}\n"), undefined)).toEqual([]);
    expect(noConcurrency(wf("on: push\njobs: {}\n"), undefined)).toEqual([]);
  });
});

describe("no-path-filter", () => {
  it("never touches release workflow triggers", () => {
    expect(noPathFilter(wf("name: Deploy\non: pull_request\njobs: {}\n"), undefined)).toEqual([]);
  });
  it("skips when paths are already set", () => {
    expect(noPathFilter(wf("on:\n  pull_request:\n    paths: [src/**]\njobs: {}\n"), undefined)).toEqual([]);
  });
});

describe("costly-runner", () => {
  const job = (runsOn: string, step = "npm test") => `on: push\njobs:\n  test:\n    runs-on: ${runsOn}\n    steps:\n      - run: ${step}\n`;
  it("warns on macOS with no macOS-only step and estimates the saving", () => {
    const [f] = costlyRunner(wf(job("macos-latest")), stats([{ os: "macos", cost: 10 }]));
    expect(f).toMatchObject({ level: "warn", patch: [] });
    expect(f!.message).toContain("$9.00 of $10.00");
  });
  it("stays quiet for real platform work, Linux, or matrix runners", () => {
    expect(costlyRunner(wf(job("macos-latest", "xcodebuild test")), undefined)).toEqual([]);
    expect(costlyRunner(wf(job("ubuntu-latest")), undefined)).toEqual([]);
    expect(costlyRunner(wf(job("${{ matrix.os }}")), undefined)).toEqual([]);
  });
});

describe("no-timeout", () => {
  const yml = "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
  it("sets p95 x 1.5 for long jobs and counts minutes past it", () => {
    const [f] = noTimeout(wf(yml), stats([{ p95Minutes: 40, maxMinutes: 360, durations: [30, 40, 360] }]));
    expect(f!.patch[0]).toMatchObject({ key: "timeout-minutes", value: 60 });
    expect(f!.minutesSaved).toBe(300);
  });
  it("ignores short jobs", () => {
    expect(noTimeout(wf(yml), stats([{ p95Minutes: 5, maxMinutes: 6, durations: [5, 6] }]))).toEqual([]);
  });
});
