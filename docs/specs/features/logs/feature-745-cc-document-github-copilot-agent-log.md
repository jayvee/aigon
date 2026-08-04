# Implementation Log: Feature 745 - document-github-copilot-agent

Agent: cc

## Status

Complete. Documentation-only pass following F743. No implementation, registry, or behaviour changes.

## New API Surface

None.

## Key Decisions

- **Source of truth was the merged `templates/agents/cp.json`**, not F743's drafting notes. Everything documented (binary `copilot`, `--allow-all --interactive`, `.agents/skills/` output, `/aigon-` prefix, `defaultFleetAgent: false`, `transcriptTelemetry: false`, `resume: null`, the nine `modelOptions`) was read off the final registry.
- **`templates/help.txt` needed no edit** — its installable-agent line renders from `{{SUPPORTED_AGENT_INSTALL_IDS}}`; verified `aigon help` already emits `cp`. Same for the setup wizard, whose agent list comes from `getLaunchableAgents()` in `lib/onboarding/detectors.js` (I corrected the wizard doc, which had drifted and was missing Amp as well).
- **The detailed operational guidance lives in one place** — a new `## GitHub Copilot CLI (cp)` section in `site/content/reference/agents.mdx` covering install (brew cask / npm + Node 22), `copilot login`, `aigon install-agent cp`, skill invocation, model selection, permissions, and a capability table. README and marketing copy stay short and link there.
- **Positioning:** Copilot is described as one entitlement that *routes* among model families, never as multiple subscriptions or quota pools. Added an explicit callout to `compare.mdx`, whose "quota arbitrage" claim would otherwise read as if `cp` counted as several vendors.
- **Corrected two over-broad capability claims** rather than adding caveats around them: `telemetry.mdx` said Aigon collects telemetry "from every agent session"; `pipeline-quota.mdx` implied every agent card has a quota source.
- **Left illustrative examples alone** per spec — homepage GIF captions, the CC/Codex/Antigravity demo tabs, the benchmark roster (`cp` has no benchmark scores), and two-agent Fleet examples were not mechanically expanded.
- Where a table presented itself as exhaustive but predated `op`/`km`/`am` (configuration permissions table, `feature-open` agent mappings), I added `cp` **and** a pointer to the full Agents reference rather than silently leaving a partial roster.

## Gotchas / Known Issues

- `site/` had no `node_modules`; installing them to run `npm run build --prefix site` filled the disk and blocked all shell commands mid-run. Recovered by removing `site/node_modules`, then reinstalled, built, and cleaned up (`node_modules`, `.next`) afterwards. `site/package-lock.json` was modified by the install and reverted — no lockfile change ships with this feature.
- Regenerated `site/public/_pagefind/` is gitignored (`site/.gitignore:7`), so the documented build produced it without any hand-editing or commit.

## Explicitly Deferred

Nothing from scope. Out-of-scope items untouched as specified: no telemetry/quota/resume implementation, no Fleet default promotion, no benchmark scores, no screenshot/GIF/social-card regeneration.

## For the Next Feature in This Set

If Copilot transcript or quota support lands later, the claims to revisit are `site/content/guides/telemetry.mdx` (parser table + intro), `site/content/guides/pipeline-quota.mdx` (What you see), and the capability table in `agents.mdx`.

## Test Coverage

No new tests (documentation-only). Spec validation block run in full:

- `npm run docs:check` — 106 MDX pages, 140 executable commands ✓
- `npm run build --prefix site` — Next build + Pagefind (106 pages indexed) ✓
- `node scripts/check-template-leaks.js` — 68 files, no leaks ✓
- `git diff --check` — clean ✓
