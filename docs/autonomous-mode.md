# Iterate Mode: Implementation Loops

Iterate mode is Aigon's Autopilot retry loop for feature implementation. Instead of writing code once and hoping it works, iterate mode runs an agent in a loop — implement, validate, repeat — until your tests go green.

Inspired by [the original pattern by Geoffrey Huntley](https://ghuntley.com/ralph/) and similar implementations like [chief](https://github.com/minicodemonkey/chief) that treat iterative agent loops as the primary development loop.

---

## How it works

```
aigon feature-do <ID> --iterate
```

Each iteration:
1. **Spawn** — a fresh agent session starts with the feature spec, validation commands, and a summary of all prior attempts
2. **Implement** — the agent writes code and commits before exiting
3. **Validate** — aigon runs your validation commands (build, tests, custom scripts)
4. **Evaluate** — acceptance criteria are checked (Smart Validation)
5. **Loop or stop** — if everything passes, done; if not, start the next iteration with failure context baked into the prompt

```
🔁 Iterate Loop: Feature 36 - spot-count-badge
   Agent: cc
   Iterations: 1..4
   Validation: npm run build

🚀 Iteration 1/4
   [agent implements, commits, exits]

🧪 Running validation (2 checks):
   [Project] npm run build   ✅
   [Feature] npx playwright test tests/feature-36.spec.ts   ❌

🧠 Criteria evaluation:
  ✅ [pass] Count badge uses correct singular/plural
  ❌ [FAIL] Badge has data-testid="spot-count"

↩️  Iteration 1 failed. Continuing to next iteration...

🚀 Iteration 2/4
   [agent reads failure, fixes data-testid, commits]

🧪 Running validation (2 checks):
   [Project] npm run build   ✅
   [Feature] npx playwright test tests/feature-36.spec.ts   ✅

✅ Iterate loop succeeded on iteration 2.
```

---

## Validation stack

Iterate mode runs two tiers of validation after each agent iteration:

### 1. Project-level validation

Configured in `.aigon/config.json`:

```json
{
  "iterate": {
    "validationCommand": "npm run build"
  }
}
```

This is your fast safety net — runs on every iteration. Use TypeScript compilation, a build step, or a broad test suite. It stops the loop early if the agent breaks something fundamental.

If no `validationCommand` is set, iterate mode uses profile-aware defaults:

| Profile | Default commands |
|---------|-----------------|
| `web` | `npm test` + `npm run build` (if script exists) + `npm run lint` (if script exists) |
| `ios` | `xcodebuild test` |
| `android` | `./gradlew test` |
| `api` / `library` | `npm test` |
| Any | `cargo test`, `go test ./...`, or `pytest` (detected automatically) |

### 2. Feature-level validation

Defined in the `## Validation` section of the feature spec:

```markdown
## Validation

```bash
npx playwright test tests/feature-36-spot-count.spec.ts --project=chromium
```
```

These commands run **after** project-level validation passes. Use them for feature-specific tests that target exactly the behaviour being built. Multiple commands are supported — all must exit 0.

### 3. Custom validation script

If you create `.aigon/validation.sh` in your project, it **replaces** profile defaults (but project config still wins):

```bash
#!/bin/bash
npm run build || exit 1
npm run type-check || exit 2
```

---

## The TDD pattern (most loops)

The most effective iterate mode setup is **write a failing test first**, then let iterate mode loop until it passes. This is the same discipline as TDD, but the loop runs itself.

```
write spec → write failing test → run iterate mode → tests go green
```

**Step 1**: Write the feature spec with clear acceptance criteria.

**Step 2**: Write a test file that will **fail** before the feature is implemented. Put it in `## Validation`.

**Step 3**: Run iterate mode:
```bash
aigon feature-do 36 --iterate --max-iterations=4
```

The agent reads the test, implements code to make it pass, commits, and iterate mode runs the test. If it still fails, the error output becomes context for the next iteration.

### What drives multiple iterations

| Factor | Effect |
|--------|--------|
| Vague spec (describes WHAT, not HOW) | More iterations — agent makes choices, tests catch wrong ones |
| Specific test selectors (`data-testid`, exact text) | Forces precision — agent likely misses first time |
| Behavioral tests (not just compilation) | Tests actual UX, not just TypeScript validity |
| Multiple acceptance criteria | Smart Validation evaluates each one; failures feed back as context |
| Complex integration | More surface area for mistakes |

### What collapses to 1 iteration

- Spec describes exact implementation (variable names, file paths, approach)
- Validation is only `npm run build`
- Feature is pure logic with no edge cases

If you find iterate mode always succeeds in one iteration, your validation isn't strict enough or your spec is too prescriptive.

---

## Smart Validation (Feature 17)

After your validation commands pass, iterate mode evaluates each acceptance criterion from your spec:

- **Objective criteria** (mentions tests, build, lint, type-check) — automatically marked as passed when commands pass
- **Subjective criteria** (code quality, pattern adherence, UX) — evaluated via a single LLM call against the git diff and implementation log

Results are logged in the progress file and fed back to the next iteration's prompt if anything fails. Checkboxes in the spec are updated as criteria are verified.

Run Smart Validation standalone (outside iterate mode):

```bash
aigon feature-validate 36
aigon feature-validate 36 --dry-run    # preview what would be checked
aigon feature-validate 36 --no-update  # evaluate without writing checkboxes
```

---

## Options

```bash
aigon feature-do <ID> --iterate [options]

--max-iterations=N    Max loop iterations (default: 5, or set in .aigon/config.json)
--agent=<id>          Which agent CLI to use: cc, gg, cx, cu (default: cc)
--dry-run             Show what would run without executing
```

Set project defaults in `.aigon/config.json`:

```json
{
  "iterate": {
    "validationCommand": "npm run build",
    "maxIterations": 4
  }
}
```

---

## Progress file

Iterate mode writes a progress log after each iteration:

```
docs/specs/features/logs/feature-36-ralph-progress.md
```

Each entry records: iteration number, status, agent, validation result, criteria pass/fail, files changed, and commits made. If iterate mode is interrupted (`Ctrl+C`), re-running the same command **resumes from where it left off** using this file.

---

## Best practices

### Write specs that describe outcomes, not implementations

```markdown
# Bad — tells the agent exactly what to do
Add a `visibleCount` const that equals `filteredLocations.length`.
Render it in a `<span data-testid="spot-count">`.

# Good — describes the outcome, lets the agent decide how
A count badge with `data-testid="spot-count"` shows the total number
of visible spots when any filter is active.
```

The second spec leaves implementation decisions to the agent. Tests catch wrong decisions. That's what drives useful iterations.

### Use `data-testid` attributes in tests

The most reliable way to force a second iteration: reference a `data-testid` in your Playwright test that the agent is likely to forget. The test fails, the agent sees the error, adds the attribute in iteration 2.

### Keep feature-level validation targeted

The `## Validation` section should test **this feature only** — not the whole app. Use `npx playwright test tests/feature-36.spec.ts` not `npm test`. Fast, targeted, clear failure messages.

### Pre-start the dev server for Playwright

If your Playwright config has `webServer` with `reuseExistingServer: true`, start the dev server before running iterate mode:

```bash
# Terminal 1
npm run dev

# Terminal 2
aigon feature-do 36 --iterate
```

Each validation reuses the running server instead of cold-starting it — much faster.

### Use `--dry-run` to preview

Before running iterate mode for real, check what would execute:

```bash
aigon feature-do 36 --iterate --dry-run
```

Shows the full prompt, validation commands, and criteria list without touching the codebase.

---

## Example project setup

`.aigon/config.json` for a Next.js project:

```json
{
  "profile": "web",
  "iterate": {
    "validationCommand": "npm run build",
    "maxIterations": 4
  }
}
```

Feature spec `## Validation` section:

```bash
npx playwright test tests/feature-36-spot-count.spec.ts --project=chromium
```

Feature spec `## Acceptance Criteria`:

```markdown
- [ ] A count badge with `data-testid="spot-count"` is visible when any filter is active
- [ ] Badge text uses correct singular/plural: "1 spot" vs "2 spots"
- [ ] Badge is hidden when all filters are at their defaults
- [ ] Badge updates immediately as filters change
```

Run:

```bash
aigon feature-do 36 --iterate --max-iterations=4
```

Expected: 2–3 iterations. Iteration 1 typically fails on missing `data-testid` or wrong test selector. Iteration 2 fixes it. Iteration 3 (if needed) cleans up edge cases.

## History

Iterate mode was originally called "Ralph mode" and then "autonomous mode", named after the
[Ralph pattern by Geoffrey Huntley](https://ghuntley.com/ralph/) and
[similar implementations](https://github.com/minicodemonkey/chief)
that treat iterative agent loops as the primary development loop. The flag was renamed
to `--iterate` on 2026-04-07 to disambiguate it from `feature-autonomous-start` (the
unattended multi-step orchestrator).
