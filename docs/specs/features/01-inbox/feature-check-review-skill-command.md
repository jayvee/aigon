# Feature: check-review-skill-command

## Summary

Add a prompting-shortcut (`feature-review-check`) that the **implementation agent** runs inside its own session after a reviewer finishes. It expands to a pre-written prompt telling the agent to read the reviewer's commits and log entry, then decide whether to **accept**, **challenge**, or **modify** the review. Ships as a single canonical template under `templates/generic/commands/` so the existing install pipeline produces the right artifact for every agent family:

- **cc / gg / cu / mv** → slash command (`/aigon:feature-review-check <id>`, shortcut `/afrc`)
- **cx (codex)** → skill (`$aigon-feature-review-check <id>`) once feature 223 (codex-skills-migration) lands

No new Aigon CLI verb, no state, no engine signals. One template file + registry entry and the install loop does the rest.

## User Stories
- [ ] As the user, I can type `/afrc` in a cc/gg/cu/mv implementation session instead of re-typing "check the changes made by the reviewer — details in the last commit and log" every time.
- [ ] As the user, I can type `$aigon-feature-review-check <id>` in a codex implementation session (post-223) to get the same behavior — no copy-paste from templates, no second terminal.
- [ ] As the implementing agent, the prompt gives me a clear, consistent instruction: read review commits, read review log entry, then decide accept/challenge/modify and act accordingly.
- [ ] As an aigon maintainer, I maintain one canonical template under `templates/generic/commands/` — the install pipeline handles the cc/gg/cu/mv vs cx (skill) format differences.

## Acceptance Criteria
- [ ] New template file `templates/generic/commands/feature-review-check.md` exists, containing the agent-facing prompt with a `<!-- description: ... -->` marker (so the cx skill-md install path in feature 223 can extract it into YAML frontmatter).
- [ ] The template instructs the agent to:
  1. Find the reviewer's commits: `git log --oneline --grep='^fix(review)\|^docs(review)' main..HEAD`
  2. Read the cumulative diff of those commits.
  3. Read the `## Code Review` section appended to `docs/specs/features/logs/feature-<ID>-*-log.md`.
  4. Decide one of: **accept** (no action), **challenge** (explain disagreement to the user and stop), **modify** (make follow-up commits with `fix(post-review):` prefix, then stop).
  5. Report the decision and a brief summary back to the user.
- [ ] Template registered in the command registry (`lib/templates.js` COMMAND_REGISTRY or equivalent) so `aigon install-agent <agent>` picks it up for every agent family.
- [ ] `aigon install-agent cc` regenerates `.claude/commands/aigon/feature-review-check.md` cleanly.
- [ ] `aigon install-agent gg` regenerates `.gemini/commands/aigon/feature-review-check.toml` cleanly.
- [ ] `aigon install-agent cu` regenerates `.cursor/commands/aigon-feature-review-check.md` cleanly.
- [ ] `aigon install-agent mv` produces the correct artifact for the mv install path.
- [ ] `aigon install-agent cx` (post-223) produces `.agents/skills/aigon-feature-review-check/SKILL.md` with valid YAML frontmatter (`name: aigon-feature-review-check`, `description:` from the template marker). **No separate cx-specific work required** — this is delivered by the generic install loop once 223 lands.
- [ ] Shortcut registered: `afrc` → `feature-review-check`, consistent with existing `afr`/`afc` naming. Added to `help.md` and the `templates/shortcuts.json` (or wherever shortcuts live). **Note**: per 223, codex does not use alias shortcuts (`afrc` is a slash-command shortcut for cc/gg/cu/mv only); codex users invoke the full skill name `$aigon-feature-review-check <id>` or rely on implicit description-driven invocation.
- [ ] `feature-review.md` Step 8 updated so the reviewing agent's "next command" suggestion points the user at `feature-review-check <ID>` for the implementer — using neutral wording that works for both slash-command and skill invocation (keeping `feature-close` as the final step after the implementer decides).
- [ ] `node -c aigon-cli.js` passes; existing tests pass.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach

**This is a prompt template, not code.** The feature ships as a single markdown template under `templates/generic/commands/` plus registry/help updates. No handler in `lib/commands/feature.js`, no new CLI verb, no engine integration. The cross-agent story is delivered entirely by the existing install pipeline:

- **cc/gg/cu/mv** — the standard flat-file slash-command install path generates the working copy today.
- **cx** — the new skill-md install path introduced by feature 223 (codex-skills-migration) reads the same canonical template and emits `.agents/skills/aigon-feature-review-check/SKILL.md` with YAML frontmatter derived from the template's `<!-- description: ... -->` marker. **We depend on 223 for the codex path to work — we do not reimplement any of that logic here.**

**Files touched:**
1. `templates/generic/commands/feature-review-check.md` — **new**. The full agent-facing prompt. Uses existing `{{ARG1_SYNTAX}}` / `{{CMD_PREFIX}}` placeholders the install pipeline already handles. Includes the `<!-- description: ... -->` marker so cx skill-md packaging works automatically.
2. `lib/templates.js` (COMMAND_REGISTRY) or `lib/constants.js` — **one-line addition** registering the new template so `install-agent` picks it up for every agent family.
3. `templates/generic/commands/help.md` — add `afrc` to the shortcut list (with a note that codex invokes it via `$aigon-feature-review-check` since codex skills don't use shortcut aliases).
4. Any shortcut definition file consumed by `install-agent` for cc/gg/cu/mv — add `afrc` entry (mirrors how `afr` is defined). **Do not** add a codex alias entry per 223's "no alias-skill generation" rule.
5. `templates/generic/commands/feature-review.md` — update Step 8 prompt suggestion so the reviewing agent, on completion, tells the user to run `feature-review-check <ID>` in the implementer's session before `feature-close`. Wording must be agent-neutral (e.g., "Run `feature-review-check <ID>` in the implementer's session" rather than "Run `/aigon:feature-review-check`") so it reads correctly whether the implementer is cc, gg, cu, mv, or cx.

**Template content outline** (for the spec, not final prose):

```markdown
<!-- description: Check the review just done on feature <ID> and decide accept/challenge/modify -->
# aigon-feature-review-check

A reviewing agent has just committed fixes (or notes) on this feature branch.
Your job is to check what the reviewer did, then decide how to respond.

## Step 1: Find the review commits
Run: `git log --oneline --grep='^fix(review)\|^docs(review)' main..HEAD`

## Step 2: Read the diff
For each review commit, run `git show <sha>` and understand the change.

## Step 3: Read the review notes
Open `docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md` and read the
`## Code Review` section.

## Step 4: Decide
Pick ONE:
- **Accept** — the review is correct. Do nothing. Tell the user "Review accepted."
- **Challenge** — you disagree with one or more fixes. STOP, explain your
  reasoning to the user, and wait for their decision. Do NOT revert commits.
- **Modify** — the review is mostly right but needs follow-up changes. Make
  minimal edits, commit with `fix(post-review): ...`, then tell the user.

## Step 5: Report
Tell the user:
- Which option you chose
- One-line summary per review commit
- Any open questions

Do NOT run `feature-close`. The user decides when to close.
```

**Why this is a command, not a Claude skill:** skills are Claude-Code-only and heavyweight. Slash commands install into every agent family via the existing pipeline and are the right tool for lightweight prompting shortcuts like this one. This matches the pattern of every other `feature-*` command in `templates/generic/commands/`.

## Dependencies
- **depends_on: codex-skills-migration** (feature 223). The codex-path acceptance criterion ("`install-agent cx` produces `.agents/skills/aigon-feature-review-check/SKILL.md`") cannot be satisfied until 223's skill-md install path lands. The cc/gg/cu/mv paths work without 223, but per Aigon's dependency-ordering rule this feature should not start until 223 is done so we ship all agent families in one go.

## Out of Scope
- Any new `aigon` CLI verb or `lib/commands/feature.js` handler.
- Any workflow-engine signal (e.g., "review-acknowledged") — this is purely a prompting shortcut.
- A Claude skill version — slash command is sufficient and cross-agent.
- Automatic accept/reject logic — the agent decides, the user confirms.
- Dashboard UI changes.

## Open Questions
- Should the template instruct the agent to run `git log main..HEAD` unfiltered (to also see its own pre-review commits for context)? Leaning **yes** — one extra line, useful context.
- Should `--modify` follow-up commits use `fix(post-review):` or just `fix:`? Leaning `fix(post-review):` to keep the audit trail clear alongside `fix(review):`.
- Is `afrc` the right shortcut? `afr` is already `feature-review`; `afrc` reads as "feature-review-check". Alternative: `afrk` (feature-review-check-k? no). Sticking with `afrc`.

## Related
- Research:
- Related command: `feature-review` (this command is the implementer-side counterpart to the reviewer-side `feature-review`)
- Related feedback: "Never break the solo worktree review flow" — this feature extends that flow without mutating it
