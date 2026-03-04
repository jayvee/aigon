# Feature: modes-and-terminology

## Summary

Reframe Aigon's terminology around four modes arranged on two axes: **how many agents** (one vs many) and **how hands-on you are** (hands-on vs hands-off). The current terms (solo, arena, Ralph) are internally consistent but don't communicate value to someone encountering Aigon for the first time. This feature introduces a vehicle/driving metaphor — **Drive, Fleet, Autopilot, Swarm** — with consistent language across the CLI, README, GUIDE, and the public marketing site (aigon.build). A companion feature will be created in the aigon-site repo to implement the website changes.

## The Mode Grid

```
                    One Agent          Multi-Agent
                 ┌──────────────┬──────────────────┐
  Hands-on       │    Drive     │     Fleet         │
                 ├──────────────┼──────────────────┤
  Hands-off      │  Autopilot   │     Swarm         │
                 └──────────────┴──────────────────┘
                         Autonomous
```

Two clear axes:
- **Horizontal**: How many agents? One or many.
- **Vertical**: How involved are you? Hands-on or hands-off.

The bottom row (Autopilot + Swarm) is collectively referred to as **Autonomous** mode.

---

### Drive Mode (currently "solo")

**What it is:** You work with one agent through the full lifecycle of a feature. You're guiding it at each stage — defining what to build, reviewing its work, course-correcting as you discover more about the feature. The agent writes the code; you're driving.

**Who it's for:** Day-to-day development. You want tight control over how a feature is implemented.

**How it feels:** You're behind the wheel. The agent is the engine — powerful, but you decide where to go and when to turn.

**Current Aigon terms this replaces:** "solo mode", "solo branch mode", "solo worktree mode"

**Setup:** `aigon feature-setup <ID>` (no agents — branch mode) or `aigon feature-setup <ID> <agent>` (worktree mode)

---

### Fleet Mode (currently "arena")

**What it is:** Multiple agents implement the same feature in parallel, each in an isolated worktree. You observe, guide, and intervene as needed. After they finish, you evaluate and pick the best implementation — or cherry-pick the best parts from each.

**Who it's for:** High-stakes features where you want multiple perspectives. Quality through diversity of approach.

**How it feels:** You're managing a fleet of vehicles, all heading to the same destination via different routes. You're still hands-on — checking progress, steering individual agents when needed.

**Current Aigon terms this replaces:** "arena mode"

**Why not "arena":** Arena implies a battle with a winner and losers. In practice, you often adopt ideas from multiple agents (feature #27: arena-adopt-best-of-losers). Fleet captures coordinated parallel effort without the combative connotation.

**Setup:** `aigon feature-setup <ID> cc cu gg` (multiple agents)

---

### Autopilot Mode (currently "Ralph loop" with one agent)

**What it is:** You define the feature spec with clear acceptance criteria and validation commands, then hand it off to a single agent. It implements, validates, retries if needed, and submits when done. You review the final output.

**Who it's for:** Well-specified features where you trust the spec and validation to catch issues. Features you want to run in the background or overnight.

**How it feels:** You've engaged autopilot. The vehicle knows the destination and how to get there. You check in when it arrives.

**Current Aigon terms this replaces:** "Ralph mode" (single agent), `--ralph` flag

**Why not "Ralph":** Insider reference (Geoffrey Huntley's blog post). Means nothing to someone encountering it for the first time. Autopilot is immediately understood and precisely describes the experience. Ralph attribution preserved in docs.

**Setup:** `aigon feature-implement <ID> --autonomous` or `aigon feature-now <name> --autonomous`

---

### Swarm Mode (currently "Ralph loop" with multiple agents)

**What it is:** Multiple agents run autonomously in parallel — each implementing, validating, and submitting independently. You define the spec and validation, then step away. The agents self-organise toward the goal.

**Who it's for:** Maximum throughput with minimum involvement. You want multiple autonomous attempts at the same feature, with evaluation at the end.

**How it feels:** You've dispatched a swarm. They coordinate implicitly through the shared spec and validation criteria. You review results when they converge.

**Current Aigon terms this replaces:** "Ralph mode" (multi-agent / arena + Ralph)

**Setup:** `aigon feature-setup <ID> cc cu gg --autonomous`

---

## How The Modes Compose

| Setup | Agents | Hands-on | Mode |
|-------|--------|----------|------|
| `feature-setup 55` | 1 | Yes | **Drive** |
| `feature-setup 55 cc cu gg` | 3 | Yes | **Fleet** |
| `feature-implement 55 --autonomous` | 1 | No | **Autopilot** |
| `feature-setup 55 cc cu --autonomous` | 2+ | No | **Swarm** |

## User Stories

- [ ] As a new Aigon user reading the README, I immediately understand the four modes via the 2x2 grid and know when to use each, without needing insider terminology
- [ ] As a developer, when I run any Aigon command, the CLI output uses mode names (Drive, Fleet, Autopilot, Swarm) that match the documentation and website
- [ ] As someone viewing aigon.build for the first time, I can see the mode grid and immediately form a mental model of what Aigon does and how the modes differ
- [ ] As a developer choosing a mode, I know what level of involvement each requires and what quality/speed tradeoff I'm making
- [ ] As a reader of the GUIDE, the hooks documentation uses the new mode names in examples and environment variable descriptions

## Acceptance Criteria

### Aigon CLI (`aigon-cli.js`)

- [ ] CLI output uses new terminology consistently: "Drive", "Fleet", "Autopilot", "Swarm"
- [ ] `--ralph` flag replaced with `--autonomous` (with `--ralph` kept as a hidden alias for backwards compatibility)
- [ ] `--autonomous` on `feature-setup` with multiple agents triggers Swarm mode (autonomous multi-agent)
- [ ] `--autonomous` on `feature-implement` (single agent) triggers Autopilot mode
- [ ] Mode detection logic updated: Drive (solo branch/worktree, hands-on), Fleet (multi-agent, hands-on), Autopilot (single, autonomous), Swarm (multi, autonomous)
- [ ] `AIGON_MODE` environment variable updated: `drive` | `fleet` | `autopilot` | `swarm` (old values `solo` | `arena` kept as aliases in hook resolution)
- [ ] Board display updated: `[F]` = Fleet, `[AP]` = Autopilot, `[S]` = Swarm (Drive is default, no indicator needed)
- [ ] help command output describes all four modes with one-line summaries
- [ ] Console emoji updated: `🚗 Drive` | `🚛 Fleet` | `✈️ Autopilot` | `🐝 Swarm`

### Documentation (aigon repo)

- [ ] README.md "Built for real multi-agent workflows" section rewritten with the 2x2 grid and mode descriptions
- [ ] README.md mode examples updated throughout (workflow section, CLI reference, etc.)
- [ ] All command templates updated (15+ files in `templates/generic/commands/`)
- [ ] `docs/ralph.md` renamed to `docs/autonomous-mode.md` with Ralph attribution preserved in a "History" section
- [ ] `docs/GUIDE.md` hook documentation updated with new `AIGON_MODE` values and examples
- [ ] `docs/development_workflow.md` updated with new mode terminology

### Public Website (aigon-site repo — separate feature)

- [ ] Create a new feature in the aigon-site repo: `feature-modes-terminology-site` to implement the website changes
- [ ] That feature should cover:
  - OG meta description updated (currently references "implementation arenas")
  - Hero/features section rewritten around the four modes
  - Demo tabs renamed: "Claude Code · Drive", "Multi-agent · Fleet", "Codex · Autopilot", "Multi-agent · Swarm"
  - Demo terminal content updated (e.g., `--ralph` → `--autonomous`, "Arena mode" → "Fleet mode", "Ralph implementing..." → "Autopilot implementing...")
  - Workflow section "Set up mode" examples updated
  - 2x2 mode grid added as a visual element (prominent placement)
  - "Research Arena" → "Research Fleet" or similar in feature tags

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Phase 1: CLI rename + flags (aigon repo)

1. Add `--autonomous` flag to `feature-implement` and `feature-setup` (alias `--ralph` for backwards compat)
2. Update mode detection logic to distinguish all four modes
3. Update `AIGON_MODE` values with fallback aliases for old values
4. Update console output strings in aigon-cli.js (~150 lines)
5. Update mode detection comments and variable names

### Phase 2: Documentation sweep (aigon repo)

1. Rewrite README modes section with 2x2 grid as the centrepiece
2. Update all 15+ command templates in `templates/generic/commands/`
3. Rename `docs/ralph.md` → `docs/autonomous-mode.md`
4. Update `docs/GUIDE.md` hook documentation
5. Update `docs/development_workflow.md`

### Phase 3: Website feature (aigon-site repo)

1. Create `feature-modes-terminology-site` spec in aigon-site
2. Implementation covers: meta tags, hero section, demo tabs, demo content, workflow section, mode grid visual
3. Deploy to aigon.build

### Naming conventions in code

| Context | Format | Example |
|---------|--------|---------|
| CLI output | Capitalised | `Drive mode`, `Fleet mode`, `Autopilot mode`, `Swarm mode` |
| Environment variable | lowercase | `AIGON_MODE=drive` |
| Internal code | camelCase | `isDriveMode`, `isFleetMode`, `isAutopilotMode`, `isSwarmMode` |
| Board indicators | Bracketed | `[F]`, `[AP]`, `[S]` |
| Docs/marketing | Title case | "Drive Mode", "Fleet Mode", "Autopilot Mode", "Swarm Mode" |
| Collective term | Title case | "Autonomous" (covers Autopilot + Swarm) |

### Migration: keeping things working

- `--ralph` → hidden alias for `--autonomous`
- `AIGON_MODE=solo` → resolves to `drive` in hooks
- `AIGON_MODE=arena` → resolves to `fleet` in hooks
- Old board indicators (`[2]`, `[wt]`) → replaced with `[F]`, `[AP]`, `[S]`
- No breaking changes to git worktree naming patterns (internal, not user-facing)
- CHANGELOG documents the terminology change with a mapping table

## Dependencies

- No code dependencies — terminology/documentation change with flag aliases
- Website changes tracked as a separate feature in the aigon-site repo

## Out of Scope

- Changing git worktree directory naming conventions (internal, not user-facing)
- Changing the `feature-setup` / `feature-implement` command names themselves
- Adding new functionality — this is purely terminology, messaging, and UX clarity
- Pricing/cost awareness integration (separate feature: agent-cost-awareness)
- VS Code extension terminology (can follow in a subsequent update)

## Open Questions

- Should "solo worktree" retain the `[wt]` indicator alongside Drive, or drop it since Drive covers both branch and worktree?
- Should the board show agent count alongside mode indicator? e.g., `[F3]` for 3-agent Fleet?
- Should there be explicit `--drive` / `--fleet` flags on `feature-setup` for clarity, or is the current inference (no agents = Drive, agents = Fleet) sufficient?
- Research mode: should "Research Arena" become "Research Fleet"? Or do research modes get their own naming?

## Related

- Feature: deploy-demo-update (aigon-site — coordinate demo content with new terminology)
- Feature: agent-cost-awareness (modes inform cost — Autopilot/Swarm burn more tokens)
- Feature: vscode-warp-jump (extension will need mode-aware labels)
- Feature #02: unify-workflow (previous terminology consolidation: "bakeoff" → "arena")
- Feature #16: ralph-wiggum (original autonomous loop implementation)
- Feature #35: ralph-auto-submit (Autopilot auto-submit behaviour)
