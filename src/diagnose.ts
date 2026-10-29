/** Reads a failed job log and says what broke. Pattern rules only, no network. */

export interface Diagnosis {
  category: string;
  title: string;
  fix: string;
  /** The error line plus the lines that matched, already masked. */
  keyLines: string[];
  /** Up to 40 lines before the first error, masked. Sent to Claude when no pattern matched. */
  context: string[];
  flaky: boolean;
}

interface Pattern {
  category: string;
  title: string;
  test: RegExp;
  fix: string;
  flaky?: boolean;
}

// Order matters: the first match wins.
const PATTERNS: Pattern[] = [
  {
    category: "out-of-memory",
    title: "Ran out of memory",
    test: /JavaScript heap out of memory|exit code 137|ENOMEM|\bKilled\b|OOMKilled/i,
    fix: "Raise the Node heap (`NODE_OPTIONS=--max-old-space-size=6144`), split the job, or use a bigger runner.",
  },
  {
    category: "timeout",
    title: "Job timed out",
    test: /has exceeded the maximum execution time|The job running on runner .* has exceeded|timed out after \d+/i,
    fix: "Find the step that hangs (often a test waiting on a server or a prompt). Then set `timeout-minutes` close to the normal run time.",
  },
  {
    category: "missing-secret",
    title: "Missing secret or bad credentials",
    test: /Input required and not supplied|Bad credentials|401 Unauthorized|\bENEEDAUTH\b|\bE401\b|secret .*(is not set|not found|missing)|Resource not accessible by integration/i,
    fix: "Check the secret exists in repo settings and is passed with `env:` or `with:`. Fork PRs can't read secrets, and GITHUB_TOKEN may need more `permissions:`.",
  },
  {
    category: "network",
    title: "Network error (likely flaky)",
    test: /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND)\b|socket hang up|503 Service Unavailable|502 Bad Gateway|API rate limit exceeded/i,
    fix: "Re-run the job. If it keeps happening, add a retry to the download step or cache what it fetches.",
    flaky: true,
  },
  {
    category: "dependency-install",
    title: "Dependency install failed",
    test: /\bERESOLVE\b|ERR_PNPM_\w+|npm (ERR!|error) code|Couldn't find any versions|lockfile .*(out of date|needs to be updated)|--frozen-lockfile|can only install packages when your package\.json and package-lock\.json/i,
    fix: "Run the install locally with the same Node version and commit the updated lockfile. For ERESOLVE, fix the peer dependency instead of using --legacy-peer-deps.",
  },
  {
    category: "type-error",
    title: "TypeScript errors",
    test: /error TS\d{4}:/,
    fix: "Run `tsc --noEmit` locally and fix the listed errors. Check that CI and local use the same TypeScript version.",
  },
  {
    category: "test-failure",
    title: "Tests failed",
    test: /Tests?:\s+\d+ failed|\b\d+ failed\b|^\s*FAIL\s|AssertionError|✗|×\s|Expected:.*Received:/im,
    fix: "Run the failing test locally. If it passes on re-run, it may be flaky: look for timers, shared state or missing awaits.",
  },
  {
    category: "lint",
    title: "Lint errors",
    test: /✖ \d+ problems?|\d+ errors? and \d+ warnings?|eslint.*error/i,
    fix: "Run the linter locally with `--fix`, then fix what is left.",
  },
  {
    category: "build",
    title: "Build failed",
    test: /Failed to compile|Build failed|Module not found|Cannot find module|Could not resolve/i,
    fix: "Run the build locally. A file name with the wrong case often works on macOS but fails on Linux CI.",
  },
];

/** Title and fix for a known category, used when the API tells us the cause (e.g. timed_out). */
export function describe(category: string): Pick<Diagnosis, "category" | "title" | "fix" | "flaky"> | undefined {
  const p = PATTERNS.find((x) => x.category === category);
  return p && { category: p.category, title: p.title, fix: p.fix, flaky: p.flaky ?? false };
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;

export function cleanLog(raw: string): string[] {
  return raw.split(/\r?\n/).map((l) => l.replace(TIMESTAMP, "").replace(ANSI, ""));
}

// Masks anything that looks like a credential before we print it or send it to Claude.
const SECRETS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  /((?:token|password|passwd|secret|api[_-]?key)\s*[=:]\s*)["']?[^\s"']{6,}/gi,
];

export function mask(line: string): string {
  return SECRETS.reduce((l, re) => l.replace(re, (m, prefix) => (typeof prefix === "string" && m.startsWith(prefix) ? `${prefix}***` : "***")), line);
}

export function diagnose(raw: string): Diagnosis {
  const lines = cleanLog(raw);
  // Prefer a real error annotation over the generic "Process completed with exit code N".
  let errorAt = lines.findIndex((l) => l.startsWith("##[error]") && !/Process completed with exit code/.test(l));
  if (errorAt === -1) errorAt = lines.findIndex((l) => l.startsWith("##[error]"));
  if (errorAt === -1) errorAt = lines.length - 1;

  const start = Math.max(0, errorAt - 40);
  const context = lines.slice(start, errorAt + 1).map(mask);
  const window = context.join("\n");

  for (const p of PATTERNS) {
    if (!p.test.test(window)) continue;
    const re = new RegExp(p.test.source, p.test.flags.replace("g", ""));
    const matched = context.filter((l) => re.test(l)).slice(0, 5);
    const errorLine = context[context.length - 1]!;
    return {
      category: p.category,
      title: p.title,
      fix: p.fix,
      keyLines: [...new Set([...matched, errorLine])].filter(Boolean),
      context,
      flaky: p.flaky ?? false,
    };
  }
  return {
    category: "unknown",
    title: "No known pattern matched",
    fix: "Read the lines above the first ##[error]. Set ANTHROPIC_API_KEY to get a plain-English explanation.",
    keyLines: context.slice(-5),
    context,
    flaky: false,
  };
}
