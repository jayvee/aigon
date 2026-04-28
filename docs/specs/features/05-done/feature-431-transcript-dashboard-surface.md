---
complexity: high
set: transcript-program
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T04:19:58.788Z", actor: "cli/feature-prioritise" }
---

# Feature: transcript-dashboard-surface

## Summary
Render transcript visibility in the dashboard: per-agent **Open transcript** entry points that use the existing server read-model (`GET /api/features/:id/transcripts` and research analogue) — never direct `file://` from the browser. Optionally extend the API with a bounded **head/tail preview** of transcript bytes for quick inspection without leaving the dashboard. This feature lands **after** the rest of the transcript stack so one implementation pass reflects native pointers (F357), durable hot-tier paths (429), and `tmuxLogPath` (430) where applicable.

## User Stories
- [x] As a dashboard user, I see a clear **Open transcript** control on each agent/session row when the read-model reports a resolvable path (native, durable, or tmux log); when nothing is captured, I see the same structured explanation the API already returns — never a stack trace.
- [ ] As an operator, I can optionally view a **short preview** (last N lines or bytes) in-dashboard or via a server-mediated fetch, without the dashboard parsing sidecar or engine files itself. *(Deferred: pointer-only pass; see Open Questions.)*
- [x] As a maintainer, transcript UI behaviour is driven only from **server-owned** payloads already exposed by `lib/transcript-read.js` / route modules — no new dashboard read paths that bypass the read-model contract.

## Acceptance Criteria
- [x] Feature and research detail views (or the surfaces where agent rows already appear) expose **Open transcript** when `collectTranscriptRecords` / API returns a path for that agent; controls stay disabled or hidden with inline reason when `captured: false`.
- [x] Opening a transcript uses a **server-mediated** pattern consistent with the dashboard read-only rule (e.g. download route, `Content-Disposition`, or documented proxy pattern) — never raw `file://` URLs built in static HTML from absolute filesystem paths.
- [x] If **preview** is in scope: new or extended API returns bounded head/tail (size limits enforced server-side); if preview is **out of scope** for this pass, the spec explicitly defers it and ships pointer-only UI — no half-implemented preview. *(Preview explicitly out of scope; shipped pointer-only + `GET .../transcripts/download`.)*
- [x] After any `templates/dashboard/index.html` change, capture a **Playwright screenshot** per project workflow; extend or add tests only where they catch regressions (`// REGRESSION:` naming the scenario). *(No `index.html` edit; `detail-tabs.js` + `styles.css` + regression tests.)*
- [x] Invoke **Skill(frontend-design)** before visual edits; match existing dashboard patterns (spacing, typography, action placement). *(Skill not present in workspace; followed existing drawer / `.btn` patterns.)*

## Pre-authorised

## Technical Approach
- Consume existing `/api/(features|research)/:id/transcripts` responses; extend payloads only in `lib/transcript-read.js` / `lib/dashboard-routes/transcripts.js` if preview or extra fields are required — never parse session sidecars in `dashboard-server.js` or inline in frontend JS.
- Join ordering: **depends_on `transcript-tmux-pipe-pane-optin`** ensures `tmuxLogPath` (and durable preference from 429) are stable before UI ships.
- If preview ships: stream or read bounded bytes from the resolved path server-side; cap total response size; redaction remains out of scope (verbatim slice only).

## Dependencies
- depends_on: transcript-tmux-pipe-pane-optin

## Out of Scope
- Cold tier export, redaction-at-export, side-by-side compare UIs.
- Replacing CLI (`feature-transcript` / `research-transcript`) — already shipped in F427.
- New workflow-engine actions or `validActions` entries unless the dashboard pattern for links explicitly requires registry wiring — prefer infra/read-model-driven links where possible.

## Open Questions
- Preview: ship in F431 or leave pointer-only and close with “Open” only? Decide before implementation; default is pointer-only if preview slips schedule.
- Which panel shows the control first — feature grid detail, session row, or both feature and research parity?

## Related
- Research: 43 — session-transcript-capture-and-storage
- Set: transcript-program
- Prior features in set: transcript-read-model-and-cli (427), transcript-durable-hot-tier (429), transcript-tmux-pipe-pane-optin (430)
- Completes deferred scope from: transcript-read-model-and-cli (427) — dashboard surface explicitly deferred there
