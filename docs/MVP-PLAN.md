# CI Doctor: MVP plan

**One line:** A CLI + GitHub Action that tells you which GitHub Actions workflows waste the most minutes, why a job failed, and opens a PR with YAML fixes.

## Three commands
1. **`scan`**: pull the last 30 days of runs and jobs, build a cost table, run the fix rules.
2. **`why <run-id>`**: download the failed job log, find the first real error, classify it, and suggest a fix.
3. **`fix --open-pr`**: apply the rule patches to `.github/workflows/*.yml` and open one PR.

## Data (GitHub REST)
- `GET /repos/{o}/{r}/actions/runs` and `/runs/{id}/jobs` for duration, runner label, status, branch, PR.
- `GET /repos/{o}/{r}/actions/jobs/{id}/logs` for failed logs.
- `GET /repos/{o}/{r}/actions/caches` for cache hits and size.
- Cost = billable minutes x runner rate (Linux 1x, Windows 2x, macOS 10x; rates kept in one config file).

## Fix rules (MVP: 5)
| Rule | What it finds | Fix |
|---|---|---|
| `no-cache` | `npm ci`/`pnpm i`/`yarn` with no `cache:` on setup-node | add `cache: npm` (or pnpm/yarn) |
| `no-concurrency` | PR workflow without `concurrency` | add group + `cancel-in-progress: true` |
| `no-path-filter` | full CI runs on docs-only changes | add `paths-ignore: ['**.md', 'docs/**']` |
| `costly-runner` | macOS/Windows job with no platform-only step | suggest `ubuntu-latest` (warn only) |
| `no-timeout` | job with no `timeout-minutes` and a past run over 30 min | add `timeout-minutes` = p95 x 1.5 |

## Failure diagnosis (`why`)
- Strip ANSI and timestamps, find the first `##[error]` and the 40 lines above it.
- Pattern rules first: npm ERESOLVE, TS errors (`TS\d{4}`), Jest/Vitest/Playwright fail, `exit code 137` (OOM), timeout, missing secret, network/ETIMEDOUT (likely flaky).
- If no pattern matches and `ANTHROPIC_API_KEY` is set, Claude explains the error from the masked snippet.
- Output: category, the key lines, a suggested fix, and "seen N times in 30 days".

## Output
- Terminal table + `ci-doctor-report.md` + JSON.
- As an Action: a weekly job summary, or a PR comment when a PR changes workflow files.

## Build order (2 weeks)
1. Octokit client with fixture recording + cost table (`scan` with no rules)
2. Workflow YAML loader with line numbers + 5 rules + tests
3. Patch writer that keeps comments + `fix --open-pr`
4. `why`: log parser + pattern rules + fixtures from real failed logs
5. Optional Claude explanations + secret masking
6. GitHub Action wrapper + README demo on a sample repo

## Option: TokenLens tab
TokenLens (github.com/rahulcs754/AI-Coding-Cost-Dashboard) already shows AI token spend per repo and PR. CI Doctor's core can be a small package that TokenLens imports to add a "CI cost" tab: AI spend + CI spend per PR in one place. Plan: build CI Doctor as its own repo first (clean CLI, easy to test), keep `src/core` free of CLI code, then add the tab to TokenLens later.

## Later
- Matrix trimming and test sharding hints
- Link with FlakeRadar idea: same "fails then passes on retry" data
- GitLab CI support
