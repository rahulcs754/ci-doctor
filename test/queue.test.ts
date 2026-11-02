import { describe, expect, it } from "vitest";
import { buildQueueStats, queueMinutes, runnerLabel } from "../src/queue.js";
import { scanMarkdown } from "../src/report.js";
import { scan } from "../src/scan.js";
import type { Job, Run } from "../src/types.js";
import { sample } from "./helpers.js";

const job = (id: number, created: string, started: string, labels = ["ubuntu-latest"], conclusion = "success"): Job => ({
  id,
  run_id: 1,
  name: "test",
  status: "completed",
  conclusion,
  created_at: created,
  started_at: started,
  completed_at: started,
  labels,
  html_url: "",
});

describe("queue wait", () => {
  it("measures created -> started", () => {
    expect(queueMinutes(job(1, "2026-10-20T10:00:00Z", "2026-10-20T10:45:00Z"))).toBe(45);
    expect(queueMinutes({ ...job(1, "x", "2026-10-20T10:00:00Z"), created_at: null })).toBeNull();
    expect(queueMinutes(job(1, "2026-10-20T10:00:00Z", "2026-10-20T10:05:00Z", [], "skipped"))).toBeNull();
  });

  it("names runner pools", () => {
    expect(runnerLabel(["ubuntu-latest"])).toBe("ubuntu-latest");
    expect(runnerLabel(["self-hosted", "linux", "gpu"])).toBe("self-hosted (gpu)");
    expect(runnerLabel([])).toBe("unknown");
  });

  it("groups by runner and gives advice when the wait is long", () => {
    const runs = [{ id: 1 } as Run];
    const jobs = [
      job(1, "2026-10-20T10:00:00Z", "2026-10-20T10:45:00Z", ["self-hosted", "build"]),
      job(2, "2026-10-20T10:00:00Z", "2026-10-20T10:30:00Z", ["self-hosted", "build"]),
      job(3, "2026-10-20T10:00:00Z", "2026-10-20T10:01:00Z"),
    ];
    const q = buildQueueStats(runs, new Map([[1, jobs]]));
    expect(q.jobs).toBe(3);
    expect(q.maxMinutes).toBe(45);
    expect(q.byRunner[0]).toMatchObject({ runner: "self-hosted (build)", jobs: 2, p95Minutes: 45, totalMinutes: 75 });
    expect(q.peak).toEqual({ hour: 10, jobs: 3, p95Minutes: 45 });
    expect(q.advice[0]).toMatch(/self-hosted \(build\).*autoscaling/);
    expect(q.advice.at(-1)).toMatch(/cancel-in-progress/);
  });

  it("stays quiet when the queue is short", () => {
    const q = buildQueueStats([{ id: 1 } as Run], new Map([[1, [job(1, "2026-10-20T10:00:00Z", "2026-10-20T10:00:30Z")]]]));
    expect(q.advice).toEqual([]);
  });

  it("shows a queue section in the scan report", async () => {
    const result = await scan(sample(), { days: 30, maxRuns: 100 });
    expect(result.queue.byRunner[0]!.runner).toBe("macos-latest");
    expect(result.queue.maxMinutes).toBe(45);
    const md = scanMarkdown(result, "acme/shop");
    expect(md).toContain("## Queue wait");
    expect(md).toContain("| macos-latest |");
    expect(md).toContain("macOS and Windows hosted runners");
  });
});
