# Feature: Rewrite terminal demos to show realistic agent experiences

## Purpose

The current marketing site demos present Aigon commands as though they are standalone shell commands. In reality, Aigon is always used **inside an AI agent** — Claude Code, Codex, Gemini CLI, etc. The commands are slash commands or text instructions the developer gives to their agent, and the agent then reads specs, implements code, runs tests, and writes logs.

The demos should make this crystal clear by simulating what a developer actually sees: an agent prompt, a command typed into that agent, and the agent's realistic response as it works through the Aigon workflow.

## Target audience

Developers visiting aigon.build for the first time who have no prior Aigon experience.

## User Story

> As a developer evaluating Aigon, I want the terminal demos to show what the workflow actually looks like inside different AI agents, so I can see that Aigon works with the agent I already use — and understand what the experience feels like before I install anything.

---

## Core Idea: Agent-Specific Demo Terminals

Instead of a single generic terminal, create **three distinct demo scripts** that each simulate a real agent session. The viewer should see:

1. **An agent prompt** (e.g., Claude Code's `>`, Codex's `codex>`, Gemini's `gemini>`)
2. **The user typing an Aigon command** as a slash command or text instruction
3. **The agent's realistic response** — reading specs, creating tasks, implementing, running tests, committing, stopping and waiting

Each demo should rotate or be selectable, showing that Aigon is **agent-agnostic**.

### Demo 1: Claude Code — Solo Feature Implementation

Simulate a Claude Code session implementing a feature. Based on real interaction patterns:

```
~/src/myapp (main) $ claude

 ╭──────────────────────────────────────╮
 │ Claude Code         v1.0.32          │
 │                                      │
 │  /help for commands                  │
 ╰──────────────────────────────────────╯

> /aigon:feature-implement 07

  Reading spec: feature-07-jwt-auth.md

  ✓ Task 1/5: Create auth middleware
  ✓ Task 2/5: Add JWT token validation
  ✓ Task 3/5: Implement refresh token flow
  ◐ Task 4/5: Writing integration tests...
  ✓ Task 4/5: Integration tests (8/8 passing)
  ✓ Task 5/5: Update API documentation

  All tasks complete · 12 files changed
  Implementation log: logs/feature-07-cc-jwt-auth-log.md

  Ready for your review.
```

### Demo 2: Codex — Arena Feature Evaluation

Simulate a Codex session evaluating competing implementations:

```
~/src/myapp (main) $ codex

  codex> /aigon:feature-eval 07

  Evaluating 3 implementations of feature-07...

  Reading: feature-07-cc-jwt-auth (branch: feature-07-cc)
  Reading: feature-07-cx-jwt-auth (branch: feature-07-cx)
  Reading: feature-07-gg-jwt-auth (branch: feature-07-gg)

  ┌────────┬───────┬───────┬──────────┬───────┐
  │ Agent  │ Lines │ Tests │ Coverage │ Score │
  ├────────┼───────┼───────┼──────────┼───────┤
  │ cc     │   94  │  8/8  │   91%    │ 36/40 │
  │ cx     │   71  │  8/8  │   88%    │ 34/40 │
  │ gg     │   88  │  7/8  │   85%    │ 31/40 │
  └────────┴───────┴───────┴──────────┴───────┘

  Recommendation: cc (strongest coverage + error handling)

  Merge winner: aigon feature-done 07 cc --adopt
```

### Demo 3: Gemini CLI — Research Conduct

Simulate a Gemini session conducting research:

```
~/src/myapp (main) $ gemini

  gemini> /aigon:research-conduct 03

  Topic: auth strategy for mobile
  Reading: research-03-auth-strategy-for-mobile.md

  Investigating approach 1: Passkey / biometric auth...
  Investigating approach 2: Social OAuth (Google + Apple)...
  Investigating approach 3: Magic link email flow...

  Findings written: logs/research-03-gg-findings.md

  Key recommendations:
  1. Passkey as primary — best UX, strongest security
  2. Social OAuth fallback — covers older devices
  3. Magic link for email-only accounts

  Research complete · waiting for synthesis.
```

---

## Changes to Static Code Blocks

### Feature Cards (`#features` section)

The `<pre><code>` blocks in feature cards currently show bare commands. Update them to show the command in agent context where appropriate:

**"Spec to implementation" card** — currently `aigon feature-implement 01`:
```
# in your agent:
/aigon:feature-implement 01
```

**"Score implementations" advantage card** — currently `aigon feature-eval 07`:
```
# in your agent:
/aigon:feature-eval 07
```

### Workflow Steps (`#workflow` section)

**Step 03 (Implement)** — currently mixes shell and agent commands without distinction:
```
aigon worktree-open 07 --all
# then in each agent:
/aigon:feature-implement 07
```

**Step 04 (Evaluate, merge, adopt)** — currently shows `aigon feature-eval 07` as a shell command:
```
# in your agent:
/aigon:feature-eval 07
aigon feature-done 07 cx --adopt
aigon feature-cleanup 07
```

---

## Changes to Animated Demo Templates

### Replace `demo-arena-feature` hero demo

The current hero demo (`demo-arena-feature`) shows all commands as shell input. Replace it with a demo that cycles through (or allows selecting between) the three agent-specific demos described above.

At minimum, the hero demo should show the **Claude Code solo implementation** demo, since that's the most common entry point.

### Fix `aigon feature-eval 07` in `demo-arena-feature`

The current `demo-arena-feature` template has `aigon feature-eval 07` as a typed `data="input"` terminal line. This should become an output line showing the agent doing the evaluation — not a shell command the user types:

```html
<!-- Remove this -->
<terminal-line data="input" lineDelay="1200">aigon feature-eval 07</terminal-line>

<!-- Replace with agent-style evaluation output -->
<terminal-line data="output" lineDelay="400">  Evaluating 3 implementations...</terminal-line>
```

### Update other demo templates for consistency

Review all 5 demo templates (`demo-solo-feature`, `demo-solo-research`, `demo-arena-feature`, `demo-arena-research`, `demo-ralph`) and ensure that agent commands (`feature-implement`, `feature-eval`, `research-conduct`) are shown as instructions the agent receives — not as shell commands the user types.

---

## Inspiration: What Real Agent Sessions Look Like

These patterns are drawn from actual agent-aigon interactions across production repos:

### Real Solo Implementation (from farline feature-110)

```
User: /aigon:feature-implement 110
Agent reads spec → creates 9 tasks from acceptance criteria → implements systematically:
  - git mv 6 files (scheduler → forecaster)
  - Rename types: ScheduledScenario → ForecastScenario
  - Rename functions across 25 files
  - Create DB migration
  - Run npm run test:ci → 199/199 passing
  - Commit: "feat: rename internal scheduler to forecaster"
  - Write implementation log
  → STOPS: "Ready for your review"
```

### Real Arena Evaluation (from farline-ai-forge feature-10)

```
User sets up arena: aigon feature-setup 10 cc cx gg
  → 3 worktrees created, 3 agents implement in parallel

User: /aigon:feature-eval 10
Agent reads all 3 implementations side-by-side:
  - cc: scripts/lib-arena.sh (shared helpers), 6 scripts, all bash -n pass
  - cx: monolithic approach, fewer files, less modular
  - gg: over-engineered, added unnecessary dependencies
  → Scoring table + recommendation
  → STOPS: "Which implementation wins?"
```

### Real Research (from farline research-20)

```
User: /aigon:research-conduct 20
Agent investigates Excalidraw chart theming:
  - Pulls actual source code from GitHub API
  - Discovers font IDs in the spec were WRONG (corrects them)
  - Designs 5 color palettes with WCAG contrast validation
  - Creates sample .excalidraw files
  - Writes 347-line findings document
  → STOPS: "Research complete · waiting for synthesis"
```

### Real Feature with Code Review (from when-swell feature-32)

```
User: /aigon:feature-implement 32
Agent implements auth database foundation across 5 phases:
  Phase 1: Database (Neon + Drizzle) — schema, migrations
  Phase 2: BetterAuth (email OTP) — auth config, API routes
  Phase 3: Email service (Resend) — templates, lazy loading
  Phase 4: Rate limiting — per-IP and per-email
  Phase 5: Login UI — two-step OTP flow
  → Commits: 34 files changed, 320 insertions
  → Tests: npm run test:ci passing
  → STOPS

User: /aigon:feature-eval 32
Review agent finds 5 issues:
  1. Critical: login page had <html> tags breaking Next.js App Router
  2. Rate limiting bypass in direct API call
  3. Missing error handling in rate limit route
  → Fixes applied automatically
  → STOPS: "All issues resolved"
```

---

## Files to Change

| File | Change |
|---|---|
| `index.html` | Update `<pre><code>` blocks in features, advantages, and workflow sections |
| `index.html` | Rewrite demo templates to show agent-specific experiences |
| `index.html` | Add mechanism for cycling/selecting between agent demos (Claude Code, Codex, Gemini) |

---

## Acceptance Criteria

- [ ] At least 3 agent-specific demo scripts exist: Claude Code, Codex, and Gemini CLI
- [ ] Each demo shows a recognizable agent prompt/chrome, not a bare shell
- [ ] Demo content is realistic — based on actual aigon interaction patterns (task lists, test output, file counts, log writing, "stops and waits" behavior)
- [ ] The hero terminal cycles through or allows selecting between the agent demos
- [ ] Static `<pre><code>` blocks for agent commands show `/aigon:` slash-command syntax with `# in your agent:` annotation
- [ ] Workflow steps clearly distinguish shell commands from agent commands
- [ ] The `demo-arena-feature` template no longer shows `aigon feature-eval 07` as a typed shell input
- [ ] All 5 existing demo templates are reviewed for shell-vs-agent accuracy
- [ ] Page layout and visual design are unaffected
- [ ] The demos communicate that Aigon is agent-agnostic — it works with any AI coding agent

---

## Out of Scope

- Building a full interactive agent-selection UI component (simple cycling or tabs is sufficient)
- Rewriting the terminal animation engine itself
- Adding new sections to the page beyond updating existing demos and code blocks
- Supporting agents beyond Claude Code, Codex, and Gemini in the initial pass
