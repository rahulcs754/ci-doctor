# CLAUDE.md

## Project
CI Doctor: a TypeScript CLI + GitHub Action that reads GitHub Actions runs, ranks slow and costly workflows, explains failed jobs from their logs, and opens a PR with YAML fixes. Plan: docs/MVP-PLAN.md. Research: docs/RESEARCH.md.

## Stack
Node 22, ESM, TypeScript strict. @octokit/rest, `yaml` (keeps comments), commander, vitest. Claude is optional (explanations only), never required for a result.

## Rules
- Rules are pure functions: `(workflow AST, run stats) => Finding[]`. Each finding has rule id, file, line, minutes saved estimate, and a YAML patch.
- YAML edits must keep comments and key order. Use the `yaml` Document API, never stringify a plain object.
- Never change `on:` triggers for `release` / `deployment` workflows without a warning.
- Tests use recorded API responses and sample logs in test/fixtures. No network in tests.
- Token scopes: `actions: read`, `contents: read`; `contents: write` + `pull-requests: write` only for `fix --open-pr`.
- Never print secrets from logs. Mask anything that looks like a token before showing or sending to Claude.

## Commands
- `npm test`, `npm run build`, `npm run dev -- scan --repo owner/name`

## Owner
Senior React/Next.js dev, India. Wants short, simple English and a clean portfolio-grade repo.
