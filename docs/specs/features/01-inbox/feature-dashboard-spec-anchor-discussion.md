---
complexity: very-high
---

# Feature: dashboard-spec-anchor-discussion

## Summary

Bring **paragraph-anchored spec discussion** into the Aigon dashboard, inspired by [codesoda/discuss-cli](https://github.com/codesoda/discuss-cli/) (Rust): a browser review surface where each paragraph (or selectable region) carries threaded notes, with coding agents contributing takes without copy-pasting back and forth through the terminal only.

Today, the dashboard spec drawer renders markdown read-only (`spec-drawer.js` + `/api/spec`) and **Use AI** starts or reuses a repo-scoped **`ask-<repo>-<agent>`** tmux (`/api/session/ask`) seeded with a **whole-document** conversational prompt—not the selection-scoped workflow review users want during spec authoring.

This feature should close the gap: **select text in the rendered spec → invoke “Discuss…” → background tmux/agent session spins up (or attaches) scoped to that anchor → human and agent revise the Markdown on disk**, with the drawer able to refresh and show edits (reuse existing refresh and file watchers where possible). Longer term, optional **persisted thread metadata** beside the Markdown (rather than stuffing comments into source) preserves PR-review ergonomics while keeping specs merge-friendly.

## User Stories

- [ ] As a spec author reviewing a backlog feature in the browser, I highlight a fuzzy **Technical Approach** paragraph, right-click, choose **Discuss this passage**, and a tmux session opens with my agent primed with the path, excerpt, and my question—without re-pasting context.
- [ ] As an operator iterating with an agent on a passage, edits the agent writes to the spec appear in the drawer after refresh (or sooner if live reload is feasible), anchored discussion context stays attributable to **that** passage unless I start another thread.
- [ ] As a reviewer doing spec-review before prioritisation, I can see **whether** a section has unresolved discussion (indicator), open it, and continue threads across sessions where persistence is implemented.
- [ ] As someone who prefers the standalone tool, optional **CLI interoperability** leaves room to adopt or fork discuss-cli semantics (anchors, transcripts) rather than reinventing incompatible formats—but the **primary UX** stays inside Aigon.

## Acceptance Criteria

### Phase A — Seamless anchored “ask” (minimum lovable behaviour)

- [ ] Selection within the drawer preview (`#drawer-preview` markdown body) exposes a contextual action (**context menu entry and/or toolbar button**) that submits to the dashboard **the spec path**, **canonical anchor** for the excerpt (defined below—must survive minor edits differently than raw character offsets-only), **selected plain text**, and **optional operator note**.
- [ ] Backend extends `/api/session/ask` payload (or introduces a narrowly scoped sibling route dedicated to anchored spec discourse—document choice) such that the agent prompt reliably includes excerpt + filepath + anchoring hints and preserves existing **solo ask** semantics for repos without kanban-derived path problems.
- [ ] Behaviour when an `ask-<repo>-<agent>` tmux session already exists: **append as a new conversational turn** (same as today `send-keys`-style behaviour) seeded with anchored context, attach terminal per existing pattern.
- [ ] Automated tests cover parsing/validation for new JSON fields (invalid anchor → controlled 4xx, no orphaned tmux churn).
- [ ] Regression: unchanged flows for drawer open, refresh, fullscreen, and legacy **Use AI** without selection.

### Phase B — Persisted margins (discuss-cli parity trajectory)

- [ ] Persist discussion threads keyed by **stable anchor IDs derived from Markdown structure** (e.g., heading lineage + deterministic block ordinal; fallback to content hash plus path when structure is ambiguous) in a repo-local store (**gitignored workspace store under `.aigon/`** or sibling file under `docs/`—decision recorded in impl log based on collaborative vs solo default).
- [ ] Drawer UI renders unobtrusive gutter markers / counts for blocks with threads; supports expand collapse without breaking `marked`-rendered body (avoid innerHTML clashes—prefer DOM overlay or sanctioned wrapper spans).
- [ ] Thread survives browser refresh and **re-open** spec drawer for same path; tolerant of spec edits (**reconcile** orphaned anchors with explicit “lost context” UX).
- [ ] Docs: operator-facing paragraph in workflow doc how anchored discuss differs from `feature-spec-review` / `research-spec-review` launcher actions.

### Non-functional

- [ ] Anchors never execute untrusted Markdown; escape/sanitize persists for any user-authored thread snippets shown in-dashboard.
- [ ] No requirement to vendor discuss-cli binaries; OSS MIT reference only. Optional later task: subprocess wrapper for parity testing.

## Validation

```bash
npm test
```

Add feature-specific assertions if new modules land under `lib/` here or in OSS aigon (`node --check`, targeted unit tests).

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`, `dashboard/**`). Playwright still runs at the pre-push gate.

## Technical Approach

### Prior art: discuss-cli

[`discuss-cli`](https://github.com/codesoda/discuss-cli/) turns Markdown into a **local HTTP review UI** with threaded, paragraph-aligned comments agents can consume and extend—PR-style discourse on AI-generated plans/specs **without scrolling the terminal**. It takes file paths or `stdin`. Aigon differs in that specs already live behind authenticated dashboard **and** orchestration centres on **workflow entities** (`feature-N`, repos, tmux conventions); embedding the paradigm means **reuse Aigon’s drawer + `/api/session/ask`** rather than spawning a parallel web server permanently.

### Lifecycle integration

1. **Open spec** → existing drawer fetch `/api/spec?path=…` and `renderMarkdownPreview`.
2. **Select passage** → client computes `{ path, excerpt, structuralAnchor }`; operator adds optional note → POST → server composes **`prompt`** for agent CLI unchanged at transport layer (`agentBin` / flags / quoting per `sessions.js`).
3. **Agent session** → existing detached tmux **`ask-<repo>-<agent>`** pattern attaches via `openTerminalAppWithCommand`; reuse category metadata / session registry conventions.
4. **Spec churn** → operator uses **refresh** (`drawer-refresh`) or autosave hooks if added; Phase B overlays read store after markdown re-parse.

### Anchor strategy (conceptual—implementation owns details)

- Prefer **logical block identity** tied to Markdown AST (**heading stack + nth block**) over naked byte offsets—they thrash after edits above the fold.
- For overlapping selections spanning blocks, canonicalise to **smallest enclosing block list** or split threads—explicit edge-case behaviour in UX spec at implementation time.
- **Front matter** selectable via dedicated affordance excluded or normalised—the drawer already separates FM from body for display (`parseFrontMatter` vs `marked.parse(body)`); anchors should reference body stream only unless FM discussion is deliberate.

### Where code likely lives (cross-repo)

Most UI and routing live in OSS **aigon**; this inbox spec bridges into that repo.

Implementation should touch (paths indicative—verify against current tree):

**OSS (`aigon` public repo)**

- `templates/dashboard/js/spec-drawer.js` — selection, context actions, gutter plumbing.
- `templates/dashboard/index.html` / CSS bundles — gutter layout, fullscreen split with terminal.
- `lib/dashboard-routes/sessions.js` — ask payload augmentation, backward compatibility.
- Optional: `lib/dashboard-server.js` for shared wiring or static asset registration.

**Pro (`aigon-pro`)**

- If Pro skins or extensions enhance drawer (Insights pattern), shim here only **after** OSS core exists; otherwise leave empty until product demands Pro-only overlays.

OSS commits referencing this cross-repo effort should retain the **`Cross-repo: aigon-pro feature <ID>` footer** convention once prioritised ID exist.

### Optional future: delegated runner

Behind a gate, shells out to **`discuss` binary** for users who maintain it (`--port`, `--no-open`, transcript dirs) feeding the **same filesystem spec file**—Aigon redirects browser to Discuss UI or proxies content. Deferred until Phase B stable.

## Dependencies

- Relies on **tmux-presence assumptions** documented in OSS `sessions.js`: session naming collisions are repo+agent keyed—coordinate if multiple anchored prompts need parallel sessions (may require ephemeral session names keyed by correlation id).

## Out of Scope (initial deliveries)

- Replacing **`feature-spec-review`** / evaluator flows—those spawn role-specific reviewer agents; anchored discuss complements ad-hoc author iteration.
- **Multi-user realtime co-editing** (CRDT)—refresh-based consistency is acceptable for v1 unless trivial.
- **Shipping discuss-cli fork** inside the repo—as a runtime dependency—not required.

## Open Questions

- **Persistence gitignored vs committed threads**: Collaborative teams may want reviewer threads exported with PR—but committed JSON beside specs pollutes slug-based workflow. Recommendation: `.aigon/spec-discussions/<hash-key>.yaml` ignored by default, opt-in `--commit-threads` later.
- **Research / feedback specs** (`drawerState.type`)—single implementation path or feature-flag per type?
- **Warp vs Terminal.app** attach behaviour parity on macOS when multiple sessions attach quickly.

## Related

- External: [discuss-cli](https://github.com/codesoda/discuss-cli/) — product reference for PR-style markdown review.
- Internal: `templates/dashboard/js/spec-drawer.js` — current drawer + **Use AI** integration.
- Internal: `lib/dashboard-routes/sessions.js` — `/api/session/ask` tmux lifecycle.
