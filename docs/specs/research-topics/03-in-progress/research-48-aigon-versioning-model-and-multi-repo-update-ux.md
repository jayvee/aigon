---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-09T13:30:54.488Z", actor: "cli/research-prioritise" }
---

# Research: aigon-versioning-model-and-multi-repo-update-ux

## Context

Aigon currently carries three versions that can drift independently:

1. The global CLI binary (whatever `aigon --version` reports — installed via `npm install -g @senlabsai/aigon` or as a clone).
2. Each repo's `.aigon/version` pin (the CLI version that last ran `aigon update` in that repo).
3. The dashboard runtime (whatever CLI version started the running dashboard server).

Until F493 ships, drift between #1 and #2 is hidden by a `SessionStart` hook that silently auto-syncs the repo. F493 makes hooks non-mutating, which exposes the drift to users as a problem they didn't have before: *"my CLI is at v2.65, this repo is at v2.64, my dashboard server was started when CLI was v2.63 — what do I do?"*

A naive response was to add an `aigon update-notice` command and a dashboard "update available" indicator. We rejected that during F493 spec review: it layers UX over a confused model and locks the model in. The right move is to question the model first.

## Questions to Answer

- [ ] Should `.aigon/version` exist at all? Three candidate models:
  - **(a) Keep per-repo pin.** Status quo. Pin records the last sync; `aigon update` advances it. User is responsible for running `aigon update` in each repo when they want to sync.
  - **(b) Remove the pin entirely.** Templates and managed files always come from the currently-installed CLI at session time (or first-command time). "Updating" a repo becomes a no-op — there's nothing to be out of sync.
  - **(c) Hybrid: pin a manifest hash, not a semver.** Detect when *content* drifts (template changes) regardless of version number; sync only when content actually differs.
- [ ] If we keep a pin (a or c), what's the right multi-repo UX? Candidates:
  - Known-repos registry (`~/.aigon/known-repos.json`) populated on every `aigon init` / `aigon install-agent` / `aigon update`.
  - `aigon update --all` walks the registry.
  - Dashboard shows "N of your M repos are behind: [list]" with one-click sync per repo.
- [ ] Where does the dashboard fit? It's currently single-repo by design. Should it stay that way, or become a multi-repo command center? What's the cost of each direction?
- [ ] How does this interact with hookless agents (Codex / Kimi / OpenCode)? They get no startup notice today. The dashboard is the only universal surface; what's the right minimum there?
- [ ] What is the actual user experience we want? Concrete scenarios to walk through:
  - User runs `npm update -g @senlabsai/aigon` on Monday. They have 8 aigon-using repos. What should happen across the next week of normal work?
  - User opens an old repo they haven't touched in 3 months. CLI has shipped 12 versions since. What should they see, and where?
  - User is on Codex and Kimi exclusively. Where do they ever learn that an update exists?
  - User has the dashboard open from one repo while working in another. What signal do they get?
- [ ] What about `aigon update --pull` for clone-installed users? It runs `git pull && npm ci` in the aigon repo. Does that path stay first-class, or is npm-installed considered the supported path going forward?

## Scope

### In Scope

- The three-version drift model (CLI, repo, dashboard).
- Multi-repo update UX across all six supported agents.
- The role of the dashboard as a versioning/update surface.
- Cost/benefit of removing `.aigon/version` vs improving its visibility.
- Interaction with the `aigon update --pull` path for clone-installed users.

### Out of Scope

- Implementing any chosen direction. This is a research topic — output is one or more feature specs.
- The `check-version` write-path bug itself — F493 handles that.
- Telemetry, hook safety, or any other concern not directly about versioning UX.
- Publishing/packaging mechanics (npm tag strategy, beta channels, etc.).

## Findings

<!-- to be filled by the research agent -->

## Recommendation

<!-- to be filled by the research agent -->

## Output

- [ ] Feature: TBD (research output will name 1-2 concrete features depending on the chosen direction)
