# OpenCode (anomalyco)

- **Slug:** `opencode`
- **Tier:** C — single-agent (engine / complement)
- **Repo:** [`anomalyco/opencode`](https://github.com/anomalyco/opencode)
- **License:** MIT
- **Last verified:** 2026-04-27 (R44)

## Lineage note
The name "OpenCode" historically referred to two distinct projects:
- **`anomalyco/opencode`** (TypeScript) — the active fork, ex-SST. **This is the row in the matrix.**
- **`sst/opencode`** (Go) — the older project; superseded (not strictly archived) by the anomalyco TS fork. Do not list separately.
- **Crush** (`charmbracelet/crush`) — independent codebase by the Charm team. Sometimes referred to informally as the Go-lineage successor in the TUI niche, but is not a fork. Listed as its own row (`crush.md`).

## What it is
Single-agent TUI / CLI, 75+ providers (incl. local Ollama), mid-session model switch (`Ctrl+O`). Anomaly subscriptions ($10/mo Go, PAYG Zen, Black enterprise) plus BYO.

## Matrix cells (public 5)
- **Unit of work:** TUI session
- **Source of truth:** chat history
- **Multi-agent posture:** single-agent
- **Model flexibility:** 75+ providers (incl. local Ollama)
- **Pricing:** $10/mo Go, PAYG Zen, BYO

## Closest to Aigon on
Vendor independence (75+ providers) and BYO posture. Often picked alongside Aigon as an *engine*.

## Where it beats Aigon
- 75+ provider support — Aigon's per-agent model selection is heavier.
- First-class local-model support (Ollama, OpenAI-compatible endpoints). Aigon does not yet treat these as first-class — tracked as `local-model-first-class-support`.
- Mid-session model switch (`Ctrl+O`).
- Larger user base (132k stars on the lineage).

## Where Aigon wins
- Multi-agent orchestration — OpenCode is single-agent by design.
- Markdown specs in git as the unit of work.
- Kanban lifecycle and cross-agent evaluation.

## Complementary usage
OpenCode is one of Aigon's supported engines. Use OpenCode *inside* an Aigon-managed workflow when you want broader provider support on a specific feature.

## Sources
- [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
- [OpenCode vs Claude Code — Morph](https://www.morphllm.com/comparisons/opencode-vs-claude-code)
- R25 (OpenCode deep dive)
