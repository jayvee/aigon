---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-09T13:30:54.488Z", actor: "cli/research-prioritise" }
---

# Research: aigon-versioning-model-and-multi-repo-update-ux

## Context

Aigon currently carries three versions that can drift independently:

1. The global CLI binary (whatever `aigon --version` reports — installed via `npm install -g @senlabsai/aigon` or as a clone).
2. Each repo's `.aigon/version` pin (the CLI version that last ran `aigon apply` in that repo).
3. The dashboard runtime (whatever CLI version started the running dashboard server).

Until F493 ships, drift between #1 and #2 is hidden by a `SessionStart` hook that silently auto-syncs the repo. F493 makes hooks non-mutating, which exposes the drift to users as a problem they didn't have before: *"my CLI is at v2.65, this repo is at v2.64, my dashboard server was started when CLI was v2.63 — what do I do?"*

A naive response was to add an `aigon apply-notice` command and a dashboard "update available" indicator. We rejected that during F493 spec review: it layers UX over a confused model and locks the model in. The right move is to question the model first.

## Questions to Answer

- [ ] Should `.aigon/version` exist at all? Three candidate models:
  - **(a) Keep per-repo pin.** Status quo. Pin records the last sync; `aigon apply` advances it. User is responsible for running `aigon apply` in each repo when they want to sync.
  - **(b) Remove the pin entirely.** Templates and managed files always come from the currently-installed CLI at session time (or first-command time). "Updating" a repo becomes a no-op — there's nothing to be out of sync.
  - **(c) Hybrid: pin a manifest hash, not a semver.** Detect when *content* drifts (template changes) regardless of version number; sync only when content actually differs.
- [ ] If we keep a pin (a or c), what's the right multi-repo UX? Candidates:
  - Known-repos registry (`~/.aigon/known-repos.json`) populated on every `aigon init` / `aigon install-agent` / `aigon apply`.
  - `aigon apply --all` walks the registry.
  - Dashboard shows "N of your M repos are behind: [list]" with one-click sync per repo.
- [ ] Where does the dashboard fit? It's currently single-repo by design. Should it stay that way, or become a multi-repo command center? What's the cost of each direction?
- [ ] How does this interact with hookless agents (Codex / Kimi / OpenCode)? They get no startup notice today. The dashboard is the only universal surface; what's the right minimum there?
- [ ] What is the actual user experience we want? Concrete scenarios to walk through:
  - User runs `npm update -g @senlabsai/aigon` on Monday. They have 8 aigon-using repos. What should happen across the next week of normal work?
  - User opens an old repo they haven't touched in 3 months. CLI has shipped 12 versions since. What should they see, and where?
  - User is on Codex and Kimi exclusively. Where do they ever learn that an update exists?
  - User has the dashboard open from one repo while working in another. What signal do they get?
- [ ] What about `aigon apply --pull` for clone-installed users? It runs `git pull && npm ci` in the aigon repo. Does that path stay first-class, or is npm-installed considered the supported path going forward?

## Scope

### In Scope

- The three-version drift model (CLI, repo, dashboard).
- Multi-repo update UX across all six supported agents.
- The role of the dashboard as a versioning/update surface.
- Cost/benefit of removing `.aigon/version` vs improving its visibility.
- Interaction with the `aigon apply --pull` path for clone-installed users.

### Out of Scope

- Implementing any chosen direction. This is a research topic — output is one or more feature specs.
- The `check-version` write-path bug itself — F493 handles that.
- Telemetry, hook safety, or any other concern not directly about versioning UX.
- Publishing/packaging mechanics (npm tag strategy, beta channels, etc.).

## Findings

See per-agent findings under `docs/specs/research-topics/logs/`:
- `research-48-cc-findings.md`
- `research-48-cu-findings.md`
- `research-48-cx-findings.md`

## Recommendation

The five-feature `apply-model` set below resolves both the structural problem (drift detection that doesn't lie about patch bumps) and the UX problem (verbs that don't collide with `npm update`).

**Verb decision.** Rename `aigon apply` → `aigon apply`. The current verb is unrecoverably ambiguous against `npm update -g @senlabsai/aigon` — both contain "update" but mean different things. `apply` mirrors Terraform/Kubernetes/Ansible declarative reconciliation, is idempotent (no-op when in sync), and never collides with npm. The `--pull` flag (clone-install convenience) is **deleted entirely** — aigon is an npm-installable product; clone-install is a contributor concern handled by `git pull && npm ci` in the contributor's own shell, not a CLI verb.

**Mental model.** Two named artifacts:
- **aigon CLI** — the installed binary, owned by npm (`npm update -g @senlabsai/aigon`)
- **applied aigon** — the files aigon wrote into a repo (slash commands, agent configs, hooks, vendored docs), owned by `aigon apply`

Every drift message names *both sides* ("applied v2.63, installed v2.67") — never "out of sync."

**Drift detection.** Switch from semver compare to content-digest compare. Today's notice fires on every patch bump even when no template changed; users learn to ignore it. The digest fires only when CLI-emitted artifacts would actually differ. `.aigon/version` stays as a human-readable provenance stamp.

**Surfaces.** One unified notice block across every place the user is already engaging with aigon: SessionStart hooks (cc/gg/cu/codex — codex newly possible since `codex_hooks` shipped), launcher wrapper for hookless agents (km/op), `aigon check-version` CLI, and dashboard chrome pill. **Silent when current.**

**Dashboard role.** Stay single-repo by default (workflow engine paths are cwd-scoped), but add a three-phase coached pill in the chrome that walks the user through the full upgrade arc: Phase 1 (newer on npm) → Phase 2 (restart server) → Phase 3 (re-apply to N repos with per-repo preview). Multi-repo list/buttons appear when the registry ships.

**Multi-repo.** Filesystem-marker registry (`~/.aigon/repos/<sha256(repoPath)>`) — auto-pruning, race-free, no JSON schema. `aigon apply --all` walks the registry. `npm postinstall` hook lists which known repos are now behind after a CLI upgrade.

## Output

### Set Decision

- Proposed Set Slug: `apply-model`
- Chosen Set Slug: `apply-model`

### Selected Features

| Feature ID | Feature Name | Description | Priority | Create Command |
|---|---|---|---|---|
| F496 | apply-1-rename-update-verb | Rename `aigon apply` → `aigon apply`; delete `--pull` flag entirely; deprecation alias on `update`; sweep all 166 references | high | `aigon feature-create "apply-1-rename-update-verb" --set apply-model` |
| F497 | apply-2-digest-drift-detection | Extend `.aigon/config-hash` (or new `.aigon/applied-digest`) to cover all CLI-emitted artifacts; switch drift trigger from semver compare to content-digest compare | high | `aigon feature-create "apply-2-digest-drift-detection" --set apply-model` |
| F498 | apply-3-session-drift-notice | Shared read-model + unified named-both-sides notice block rendered by SessionStart hooks (cc/gg/cu/codex), launcher wrapper (km/op), and `aigon check-version`; silent when current | high | `aigon feature-create "apply-3-session-drift-notice" --set apply-model` |
| F499 | apply-4-dashboard-upgrade-flow | Three-phase coached pill in dashboard chrome: Phase 1 (npm newer) → Phase 2 (restart server) → Phase 3 (re-apply with per-repo preview); single-repo + graceful multi-repo extension when F500 ships | high | `aigon feature-create "apply-4-dashboard-upgrade-flow" --set apply-model` |
| F500 | apply-5-multi-repo-registry | Filesystem-marker registry (`~/.aigon/repos/<sha256>`); `aigon apply --all`; `aigon repos list`; npm postinstall notice listing behind-repos | medium | `aigon feature-create "apply-5-multi-repo-registry" --set apply-model` |

### Feature Dependencies

```
  F496 rename
     ↓
  F497 digest detection
     ↓
  F498 session notice + read-model
     ↓
  ┌──┴──┐
  F499  F500
 (dash) (multi-repo)
```

- F497 depends on F496 (uses new `apply` verb in messages)
- F498 depends on F497 (drift trigger is digest-based)
- F499 depends on F498 (consumes the read-model and notice format)
- F500 depends on F498 (registry powers the multi-repo notice; F499's Phase 3 panel uses it when present, gracefully degrades when absent)

### Not Selected

- ~~`hookless-agent-version-guidance`~~ — folded into F498 (the launcher wrapper covers km/op universally)
- ~~`update-pull-clone-only-guard`~~ / ~~`aigon self upgrade`~~ — deleted entirely; `--pull` removed from product surface (contributor concern, not customer)
- ~~`npm-registry-advisory-machine-cache`~~ — minor optimization; existing 5-min cache is fine
- ~~Separate "machine view" tab~~ — folded into F499's Phase 3 expanded panel
