---
complexity: medium
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
---

# Feature: Token Maxing

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Let operators align provider rolling usage windows (e.g. Claude Pro/Max **~5 hour sliding** “session” limits) with their real workday by scheduling a deliberate **window kickoff** or **warm-up** across Aigon-managed agent sessions. This encodes “token maxing” as **scheduling and observability in Aigon**—one command (`aigon token-window`) to wake or nudge agents at a chosen time (e.g. 05:00 local), plus docs that explain the tradeoffs. Out of scope: evading or misrepresenting provider limits; the implementation must stay within normal product use and Terms of Service.

## Research & community patterns (2025–2026)

**How rolling windows are described (public sources)**  
- Many Claude Code / Claude Max users report a **rolling ~5 hour** cap on intensive agent usage: the limit is tied to **when you use the product**, not a single fixed clock reset, so the window “moves” with your activity.  
- **Window start:** Community guides stress that the relevant clock often **starts (or last resets) in relation to recent usage**—so **the first real interaction of the day** starts the window.  
- **“Warm-up” or scheduled ping:** Before deep work, send a **minimal, legitimate** message (or start a small session) so that by the time you need heavy use, the oldest high-usage slice has **fallen out of the 5h tail**. Automation examples use OS schedulers or cron-style jobs to run at 04:00–06:00.  
- **Multi-block days:** Some authors propose **two or three intentional blocks** (e.g. morning / midday / late afternoon) to align multiple rolling windows with a workday.  
- **Peak hours & weighting:** Press and users report **stricter or faster depletion** during **provider peak hours**. Aigon should **surface** existing budget/usage signals rather than hard-code vendor rules.  
- **Shared quota:** Usage is often **shared across surfaces** (IDE/terminal, web, etc.).  
- **Complementary:** Ecosystem tools (e.g. `ccusage`, Usagebar) track blocks; Aigon may respect the same read paths where already integrated (`lib/budget-poller.js`).

**Differs from Aigon’s existing 30s heartbeat**  
- Today’s per-feature heartbeats are **liveness** for the dashboard, **not** a provider “usage window” pump. Token maxing is about **orchestrating the first/scheduled interaction** with the **billing-related** limit surface.

## User Stories
- [ ] As an operator on a rolling-window plan, I want the `aigon token-window` command to **start or nudge** my configured agent sessions so my **5h window** is aligned with my workday.
- [ ] As an operator, I want **optional schedules** (launchd/cron/systemd examples in docs) to invoke that command with a **known timezone** and time.
- [ ] As an operator, I want the **dashboard or `/api/budget`** to show **post–kickoff** state so I can confirm the session is live before heavy work.
- [ ] As an operator, I want **clear warnings** in docs and CLI help regarding **peak-hour behavior**, **shared quota**, and **ToS/ethical** use.

## Acceptance Criteria
- [ ] **Command surface:** A new `aigon token-window` subcommand documents behavior in `--help` and is registered in the CLI dispatcher.
- [ ] **Operator workflow:** The command uses `lib/nudge.js` to target active agent sessions and sends a minimal kickoff message. If no sessions are active, it logs a clear no-op message and exits 0.
- [ ] **Config:** Timezone, target agent types, and an optional custom kickoff message are stored in `~/.aigon/config.json` under the `tokenWindow` key. The default message is "Checking in to align token window".
- [ ] **Budget integration:** The kickoff execution logs a timestamp to a state file (`.aigon/state/last-token-kickoff`), and the `/api/budget` response includes this `lastTokenKickoffAt` timestamp.
- [ ] **Tests:** New logic ships with a **REGRESSION:**-commented test per project rules; `npm test` passes.
- [ ] **Docs:** `docs/token-maxing.md` is created or updated to cover the **rolling-window mental model**, **scheduler setup examples** (cron, launchd), and **ToS caveats**.

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach
- **Phase 1 (MVP):** Implement `aigon token-window` + config schema in `lib/config.js` + help/docs. Reuse session resolution from `lib/nudge.js` and `lib/worktree.js`. Target global config (`~/.aigon/config.json`).
- **Phase 2 (Observability):** Add `lastTokenKickoffAt` to `/api/budget` by reading the `.aigon/state/last-token-kickoff` file updated by the command.
- **Scheduling:** Document **macOS `launchd`**, **systemd timer**, and **cron** examples that call the command. Aigon does not ship a long-running scheduler.
- **Supervisor / F308:** Cross-link in docs to clarify differences between rolling windows and actual token exhaustion.
- **Provider drift:** Do not hardcode 5h or peak rules; reference them as provider-dependent concepts in docs.

## Dependencies
- Soft: F322 **budget** surfaces (`lib/budget-poller.js`, `/api/budget`).
- Soft: `lib/nudge.js` for session targeting.

## Out of Scope
- Circumventing, spoofing, or **hiding** provider usage.
- Replacing third-party **ccusage** / **Usagebar**-style UIs.
- Guaranteeing full 5h blocks per day.
- A long-running built-in Aigon scheduler daemon.
