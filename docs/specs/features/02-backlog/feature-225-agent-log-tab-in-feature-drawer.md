# Feature: agent-log-tab-in-feature-drawer

## Summary
Add a seventh tab — **Agent Log** — to the dashboard feature drawer, sitting between Stats and Control. It fetches the implementation log markdown file(s) under `docs/specs/features/logs/feature-{id}-*-log.md` for the active feature and renders them with the existing `marked.parse()` pipeline that the Spec tab already uses. Handles solo (one log), drive-worktree (one log), and Fleet (one per agent, with a simple agent picker) modes. Purely a read-only viewer — no edit affordance.

## User Stories
- [ ] As a user looking at a feature in the dashboard, I can click an **Agent Log** tab and see the rendered markdown of the agent's implementation notes without leaving the UI
- [ ] As a user reviewing a Fleet feature, I can switch between each agent's log via a small picker inside the Agent Log tab
- [ ] As a user, when a log file doesn't exist yet (e.g. feature just started, agent hasn't written anything), I see a clear "No log written yet" message rather than an error
- [ ] As a user, the log tab uses the same font-size / copy / scroll controls as the Spec tab — no divergent UX

## Acceptance Criteria

### Frontend (UI)
- [ ] **AC1** — New tab button `<button class="drawer-tab" data-tab="log" role="tab">Agent Log</button>` added to `templates/dashboard/index.html` in the `#drawer-tabs` row, positioned between **Stats** and **Control**
- [ ] **AC2** — `templates/dashboard/js/detail-tabs.js` grows a `renderLog(payload)` function that calls `marked.parse(content)` and injects the result into `#drawer-detail-content`, identical to how Spec renders (reuse the same CSS classes where possible)
- [ ] **AC3** — The tab-switching dispatch in `renderTab()` (around line 477) gains an `else if (tab === 'log') renderLog(payload);` branch
- [ ] **AC4** — For Fleet features, the tab body shows a small agent picker (`<select>` or inline buttons) listing the agents from `payload.agentLogs` — switching between them re-renders the markdown for that agent's log without re-fetching the detail payload
- [ ] **AC5** — For solo / drive-worktree features (one agent), no picker is shown — just the log directly
- [ ] **AC6** — When a log file doesn't exist yet, show `<div class="drawer-empty">No agent log written yet.</div>` — never throw or show a stack trace

### Backend (API)
- [ ] **AC7** — The existing `/api/detail/feature/:id` endpoint (served by `lib/dashboard-server.js:~L2151`) includes a new `agentLogs` field in its response: `{ [agentId]: { path: string, content: string | null } }`. If a log doesn't exist, the entry is `{ path: string, content: null }`.
- [ ] **AC8** — The collector that builds the detail payload looks for log files matching `feature-{paddedId}-*-log.md` under `docs/specs/features/logs/`. Files with an agent infix (`feature-NN-cc-*-log.md`) are keyed by agent id; files without (`feature-NN-*-log.md` where the next token isn't a 2-letter agent code) are keyed by the string `"solo"`.
- [ ] **AC9** — Log content is returned raw markdown — **no** dependency-graph injection, **no** frontmatter stripping. Frontend's `marked.parse()` handles rendering.
- [ ] **AC10** — The detail payload's size stays bounded: if any single log exceeds **256 KB**, truncate with a `… (log truncated — view full file at <path>)` footer. Prevents pathological cases from bloating the HTTP payload.
- [ ] **AC11** — Do NOT route logs through `/api/spec` because that endpoint injects dependency-graph SVGs meant for specs. The `agentLogs` payload field is the only delivery path.

### Behavior
- [ ] **AC12** — Tab state and the rest of the drawer behavior do not regress — existing Spec / Status / Events / Agents / Stats / Control tabs work identically to before
- [ ] **AC13** — Tab is visible for every feature stage (inbox / backlog / in-progress / evaluation / done). Logs may or may not exist at each stage; the tab itself doesn't hide
- [ ] **AC14** — Dashboard is backward-compatible: if `agentLogs` is absent from the payload (older aigon server), the frontend treats it as "no logs available" and shows the empty state

### Test
- [ ] **AC15** — New unit / integration test covering the backend log collection helper. Test fixture must include a solo log AND a Fleet log (two agents), verifying both keying strategies work AND the 256 KB truncation behavior. Regression comment names the specific bug it prevents.
- [ ] **AC16** — Pre-push check must pass: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`. Current budget: 1624 / 2000; this feature adds ~30-60 test LOC, still well under the 2000 ceiling.
- [ ] **AC17** — Manual smoke: open the dashboard on this repo after implementation, click feature #224 (or any done feature with a log in `docs/specs/features/logs/`), verify the Agent Log tab shows the rendered markdown. Capture a Playwright screenshot.

## Validation

```bash
# Syntax
node -c aigon-cli.js
node -c lib/dashboard-server.js
node -c lib/dashboard-status-collector.js

# Test suite — mandatory pre-push check per CLAUDE.md rule T1
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh

# Manual smoke
aigon server restart
open http://aigon.localhost
# click feature #224 → Agent Log tab → verify rendered markdown
```

## Technical Approach

### What exists today
- `templates/dashboard/index.html:395-402` — `#drawer-tabs` row with 6 buttons
- `templates/dashboard/js/detail-tabs.js` — tab switching + `renderEvents`, `renderAgents`, `renderStats`, `renderControl` handlers at ~line 477
- `templates/dashboard/js/spec-drawer.js:91-95` — existing `marked.parse()` call — renderer already loaded, no import needed
- `lib/dashboard-server.js:~L2151` — `/api/detail/:type/:id` GET endpoint
- `lib/dashboard-status-collector.js` — builds the detail payload
- `lib/commands/misc.js:192-202` — existing log-discovery regex that can be mirrored
- Log filename conventions:
  - Solo: `feature-{paddedId}-{desc}-log.md`
  - Drive-worktree / Fleet: `feature-{paddedId}-{agentId}-{desc}-log.md` where `agentId` is always a 2-letter code

### Implementation sketch

**Backend** (`lib/dashboard-status-collector.js`, ~30 lines):
1. Add `collectAgentLogs(repoPath, paddedFeatureId)`:
   - List files in `docs/specs/features/logs/` matching `^feature-{paddedId}-(.+)-log\.md$`
   - For each match, parse the capture group: if it starts with a 2-letter agent code followed by `-`, key by that agent; otherwise key by `"solo"`
   - Read each file, apply the 256 KB truncation (AC10)
   - Return `{ [agentId]: { path, content } }`
2. Call the helper from the feature detail assembler and include the result in the returned payload as `agentLogs`

**Frontend** (`templates/dashboard/js/detail-tabs.js`, ~40 lines):
1. Add `renderLog(payload)` that:
   - Reads `payload.agentLogs` (default to `{}` if missing — AC14)
   - If empty: render the empty state per AC6
   - If single entry: render directly via `marked.parse(entry.content)`
   - If multiple entries: render a small picker + the currently-selected log, with an event listener to re-render on selection change (no re-fetch)
2. Wire `else if (tab === 'log') renderLog(payload);` into the `renderTab()` dispatch around line 477
3. Add tab button in `index.html` between Stats and Control (AC1)

**Tests** (`tests/integration/`, ~50 lines):
- New test file `agent-log-collector.test.js` OR addition to `lifecycle.test.js`
- Exercise `collectAgentLogs` directly with a temp dir containing:
  - One solo log (`feature-07-dark-mode-log.md`)
  - Two Fleet logs (`feature-08-cc-social-sharing-log.md`, `feature-08-gg-social-sharing-log.md`)
  - One oversized log (> 256 KB) to verify truncation
- Assert:
  - Solo log is keyed under `"solo"`
  - Fleet logs are keyed under `"cc"` and `"gg"`
  - Oversized log is truncated with the footer text
  - Missing log returns `{ path, content: null }`

### What is NOT changing
- `/api/spec` endpoint — unchanged; logs do not route through it
- `spec-drawer.js` — unchanged; the Spec tab still only shows specs
- `marked` library — already imported; no new dependency
- Feature drawer CSS layout — reuses existing `.drawer-tab`, `.drawer-detail-content`, `.drawer-empty` classes
- Log file format, location, or naming convention — unchanged
- Workflow engine — unchanged (purely a read-side feature)
- Any other detail tab's behavior — unchanged

### Edge cases
- **No log file**: graceful empty state per AC6, not an error
- **Log with YAML frontmatter**: per CLAUDE.md logs are "pure narrative markdown — no YAML frontmatter, no machine state", but if one sneaks in, `marked.parse()` renders it as a top heading block, which is acceptable
- **Log exceeds 256 KB**: truncated with footer link to full path (AC10)
- **Older aigon version without `agentLogs` field**: frontend renders empty state (AC14)
- **Log file deleted between fetch and render**: already handled by try/catch in `fetchDetailPayload()`
- **Filename parse fails** (non-standard log filename): skip that file, don't crash

## Dependencies
- None. All the machinery (`marked.parse`, tab switching, drawer layout, detail payload) already exists.

## Out of Scope
- Editing the log file from the dashboard (logs are read-only, matching the Spec tab convention)
- Searching within logs
- Diffing logs across agents (interesting but separate feature)
- Showing research logs (this feature is scoped to feature logs only)
- Syntax highlighting beyond what `marked` provides out of the box
- Live log tailing (logs are written at commit time, not streamed)
- Adding a log-file count badge to the tab button

## Open Questions

None — all design decisions are made.

## Related
- `templates/dashboard/index.html` — tab bar
- `templates/dashboard/js/detail-tabs.js` — tab dispatch + render handlers
- `templates/dashboard/js/spec-drawer.js` — existing `marked.parse` pattern to mirror
- `lib/dashboard-status-collector.js` — detail payload builder
- `lib/dashboard-server.js:~L2151` — `/api/detail/:type/:id` endpoint
- `lib/commands/misc.js:192-202` — existing log-discovery regex pattern
- CLAUDE.md rule T1 (pre-push test check) and rule T2 (new code ships with a test) — both apply
