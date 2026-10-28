# CI Doctor

Find out why your GitHub Actions are slow, costly or failing, and get a PR that fixes the YAML.

> Status: planning. See [docs/MVP-PLAN.md](docs/MVP-PLAN.md).

## What it does
- Ranks workflows and jobs by minutes and estimated cost (last 30 days).
- Spots common waste: no dependency cache, no `concurrency` cancel, no path filters, macOS/large runners where Linux works, runs on closed PRs.
- Reads the log of a failed job and says why it failed (install error, type error, test fail, timeout, OOM, missing secret, flaky network).
- Opens a PR with YAML fixes and a short reason for each change.

## Quick start (planned)
```bash
npx ci-doctor scan --repo owner/name --days 30
npx ci-doctor why --run <run-id>
npx ci-doctor fix --repo owner/name --open-pr
```

## Stack
TypeScript, Node 22, Octokit, `yaml`, vitest. Optional Claude for plain-English explanations.

## License
MIT
