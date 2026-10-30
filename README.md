# CI Doctor

Find out why your GitHub Actions are slow, costly or failing, and get a PR that fixes the YAML.

- **`scan`** ranks workflows and jobs by billable minutes and cost, and lists fixes.
- **`why <run-id>`** reads the failed job logs and tells you what broke and how to fix it.
- **`fix`** shows the YAML diff, writes it locally, or opens a PR.

No runner to buy. It only talks to the GitHub API. Claude is optional and only sees masked log lines.

## Quick start

```bash
npm i && npm run build
export GITHUB_TOKEN=...            # actions:read + contents:read
node dist/cli.js scan --repo owner/name --days 30
node dist/cli.js why 123456789 --repo owner/name
node dist/cli.js fix --repo owner/name            # print the diff
node dist/cli.js fix --repo owner/name --open-pr  # token also needs the "workflow" scope
```

Try it offline on the sample data:

```bash
npm run dev -- --fixtures test/fixtures/sample scan
npm run dev -- --fixtures test/fixtures/sample fix
npm run dev -- --fixtures test/fixtures/sample why 1004 --no-ai
```

## Example

```text
| Workflow          | Runs | Failed | Minutes | Est. cost | Superseded min |
| E2E (e2e.yml)     |    5 |     0% |     236 |    $18.88 |              0 |
| CI (ci.yml)       |    5 |    40% |      39 |     $0.31 |             10 |

⚠️ costly-runner  e2e.yml:10  Job "e2e" runs on macos-latest (10x the Linux price) and no step
                              looks macos-only. That would cut about $16.99 of $18.88.
no-concurrency    ci.yml:3    Every push to a PR starts a new run while the old one keeps going.
```

```text
## Build app: TypeScript errors
src/cart/total.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'.
Fix: Run `tsc --noEmit` locally and fix the listed errors.
This workflow failed 2 of 5 runs in the last 30 days.
```

## Fix rules

| Rule | Finds | Fix |
|---|---|---|
| `no-cache` | `npm ci` / `pnpm install` / `yarn` with no cache on setup-node | adds `cache: npm` (pnpm, yarn) |
| `no-concurrency` | PR workflow with no `concurrency` group | cancels old runs on PRs only, so main always finishes |
| `no-path-filter` | full runs on docs-only PRs | adds `paths-ignore` for `**.md`, `docs/**`, `LICENSE` |
| `costly-runner` | macOS/Windows job with no platform-only step | warning only, shows the $ saving |
| `no-timeout` | long job with no `timeout-minutes` (default is 6 hours) | sets p95 x 1.5 |

Edits go through the `yaml` Document API, so comments and key order stay. Release and deploy workflows are never changed by the trigger rules, and never get a cache (cache poisoning).

## Failure categories (`why`)

out of memory, timeout, missing secret, network (flaky), dependency install, TypeScript, tests, lint, build. If nothing matches and `ANTHROPIC_API_KEY` is set, Claude explains the masked log lines. `--no-ai` turns that off.

## GitHub Action

Weekly report in the job summary: see [examples/ci-doctor.yml](examples/ci-doctor.yml).

```yaml
permissions:
  actions: read
  contents: read
steps:
  - uses: rahulcs754/ci-doctor@main
```

## Notes

- Costs use GitHub list prices in [src/pricing.ts](src/pricing.ts). Free plan minutes are not subtracted.
- Savings are estimates: superseded runs are measured, cache savings assume 30 s per job run.
- `--record <dir>` saves API responses in the fixture layout, for tests and demos.
- Later, the core can power a "CI cost" tab in TokenLens.

## License

MIT
