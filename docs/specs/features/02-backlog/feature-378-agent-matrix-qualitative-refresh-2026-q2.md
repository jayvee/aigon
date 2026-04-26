---
recurring_slug: quarterly-agent-matrix-qualitative-refresh
complexity: low
recurring_quarter: 2026-Q2
recurring_template: quarterly-agent-matrix-qualitative-refresh.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T03:45:23.402Z", actor: "recurring/feature-prioritise" }
---

# agent-matrix-qualitative-refresh-2026-Q2

## Summary

Quarterly refresh of the qualitative layer of the agent matrix: `notes.<op>` text and `score.<op>`
values (1–5 scale) for every active model option. Sources are SWE-bench Verified, Aider polyglot
leaderboard, LMArena, and signal community sources. Quarterly cadence keeps scores stable and
trustworthy — constant "vibes" updates erode trust. Uses the same feedback-item + `aigon matrix-apply`
flow as the weekly pricing refresh; only the sources and patch fields differ.

## Acceptance Criteria

- [ ] Read the current matrix: `node -e "const m=require('./lib/agent-matrix'); console.log(JSON.stringify(m.buildMatrix(),null,2))"` and note every `(agentId, modelValue, notes.<op>, score.<op>)` tuple
- [ ] For each benchmark source, fetch the current leaderboard or results page (see Technical Approach for URLs) and record the ranking or score for each model in the matrix
- [ ] For each signal community source, search for public reports on model quality, regressions, or capability changes since the last refresh date (`lastRefreshAt`)
- [ ] Compare fetched data against current notes and scores; identify any: `score-update`, `notes-update`, `benchmark-update`, `deprecation`, `quarantine-candidate`
- [ ] Write `.aigon/matrix-refresh/2026-04-26/proposed.json` with the structured patch (see format below)
- [ ] For each distinct change-kind detected, run one `aigon feedback-create "<change-kind>: <brief description>"` — include the patch file path in the feedback body
- [ ] Commit: `git add .aigon/matrix-refresh/ && git commit -m "chore: agent-matrix qualitative refresh 2026-Q2"`
- [ ] Close this feature (no eval step needed)

If no changes are warranted, write an empty `changes: []` patch file and skip feedback creation.

## Patch File Format

```json
{
  "date": "2026-04-26",
  "quarter": "2026-Q2",
  "sources": {
    "swe_bench": "<URL fetched>",
    "aider_leaderboard": "<URL fetched>",
    "lmarena": "<URL fetched>",
    "community": ["<URL or search query 1>", "<URL or search query 2>"]
  },
  "changes": [
    {
      "feedbackId": "<feedback item ID, e.g. 42>",
      "changeKind": "score-update",
      "agentId": "cc",
      "modelValue": "claude-sonnet-4-6",
      "patch": {
        "score": { "implement": 4.5 }
      },
      "rationale": "One sentence citing source and reasoning"
    },
    {
      "feedbackId": "<feedback item ID, e.g. 43>",
      "changeKind": "notes-update",
      "agentId": "gg",
      "modelValue": "gemini-2.5-pro",
      "patch": {
        "notes": { "implement": "Updated note based on community signal." }
      },
      "rationale": "One sentence citing source and reasoning"
    }
  ]
}
```

Valid `changeKind` values:
- `score-update` — one or more op scores changed (1–5 scale, one decimal allowed)
- `notes-update` — one or more op notes updated based on community signal
- `benchmark-update` — score update backed by a published benchmark (SWE-bench, Aider leaderboard)
- `deprecation` — a model in the registry was listed as deprecated/legacy/removed
- `quarantine-candidate` — repeated public reports of quality regression or capability loss

Valid `patch` fields (applied to the matching `modelOptions` entry):
- `score` — `{ draft?: number|null, spec_review?: number|null, implement?: number|null, review?: number|null }` — update op scores (1–5); partial update merges with existing values
- `notes` — `{ draft?: string, spec_review?: string, implement?: string, review?: string }` — update op note text; partial update merges with existing values
- `deprecated` — `true` — set a `deprecated: true` field (used for display; does not remove)
- `quarantined` — `{ at: "<ISO date>", reason: "<string>" }` — mark quarantined

Ops: `draft` · `spec_review` · `implement` · `review`

## Technical Approach

### Benchmark sources to check

| Source | What it measures | URL |
|--------|-----------------|-----|
| SWE-bench Verified | Coding task resolution on real GitHub issues | https://www.swebench.com/ |
| Aider polyglot leaderboard | Code editing across languages | https://aider.chat/docs/leaderboards/ |
| LMArena (code category) | Human-preference rankings for code tasks | https://lmarena.ai/ |

### Community signal sources

Search these sources for model-specific quality reports since the last `lastRefreshAt` date:

| Source | Search query template |
|--------|----------------------|
| Hacker News | `site:news.ycombinator.com "<model name>" quality OR regression` |
| Reddit r/MachineLearning | `site:reddit.com/r/MachineLearning "<model name>"` |
| Twitter/X | `"<model name>" coding quality -filter:retweets` |

### Score calibration guide

Scores are on a 1–5 scale with one decimal place. Anchor points:

| Score | Meaning |
|-------|---------|
| 5.0 | Consistently top performer on this op; strong benchmark evidence |
| 4.0 | Above-average; reliable for this op with minor weaknesses |
| 3.0 | Average; adequate but not a standout choice |
| 2.0 | Below-average; noticeable weaknesses on this op |
| 1.0 | Poor; significant failure modes on this op |

Map benchmark percentile ranks to scores: top 10% → 4.5–5.0, top 25% → 4.0–4.5,
median → 3.0, bottom 25% → 2.0–2.5, bottom 10% → 1.0–2.0. Use `null` when
evidence is absent rather than inventing a number.

### Op-to-benchmark mapping

| Op | Best benchmark proxy |
|----|---------------------|
| `implement` | SWE-bench Verified % resolved; Aider polyglot pass rate |
| `draft` | LMArena code category; community spec-writing mentions |
| `spec_review` | No direct benchmark — use community signal + implement score as proxy |
| `review` | No direct benchmark — use LMArena code category + community signal |

### Workflow

1. Run the matrix read command above to capture current state.
2. For each benchmark source, `WebSearch` for the current leaderboard URL, then `WebFetch` the page.
3. Extract model rankings/scores. Match against the matrix using `modelValue` (strip provider prefix if needed).
4. Search community sources for quality signal on each model since its `lastRefreshAt`.
5. Classify each proposed change as one of the five change-kinds above.
6. Write the patch file. Each change entry needs a `feedbackId` — create feedback items first, then fill in their IDs.
7. Prefer `benchmark-update` over `score-update` when the change is directly traceable to a published leaderboard.

### Creating feedback items

Run one `aigon feedback-create` per change-kind, not per individual model. Use titles like:
- `benchmark-update: Claude Sonnet 4.6 implement score → 4.5 (SWE-bench 47%)`
- `score-update: Gemini 2.5 Pro draft score → 4.0 (community signal)`
- `notes-update: Codex cx reasoning note updated based on ARC-AGI signal`
- `deprecation: Gemini 1.5 Flash listed as legacy on LMArena`
- `quarantine-candidate: Public reports of Opus 4.7 spec_review regressions`

In the feedback body, include:
- The patch file path: `.aigon/matrix-refresh/2026-04-26/proposed.json`
- The specific `changeKind` entries for this feedback
- Source URLs and the date they were fetched

### Applying approved changes

Changes are applied by the operator (not by this refresh agent) using:
```bash
aigon matrix-apply <feedback-id>
```

This command reads the patch file, finds the entry with the matching `feedbackId`, and writes
the change to `templates/agents/<agentId>.json`.

## Pre-authorised

- Skip eval step: this is a data-collection task; quality judgement comes from the operator reviewing the feedback items, not a separate eval agent
- May run `node -e "..."` to read the matrix without additional confirmation
- May use `WebSearch` and `WebFetch` to retrieve benchmark leaderboard pages

## Related

- Matrix collector: `lib/agent-matrix.js`
- Apply command: `aigon matrix-apply <feedback-id>` (supports `notes` and `score` patch fields)
- Feedback system: `lib/commands/feedback.js`
- Pricing refresh: `docs/specs/recurring/weekly-agent-matrix-pricing-refresh.md`
- Set: agent-matrix (features 370–376)
