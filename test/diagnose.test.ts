import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanLog, diagnose, mask } from "../src/diagnose.js";
import { why } from "../src/why.js";
import { SAMPLE, sample } from "./helpers.js";

const log = (body: string) => `${body}\n##[error]Process completed with exit code 1.\n`;

describe("diagnose", () => {
  it.each([
    ["FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory", "out-of-memory"],
    ["##[error]Input required and not supplied: token", "missing-secret"],
    ["npm error code ETIMEDOUT", "network"],
    ["ERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile", "dependency-install"],
    ["src/a.ts(1,1): error TS2304: Cannot find name 'x'.", "type-error"],
    ["Tests:       2 failed, 40 passed, 42 total", "test-failure"],
    ["✖ 3 problems (3 errors, 0 warnings)", "lint"],
    ["Failed to compile.\nModule not found: Can't resolve './Header'", "build"],
    ["something odd happened", "unknown"],
  ])("%s -> %s", (line, category) => {
    expect(diagnose(log(line)).category).toBe(category);
  });

  it("marks network errors as flaky", () => {
    expect(diagnose(log("Error: socket hang up")).flaky).toBe(true);
  });

  it("strips timestamps and colors", () => {
    expect(cleanLog("2026-10-20T12:00:01.1000000Z \x1b[36;1mpnpm build\x1b[0m")).toEqual(["pnpm build"]);
  });

  it("masks tokens before anything is shown or sent", async () => {
    expect(mask("token=ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe("token=***");
    expect(mask("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toBe("Authorization: Bearer ***");
    expect(mask("key sk-ant-api03-abcdefghijklmnop")).toBe("key ***");
    const d = diagnose(await readFile(join(SAMPLE, "logs/5009.txt"), "utf8"));
    expect(d.context.join("\n")).not.toContain("npm_FAKE");
  });
});

describe("why", () => {
  it("diagnoses each failed job and adds the failure history", async () => {
    const r = await why(sample(), 1004, { ai: false });
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]!.job.name).toBe("Build app");
    expect(r.jobs[0]!.diagnosis.category).toBe("type-error");
    expect(r.jobs[0]!.diagnosis.keyLines[0]).toContain("TS2322");
    expect(r.history).toEqual({ days: 30, runs: 5, failed: 2 });
  });
});
