---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T01:55:00.649Z", actor: "cli/feature-prioritise" }
---

# Feature: settings-scope-restructure

## Summary

The dashboard Settings UI currently models every setting as "shared default with per-repo override." That's wrong for two whole categories of settings:

1. **User preferences** (terminal app, focus-on-launch, idle timings, auto-nudge, background agents) — these describe how the *user* wants aigon to behave. Asking "do you want a per-repo override?" for these is nonsensical: the answer is always "no, same for every repo."
2. **Repo-intrinsic facts** (profile, dev-server-enabled) — these describe what the repo *is*. A global default is meaningless: a repo either is iOS or it isn't.

Today every schema entry lands under "Repository Settings" with an override column. The result: discoverability collapses (the new `terminal.focusOnLaunch` toggle introduced in F520 ended up here even though it's pure user UX, far from where users would look), and users are repeatedly asked to make override decisions for things that have no business being overridden.

This feature introduces an explicit `scope: 'user' | 'shared' | 'repo'` field per schema entry, restructures the settings UI into three sections that match those scopes, and refuses invalid writes at the API layer (e.g. PATCH attempts to set a repo-level value for a user-scoped key get rejected).

## User Stories

- [ ] As a user looking for "where do I change terminal focus behaviour?" I find it under **Settings → Terminal** next to the other terminal preferences, not buried in "Repository Settings."
- [ ] As a user, I never see a "per-repo override" column for settings that are about *me* (terminal app, idle thresholds, auto-nudge). The UI doesn't tempt me to set them differently per repo.
- [ ] As a user, I see the repo's **Profile** (web/api/ios/etc.) and **Dev server status** as read-only context in the repo settings — they aren't editable "defaults" with override columns; the values come from the repo itself.
- [ ] As a user, the **Repository Settings** section is short and meaningful: just the settings that genuinely make sense to vary per repo (default agent, security enabled, security mode).
- [ ] As a user, when I change a user-preference setting in one repo's settings view, I understand from the UI that it applies globally — there's no per-repo override option to confuse me.

## Acceptance Criteria

### Schema

- [ ] Each entry in `DASHBOARD_SETTINGS_SCHEMA` (lib/dashboard-server.js:822) gains a required `scope` field with one of three values:
  - `'user'` — global only. No per-repo override allowed.
  - `'shared'` — global default with per-repo override (current behaviour).
  - `'repo'` — per-repo only, no global default. Often read-only / auto-detected.
- [ ] Initial scope assignment per current schema key (proposed in Technical Approach; final list decided in spec-review):
  - `user`: `terminalApp`, `terminal.focusOnLaunch`, `backgroundAgents`, `autoNudge.enabled`, `autoNudge.idleVisibleSeconds`, `autoNudge.idleNudgeSeconds`, `autoNudge.idleEscalateSeconds`
  - `shared`: `defaultAgent`, `security.enabled`, `security.mode`, all `agents.*.*.model` entries
  - `repo`: `profile`, `devServer.enabled` (read-only display when not present), plus anything else that's intrinsically per-repo
- [ ] `DASHBOARD_SETTINGS_SCHEMA` continues to expose every entry; the scope field is the only new shape.

### API

- [ ] The `/api/settings` (or equivalent) endpoint includes `scope` in the per-setting payload returned alongside `effectiveValue`, `source`, etc.
- [ ] `PATCH` (or POST) writes are validated against scope:
  - `user` scope: writes only accepted at global scope (`scope: 'global'` in the body). Attempts to write per-repo return 400 with a clear error.
  - `repo` scope: writes only accepted at project scope. Attempts to write globally return 400.
  - `shared` scope: both global and project writes accepted (current behaviour).
- [ ] When loading values, the resolver continues to honour the existing precedence (project > global > default) for `shared` keys. For `user` keys, project-level values are *ignored* — if a stale per-repo override exists in `.aigon/config.json`, log a one-line warning at server start.

### UI restructure

- [ ] **Settings → Terminal** (hand-coded section, `templates/dashboard/js/settings.js:1206`): in addition to "Session click target" and "Terminal font", render two new schema-driven rows:
  - **Terminal app** (moved here from Repository Settings) — picker bound to `terminalApp`.
  - **Bring terminal to foreground when starting a session** — toggle bound to `terminal.focusOnLaunch`. Closes F520's discoverability gap.
  - Both rows visually match the existing hand-coded controls but write via the schema-aware settings API (so source-of-truth stays the same).
- [ ] **Settings → Preferences** (NEW top-level section): renders all `scope: 'user'` entries that aren't already shown in Terminal. Initial contents: Background agents, Auto-nudge enabled, Idle visible/nudge/escalate seconds. **No "shared" vs "project" override column** — single value, single source.
- [ ] **Settings → Repository Settings** (existing, slimmed down): renders only `scope: 'shared'` entries. The "global default | per-repo override" two-column layout stays for these. After restructure, this section is roughly 3-5 controls (default agent, security enabled, security mode, plus per-agent model defaults if they live here).
- [ ] **Repo-intrinsic info** (`scope: 'repo'`): Profile and Dev server enabled render as **read-only context cards** at the top of the repo-specific settings view. They describe the repo; they aren't an editable "default with override."

### Migration & backwards compat

- [ ] If an existing `.aigon/config.json` (project-level) contains a key now classified as `user`-scope (e.g. someone set `terminalApp` per-repo at some point), the value is **ignored** at resolution time and a one-line server warning lists each affected key/path on startup. No automatic deletion — that's the user's call.
- [ ] `~/.aigon/config.json` keeps its current structure. No schema migration needed.
- [ ] The aigon CLI `config get/set` commands continue to work but learn the scope rules: `aigon config set terminal.focusOnLaunch foreground --project` exits non-zero with the same scope error the API returns.

### Tests

- [ ] Unit tests for the schema scope tagging (every entry has a scope; scopes are one of three values).
- [ ] Unit tests for the API validation: user-scope-write-at-project rejected, repo-scope-write-at-global rejected, shared-scope writes accepted at both.
- [ ] Unit test for the resolver: stale per-repo override of a user-scope key is ignored and surfaces the warning.
- [ ] Smoke test for the UI restructure: schema-driven rows render in the right section by scope, no row appears in two sections, no scope-shared row is missing.

### Docs

- [ ] `docs/architecture.md` (or the settings-specific doc) gains a short "Setting scopes" section that defines the three scopes and lists which keys fall into which.

## Validation

```bash
```

## Technical Approach

**Three scopes, three sections, one new field.** The work is structural rather than algorithmic — most of the difficulty is in correctly classifying each existing setting and in tearing down the override columns where they no longer apply.

**Why a `scope` field rather than three separate schemas:** the schema list is the single source of truth for both the API response shape and the UI render order. Splitting it into three files duplicates metadata (labels, descriptions, validation) and makes future additions error-prone. A single field per entry, validated at registration time, is the smaller change.

**Resolver behaviour for `user`-scope keys:** `getEffectiveConfig()` (lib/config.js:780-ish) currently merges project on top of global on top of defaults. For user-scope keys it must short-circuit project — read only from global + default. The cleanest way is a `USER_SCOPE_KEYS` set derived from the schema at config-module load time, consulted before applying the project-level merge.

**UI changes:**
- `templates/dashboard/js/settings.js:1206-1283` (hand-coded Terminal section): extend `renderTerminalSettings()` to render two extra rows using the same schema-aware update API the auto-generated rows already use. Reuse the existing input-builder helpers (`makeEnumInput` / `makeToggleInput` or similar — implementer to find and reuse, not rewrite).
- A new `Settings → Preferences` section: largely the auto-generated layout from `renderDefaultsAndOverridesSection`, but with the override column suppressed and the title changed.
- `renderDefaultsAndOverridesSection` (somewhere around line 1289): filter its schema input to `scope === 'shared'` only.
- New read-only `Repo Context` block at the top of the repo-specific view rendering `scope === 'repo'` items as static cards.

**Edge case worth a paragraph in the spec-review:** `agents.<id>.<role>.model` keys today appear under Repository Settings and arguably *should* be overridable per repo (some repos want sonnet, others opus). Classify these as `shared`. Worth checking: do any agent-related settings (e.g. CLI binary paths) actually need to be `user`-scope? Likely yes — `agents.<id>.cli` is "what's installed on my machine," not "what this repo wants." Implementer should sweep the agents subtree carefully.

**Implementation order suggestion (the implementing agent can rearrange but this minimises risk):**
1. Add `scope` field + classify every existing schema entry.
2. Resolver short-circuit for `user`-scope keys + warning on stale overrides.
3. API write-validation.
4. UI: extend Terminal section (F520 follow-up).
5. UI: new Preferences section.
6. UI: slim Repository Settings + read-only Repo Context cards.
7. Tests + docs.

Steps 1-3 can ship without 4-7 and the system stays correct (UI just stays as today, no regression). 4 alone closes F520's discoverability gap if 5-6 slip.

## Dependencies

- F520 (`terminal-background-launch`) is the proximate trigger. F520 is done; this feature inherits its `terminal.focusOnLaunch` key as one of the first `user`-scope entries and resolves its UI-placement gap as a side effect (AC under "Settings → Terminal").

## Out of Scope

- Adding *new* settings. This is a pure classification + restructure of what already exists.
- Reworking the secrets / `agents.*.cli` flag schema beyond scope classification.
- Renaming or removing existing keys. Backwards compat for stored values is preserved (with the documented "ignore stale per-repo user-scope values" behaviour).
- Project profile auto-detection logic — it stays as-is; the change is only that the *display* of the profile becomes read-only context rather than a "default with override" row.
- The CLI's interactive prompts for first-run setup. They keep their current shape; future work could mirror the scope split.

## Open Questions

- **Per-agent model defaults**: classify each `agents.<id>.<role>.model` key as `shared` (overridable per repo) or `user` (always global)? Proposal: `shared` because some repos genuinely want different models, but spec-review should confirm.
- **`agents.<id>.cli` and `agents.<id>.implementFlag`**: these are "what's on my machine" and "what flags the CLI accepts" — almost certainly `user`-scope. Confirm no repo wants per-repo overrides of these (none come to mind).
- **Stale per-repo override warning**: log only, or also surface in the dashboard as a "this value is being ignored" affordance? Proposal: log-only for v1, dashboard surface as a follow-up if it actually bites anyone.
- **Should the Preferences section sit at the top or bottom of the Settings nav?** Top makes sense because user preferences are the most-frequently-flipped controls; Repository Settings is where less-frequent operational tuning lives.
- **What happens to `.aigon/config.json` files that are now entirely empty after stale-key cleanup?** Probably leave them — emptiness is harmless and removing them changes git status. Not worth special-casing.

## Related

- Research:
- Set:
- Prior features in set: F520 (terminal-background-launch)
