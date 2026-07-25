# Implementation Log: Feature 698 - refresh-public-docs-for-current-oss
Agent: cx

## Status

Refreshed public OSS docs, landing facts, dashboard guidance, lifecycle terminology, and the legacy-feedback migration path. See commits `78d4fbe86`, `1347a336f`, `d60085695`, and `d815bc1bd`.

## New API Surface

## Key Decisions

- Preserved the F696 `ag` migration: every current Antigravity reference is a correct product/CLI or agent-ID reference. The remaining Gemini mentions are model-family/configuration names (`gemini-*`) or the installed Antigravity data path (`~/.gemini/antigravity-cli`), never Gemini CLI capability claims.
- Surviving Antigravity/Gemini mentions are classified as follows: product/CLI references in `site/app/layout.tsx`, `site/app/llms*.txt/route.ts`, `site/public/{home,pro}.html`, `site/scripts/{build-og-image,gen-commands}.mjs`, `site/content/{index,compare}.mdx`, `guides/{agent-quota-awareness,applying-aigon-updates,brewboard-tutorial,dashboard,fleet-mode,pipeline-quota,setup-wizard,telemetry}.mdx`, `reference/{agents,configuration}.mdx`, and the listed feature/research command pages; model-family/configuration mentions in `reference/configuration.mdx` and `reference/agents.mdx`; historical Gemini storage naming in `guides/telemetry.mdx`. No claim-to-fix remains. The generated `site/public/_pagefind/pagefind-ui.js` is an index artifact and is excluded from this allowlist.
- `/pro` keeps one static rewrite to the canonical public Pro page; its app route is a metadata stub with no redirect.

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

- `npm run build --prefix site`
- Regression searches for retired agent naming, MIT marketing copy, insecure dashboard binding, and placeholders (the raw retired-name command still sees the generated Pagefind vendor artifact; source allowlist is clean)
- `curl -sI http://localhost:3600/pro | head -1` → `HTTP/1.1 200 OK`

## Code Review

**Reviewed by**: cu (Composer)
**Date**: 2026-07-25

### Fixes Applied
- `e049e24f2` fix(review): finish lifecycle, install, and workflow doc corrections
- `7b755063c` fix(review): update fleet tutorial completion signal wording
- `1cc6c1307` fix(review): correct feature-prioritise summary in command index

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- **ESCALATE:subsystem** — Dashboard/gallery screenshots were not recaptured in this branch (`site/public/img/` unchanged). The spec requires refreshed Cards, Pipeline, Monitor, landing, and mobile visuals after the content pass.
- **ESCALATE:subsystem** — Residual `submitted` wording remains in a few reference examples (e.g. `board.mdx` sample output, `autonomous-mode.mdx` internal state table) and research command pages; broader pass may be needed to align every non-compatibility mention with `implementation-complete` / `research-complete`.

### Notes
- Core factual fixes (Apache-2.0, loopback binding, `@latest`, placeholders, uninstall guide, `/pro` routing, feedback demotion) look solid after review fixes.
- Reverted incidental `site/package-lock.json` drift unrelated to the docs work.
