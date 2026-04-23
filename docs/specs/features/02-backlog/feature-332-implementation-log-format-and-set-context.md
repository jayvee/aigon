---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T23:19:19.646Z", actor: "cli/feature-prioritise" }
---

# Feature: Implementation Log Format and Set Context

## Summary

Implementation logs are currently reduced to "max 10 lines, 3-5 bullets on non-obvious issues," and the `feature-do` pipeline injects zero context about sibling features when implementing a feature that is part of a set. Both gaps degrade LLM performance: under-structured logs leave subsequent agents without the decisions, API surfaces, and gotchas they need; missing set context means feature 3 of 5 has no awareness of what features 1 and 2 established. A third problem compounds both: a step-numbering contradiction in `feature-do.md` places the log-writing step before `agent-status submitted` in the template but labels it "do this AFTER submit" — and in autonomous/set mode the conductor reacts to `submitted` immediately and can kill the implementing session before the agent writes anything, which explains why many set-autonomous logs are completely empty.

This feature fixes all three: replaces the log template with a research-backed structure (7 sections, ~400–700 words), updates `feature-do` to inject sibling context for set members, and fixes the log step ordering so the log is written before signalling completion (eliminating the autonomous race condition).

Research basis: "Lost in the Middle" (primacy/recency bias), Chroma context-rot findings (distractors degrade performance even when information is present elsewhere), Anthropic sub-agent summary guidance (1K–2K tokens), ADR context window research (3–5 prior decisions is the sweet spot), Spotify background-agent context engineering (concrete examples > prose, out-of-scope boundaries matter as much as in-scope).

## User Stories

- [ ] As an agent implementing feature 4 of a 5-feature set, I am told (in the feature-do instructions) to read the implementation logs of completed siblings and the source research before coding, so I build on established patterns rather than re-inventing or contradicting them.
- [ ] As an agent writing an implementation log, I have clear section headings and a word-count target so the log is dense with signal (decisions, new API surfaces, gotchas, integration notes) rather than narrative prose or a restatement of the spec.
- [ ] As a developer reviewing a completed feature, the log tells me what decisions were made and why, what new modules were introduced, what was explicitly deferred, and what the next feature in the set must respect — without reading the diff.
- [ ] As a set-autonomous run, the implementing agent writes its log before calling `aigon agent-status submitted`, so the conductor never races the log step.

## Acceptance Criteria

- [ ] `FULL_LOGGING` in `lib/profile-placeholders.js` is replaced with a 7-section template (see Technical Approach). The word-count guidance in the template targets 400–700 words / ~600–1,000 tokens.
- [ ] `FLEET_LOGGING` is updated to the same 7-section structure with a tighter target (200–400 words), since fleet logs are read by the evaluator who already has full code diffs.
- [ ] `MINIMAL_LOGGING` retains its current "one line or skip" behavior — unchanged.
- [ ] `templates/generic/commands/feature-do.md` gains a new conditional `{{SET_CONTEXT_SECTION}}` block inserted between Step 2 (read spec) and Step 3 (implement). For a spec with `set: <slug>`, the rendered command includes a **Step 2.5: Set context** section that instructs the agent to: (a) read completed sibling implementation logs listed via `aigon set <slug>`, (b) read the specs of `depends_on` predecessors, and (c) read the research source named in `## Related`. For a spec without `set:`, the rendered command contains no Step 2.5 block and no orphan blank line.
- [ ] The `feature-do` CLI instruction mode in `lib/feature-do.js` detects a `set:` tag in the current spec, resolves set members via `getSetMembersSorted(slug)`, filters to completed members, and prints each sibling's padded ID and resolved log path before the implementation instructions. If no completed siblings exist, it prints no sibling-log list.
- [ ] `templates/specs/feature-template.md` `## Related` section comment is updated to make the `Research:` field and prior-set-feature pointers explicit (not just a free-text comment).
- [ ] `{{LOGGING_SECTION}}` in `templates/generic/commands/feature-do.md` is positioned before `## Step 5: Signal completion`, and the section headers in `FULL_LOGGING`, `FLEET_LOGGING`, and `MINIMAL_LOGGING` all say the log must be written before calling `aigon agent-status submitted`. The step label is `Step 4.5` or `Step 5` if needed to keep the command order internally consistent, but the rendered instructions must not place log writing after submission.
- [ ] The log starter skeleton written by `lib/commands/feature.js` (`init_log` effect at line ~42, template string at line ~51) and `lib/worktree.js` (line ~1582) is updated to match the new 7-section structure so the agent sees the correct headings when it opens the file.
- [ ] A grep sweep of `templates/` and `docs/` for `"Step 6"` and `"AFTER submit"` leaves no stale guidance for the old ordering, including `COMMAND_INSTALL_LOGGING_GUIDE` in `lib/profile-placeholders.js`.
- [ ] `SET_CONTEXT_SECTION` is resolved in both `feature-do` entry paths: launch mode (before the command body is rendered into the spawned session) and instruction mode (when the already-running agent re-reads the command). Both paths use the same set-slug detection rule, and standalone specs render an empty placeholder with no visible gap.
- [ ] For a set-tagged feature, the generated implementation log contains a non-empty `## For the Next Feature in This Set` section — this is the handoff the next sibling reads. Verified by a unit/integration test or by running `feature-do` against a fixture set-tagged spec.
- [ ] Regression coverage is added for: (a) rendering `feature-do` with and without `set:` frontmatter, and (b) the log starter skeleton written by both bootstrap paths. `node -c aigon-cli.js` and `npm test` pass.

## Validation

```bash
node -c aigon-cli.js
node -c lib/feature-do.js
node -c lib/profile-placeholders.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` if this feature touches only `lib/`, `templates/`, and no dashboard assets.

## Technical Approach

### New `FULL_LOGGING` section structure

Replace the current prose block with this 7-section skeleton (sections in this priority order — primacy/recency bias means most critical goes first and last):

```
## Status
One sentence: what is shipped, what is blocked, what remains. Include numbers where relevant ("all 4 acceptance criteria met", "auth tests pass, payment tests deferred").

## New API Surface
Bullet per new public export or module:
- `lib/foo.js` → `doThing(id: string): Promise<Result>` — brief purpose
- Config key added: `foo_enabled` (default: false)
Omit internal helpers; include only what callers must know.

## Key Decisions
Bullet per decision: what was chosen, why, and — critically — what was rejected and why not.
Target: 3–5 bullets. Do not restate the spec.

## Gotchas / Known Issues
Bullet per issue: symptom → cause → resolution or current state (fixed / deferred / workaround).
Omit if none. Do not pad.

## Explicitly Deferred
What was intentionally NOT done. One line per item. Close the door so the next agent doesn't reopen it.

## For the Next Feature in This Set
What the next set member must call, respect, or avoid. Pointer-level only — file name + function name, not prose.
Omit if this is a standalone feature (no `set:` tag).

## Test Coverage
What tests exist and pass. What is still missing or skipped. One line each.
```

**Length target:** 400–700 words (FULL), 200–400 words (FLEET). Exclude: diffs, full file contents, style rules, narrative prose restating what the code shows, historical background.

### `feature-do.md` Step 2.5

Insert between Step 2 (read spec) and Step 3 (implement). The section is conditional — rendered whenever the spec's frontmatter contains a `set:` key:

> **Step 2.5 — Set context (this feature is part of set `<slug>`)**
>
> Before coding, read these in order:
> 1. The implementation logs of completed siblings — run `aigon set <slug>` to list them, then read each log at `docs/specs/features/logs/feature-<N>-*-log.md`. Focus on `## Key Decisions`, `## New API Surface`, and `## For the Next Feature in This Set`.
> 2. The specs of your `depends_on` predecessors (listed in this spec's Dependencies section). These define the contracts you must honour.
> 3. The research source named in `## Related` (if present).
>
> Do not restate what you read. Use it to inform your approach and avoid re-opening closed decisions.

The template uses `{{SET_CONTEXT_SECTION}}` placeholder (empty string when no `set:` tag); `feature-do.md` already uses the placeholder pattern.

### `lib/feature-do.js` instruction mode

In the instruction-mode branch (already-inside-agent-session), after printing the spec:
1. Parse `set:` from the spec frontmatter using the existing `readSetTag()` from `lib/feature-sets.js`.
2. If a set slug is found, call `getSetMembersSorted(slug)`, filter to `stage === 'done'`, and print each member's padded ID and resolved log path (glob `docs/specs/features/logs/feature-<N>-*-log.md`).
3. Print: "Read the logs above (focus on Key Decisions, New API Surface, For the Next Feature) before starting."

### `feature-template.md` `## Related` section

Change the comment from a free-text note to an explicit structure:

```markdown
## Related
- Research: <!-- ID and title of the research topic that spawned this feature, if any -->
- Set: <!-- set slug if this feature is part of a set -->
- Prior features in set: <!-- feature IDs that precede this one, e.g. F314, F315 -->
```

### Placement of `SET_CONTEXT_SECTION` placeholder

The placeholder must be supplied by `feature-do.js`, not by new spec-reading inside `lib/profile-placeholders.js`. `getProfilePlaceholders()` should stay a pure shared-placeholder builder; `feature-do.js` already owns current-spec lookup and should pass `SET_CONTEXT_SECTION` through the existing placeholder merge in both launch mode and instruction mode. When the current spec has a `set:` tag, the placeholder expands to the Step 2.5 block above with the slug interpolated. When absent, it expands to an empty string, and the existing blank-line collapse in `processTemplate` removes the gap cleanly.

### Log step ordering fix

**Root cause:** `{{LOGGING_SECTION}}` currently appears before `## Step 5: Signal completion`, but `FULL_LOGGING` and `FLEET_LOGGING` instruct the agent to write the log after submitting. In autonomous mode `feature-autonomous.js` reacts to `submitted` immediately (`implAgentReadyForAutonomousClose` returns true on `submitted`) and with `stop-after=implement` calls `stopAutoSession`, which can kill the tmux session before the agent writes anything.

**Fix:** Keep the logging block before the submit step, and change the wording so template order and instruction text agree: the agent must write the log first, then call `aigon agent-status submitted`. Renumber the logging step as needed so the visible sequence remains monotonic, and update the section headers in `FULL_LOGGING`, `FLEET_LOGGING`, and `MINIMAL_LOGGING` to remove every "after submit" instruction. `MINIMAL_LOGGING` still keeps its one-line-or-skip body. Before implementing, grep `templates/` and `docs/` for `"Step 6"` and `"AFTER submit"` to catch orphan references, including `COMMAND_INSTALL_LOGGING_GUIDE` in `lib/profile-placeholders.js`.

**Log starter skeleton:** The `init_log` effect in `lib/commands/feature.js` (handler at line ~42, template string at line ~51) and the worktree bootstrap in `lib/worktree.js:1582` both write the old `## Plan / ## Progress / ## Decisions` skeleton. Update both to the 7-section structure so agents see the right headings without having to remember the format.

## Dependencies

- No feature dependencies. All touched files are in `lib/`, `templates/`, and `docs/specs/features/01-inbox/`.

## Out of Scope

- A separate architecture decision record (ADR) file — decisions stay embedded in feature logs.
- A memory system (mem0 or similar) for cross-feature retrieval — log quality is the approach.
- Changing `MINIMAL_LOGGING` behavior beyond the step label and "write before submit" wording — it stays at "one line or skip."
- Changes to the autonomous conductor poll logic — the fix is purely in the template step order and log section label, not in `feature-autonomous.js`.
- Dashboard changes — this is log format and template only.
- Auto-generating or summarizing logs from git history — the agent writes them.
- A cumulative "interface map" document for the set — the `## For the Next Feature` section in each log covers this without a new artifact.

## Open Questions

- None. The placeholder should be injected dynamically by `feature-do.js` at runtime so the slug comes from the current spec without adding spec I/O to shared placeholder resolution.

## Related

- Research: deep research on LLM context quality for implementation logs (conducted 2026-04-24, findings embedded in this spec)
- Prior art: `FULL_LOGGING` / `FLEET_LOGGING` constants in `lib/profile-placeholders.js`; feature-do instruction mode in `lib/feature-do.js`; `templates/generic/commands/feature-do.md`
