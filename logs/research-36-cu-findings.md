# Research 36 — Findings (Cursor / `cu`)

Evidence is from repo inspection on 2026-04-22 unless marked **inferred**.

## Scheduling primitives (`/schedule`, RemoteTrigger, CronCreate)

- **Repo fact:** `RemoteTrigger`, `CronCreate`, and `/schedule` appear only in `docs/specs/research-topics/03-in-progress/research-36-weekly-background-maintenance-tasks.md`, not in `lib/`, `templates/`, or skills under this tree (ripgrep across `*.{js,md,json,toml}`).
- **Conclusion:** This OSS repo does not implement or document those names as first-class Aigon CLI/workflow APIs. Any claim that they support “fully unattended weekly runs” cannot be grounded here; treat as **external product (e.g. Claude) or Pro** until a concrete path is cited.
- **What *does* exist:** Human- or script-triggered flows that spawn tmux-backed agents (`feature-autonomous-start`, Fleet autopilot patterns in `lib/commands/feature.js`), `aigon server` + dashboard actions, and `supervisor` (observe-only, no engine transitions per `AGENTS.md`). There is no in-tree cron/launchd scheduler for maintenance agents.

## RemoteTrigger vs CronCreate (weekly appropriateness)

- **Not answerable from this repo** — no definitions found. **Smallest follow-up:** locate where those terms are defined (agent product docs, `@aigon/pro`, or a private harness) and record execution model (session token, headless CLI, webhook).

## Autonomous `feature-create` / spec writing

- **Repo fact:** `feature-create` and related handlers live in `lib/commands/feature.js` and are ordinary CLI commands; there is no code-level gate that distinguishes “scheduled agent” from “human”.
- **Inference:** Unattended spec creation is a **policy and safety** question (noise, bad specs, hook side effects), not a hard technical block. Guardrails would be: dry-run mode, branch-only output, max N specs/week, or human triage of a generated report before `feature-create`.

## Docs gap scan (signal source)

- **Practical approach:** `git log -1 --format=%ct -- <docs paths>` vs `git log --since=<that> -- lib/ templates/` (or symmetric: last commit touching `site/content/` vs commits touching `lib/`). **Repo does not ship** a dedicated “docs gap” command; this would be new automation wrapping git.
- **Authoritative architecture docs:** `AGENTS.md` explicitly points readers to `docs/architecture.md` for full module docs; treat `AGENTS.md` + `docs/architecture.md` + `docs/development_workflow.md` as the core doc spine (per `AGENTS.md` “Reading order”).

## Simplification / complexity heuristics

- **Repo fact:** Root `package.json` has no ESLint or complexity plugins — only `@playwright/test` under `devDependencies` and `xstate` under `dependencies`.
- **Existing “cheap” signals:** `wc -l lib/*.js lib/commands/*.js` (already suggested in `AGENTS.md` module map), targeted ripgrep for duplicate patterns, and human/agent review.
- **Trivially addable:** ESLint with `complexity` / `max-lines-per-function` (new dependency + config) or an external duplication tool run from a weekly script.

## Architecture docs staleness

- **Reliable signal:** `git log -1 -- docs/architecture.md` (and related `docs/*.md`) compared to latest commits touching `lib/`, `lib/workflow-core/`, `lib/commands/`. Stale when `lib/` has substantive commits after the last doc touch (heuristic, not encoded in tooling today).

## Security scan (Node CLI)

- **Repo fact:** `lib/security.js` integrates **gitleaks** and **semgrep** against changed paths vs default branch (`listChangedPaths`, `createScanSnapshot`). Misc commands expose `security-scan-commit` (see `lib/commands/misc.js` / `createMiscCommands` allowlist).
- **npm audit:** Not wired in `lib/security.js` from the portion read; suitable as a separate weekly step (`npm audit --json`) if network/registry access is acceptable.
- **Offline:** Semgrep/gitleaks can run locally if binaries/rules exist; `npm audit` needs registry/network unless using a cached lockfile-only heuristic.

## Stale entity sweep

- **Signals:** Spec folder stages under `docs/specs/features/0N-*` and `docs/specs/research-topics/0N-*`, plus optional git history on each spec file, plus workflow snapshots under `.aigon/workflows/`.
- **Thresholds:** Not encoded in repo; recommend **configurable per repo** (e.g. project config) with conservative defaults to avoid alert fatigue.

## Test suite hygiene (“hasn’t caught a regression in months”)

- **Repo fact:** `scripts/check-test-budget.sh` enforces total LOC in `tests/**/*.js` against `CEILING` (default **2500** in the script; `AGENTS.md` states **2000** — doc/script **drift** worth fixing in a small follow-up).
- **Repo fact:** No mutation testing, coverage-over-time DB, or “last failure date per test” instrumentation found in quick search of `tests/integration/static-guards.test.js` and related patterns.
- **Conclusion:** That specific metric requires **new instrumentation** or external CI history; weekly job could instead run budget script + grep for forbidden patterns + flaky-test notes from human triage.

## Cost & token trends (F288 / telemetry)

- **Repo fact:** `lib/telemetry.js` defines pricing, `writeNormalizedTelemetryRecord`, and writes JSON under `.aigon/telemetry/` (see `resolveTelemetryDir`, `writeNormalizedTelemetryRecord`).
- **Repo fact:** `lib/feature-close.js` captures telemetry at close and can emit normalized records; `lib/stats-aggregate.js` rolls up per-entity `stats.json` into `.aigon/cache/stats-aggregate.json` with **perTriplet** style rollups (see module header comment).
- **Gap:** No built-in “weekly cost report” command; aggregation would be a **new** script reading `.aigon/telemetry/*.json` + cache or log frontmatter.

## CLAUDE.md / AGENTS.md drift — weekly vs per-PR

- **Repo fact:** `tests/integration/command-registry-drift.test.js` guards **CLI handler exposure** (factory vs wrapper), not prose drift in `AGENTS.md`.
- **Recommendation:** Broken references in markdown are **cheap to lint** (grep for paths/commands that must exist); better as **per-commit or per-PR** static check than burning a weekly agent slot, unless combined into a broader “housekeeping” report.

## Job topology (single vs buckets vs per-task)

- **Tradeoffs (inference):** Single job = one failure loses everything; per-task = noisy schedules and duplicate cold starts; 2–3 buckets (docs/ops/code) balances isolation vs cost for this repo’s moderate maintenance list.

## Output format

- **Read-only / low risk:** Markdown under `logs/` or `.aigon/reports/` (new convention), dashboard notification if server API extended.
- **Medium risk:** `aigon feature-create` from findings (needs policy).
- **High risk:** Direct commits to `main` / auto-merge PRs without review — not recommended as MVP unattended authority.

## Aigon-native reuse

- **Patterns:** `feature-autonomous-start` __run-loop (tmux, polling, staged close) is the closest “orchestrator” analogue but is **feature-scoped**, not repo-wide maintenance.
- **Workflow integrity:** `aigon doctor` / `aigon doctor --fix` in `lib/commands/setup.js` is the supported repair path for missing snapshots etc. (`AGENTS.md` write-path contract). Running `--fix` unattended mutates state — prefer **non-fix doctor output** for weekly unless explicitly approved.

## Cadence

- **True weekly cron** vs **post-N commits to main:** Commits-since-last-run avoids idle-week noise and ties work to actual change velocity; weekly cron is simpler operationally. Either is viable; **commit-triggered** fits a churny default branch.

## `aigon nudge` CLI surface (operator channel)

- **Repo fact:** `nudge` handler exists in `lib/commands/misc.js`, but `createMiscCommands`’s `names` array **does not include** `'nudge'` (line ~1234 lists other commands only). Feature-305 log notes this as a known gap.
- **Implication:** Documentation and automation that assume `aigon nudge …` from a minimal exposed CLI may fail until re-registered.

---

## Preliminary recommendation (for synthesis / `research-eval`)

| Priority | Task bucket | Mode | Rationale |
|----------|--------------|------|-----------|
| 1 | Security + dependency signal (`security.js` patterns + optional `npm audit`) | Weekly or per-push | Already grounded in repo code |
| 2 | Workflow / doctor **read-only** report | Weekly | Loud failures are a core philosophy; auto `--fix` unattended is risky |
| 3 | Docs gap + arch staleness (git-based) | Weekly report → human or `feature-create` | No shipped scanner |
| 4 | Telemetry rollup / cost trends | Weekly or on-demand | Data exists; reporter missing |
| 5 | AGENTS/command path drift | **Per-PR lint** | Cheap; `command-registry-drift` covers code half only |
| Defer / spike | “Tests never caught regression”, memory hygiene (`~/.claude/...`) | Manual or future | No local signal |

**Autonomous `feature-create` for MVP:** Recommend **off** for maintenance output; produce ranked markdown + optional `feature-create` **after** human skim, unless dry-run flags are added.

**Orchestrator:** Prefer **2–3 bucket jobs** over one monolith or ten micro-jobs for this codebase size.

**Scheduling:** Until RemoteTrigger/CronCreate are evidenced in-repo, assume **OS scheduler + headless agent invocation** or product-side scheduling is the practical path for “unattended weekly.”
