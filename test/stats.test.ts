import { describe, expect, it } from "vitest";
import { billableMinutes, runnerOs } from "../src/pricing.js";
import { scan } from "../src/scan.js";
import { baseJobName, percentile } from "../src/stats.js";
import { sample } from "./helpers.js";

describe("pricing", () => {
  it("rounds each job up to a whole minute", () => {
    expect(billableMinutes(1)).toBe(1);
    expect(billableMinutes(61)).toBe(2);
  });
  it("reads the runner OS from labels", () => {
    expect(runnerOs(["macos-14"])).toBe("macos");
    expect(runnerOs(["windows-latest"])).toBe("windows");
    expect(runnerOs(["self-hosted", "linux"])).toBe("self-hosted");
    expect(runnerOs(["ubuntu-latest"])).toBe("linux");
  });
});

describe("stats", () => {
  it("groups matrix jobs by base name", () => {
    expect(baseJobName("test (ubuntu-latest, 20)")).toBe("test");
  });
  it("computes percentiles", () => {
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([], 95)).toBe(0);
  });

  it("builds a cost table from recorded runs", async () => {
    const { stats } = await scan(sample(), { days: 30, maxRuns: 100 });
    const e2e = stats.find((s) => s.path.endsWith("e2e.yml"))!;
    expect(stats[0]).toBe(e2e); // most expensive first
    expect(e2e.minutes).toBe(32 + 35 + 38 + 41 + 90);
    expect(e2e.cost).toBeCloseTo(236 * 0.08);
    expect(e2e.jobs[0]!.os).toBe("macos");

    const ci = stats.find((s) => s.path.endsWith("ci.yml"))!;
    expect(ci.failed).toBe(2);
    // The first PR run on feat/cart was overtaken by a newer push.
    expect(ci.supersededMinutes).toBe(10);
    // Skipped jobs are not billed.
    expect(ci.jobs.find((j) => j.name === "Build app")!.runs).toBe(4);
  });
});
