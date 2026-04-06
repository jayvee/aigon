# Implementation Log: Feature 224 - check-review-skill-command
Agent: cc

## Plan
Pure template + registry change. No new CLI verb, no engine work.

1. Create `templates/generic/commands/feature-review-check.md` with the implementer-side prompt that resolves the feature ID from the worktree branch, reads `fix(review)` / `docs(review)` commits + the `## Code Review` log section, and decides accept / challenge / modify.
2. Register the command in `lib/templates.js` `COMMAND_REGISTRY` with alias `afrc`.
3. Add `feature-review-check` to the `commands` array in every agent JSON (`cc`, `gg`, `cu`, `cx`).
4. Update `templates/generic/commands/help.md` (commands table + shortcuts table).
5. Update `templates/generic/commands/feature-review.md` Step 8 + prompt suggestion to point at `feature-review-check <ID>` (agent-neutral wording).

## Progress
- Wrote `feature-review-check.md` template with `<!-- description: ... -->` marker so the cx skill-md install path picks it up.
- Added registry entry: `'feature-review-check': { aliases: ['afrc'], argHints: '[ID]' }`.
- Added `feature-review-check` to all four agent command lists.
- Ran `node aigon-cli.js install-agent cc gg cu cx` and verified output:
  - `.claude/commands/aigon/feature-review-check.md` (markdown + frontmatter)
  - `.claude/commands/afrc.md` (alias)
  - `.gemini/commands/aigon/feature-review-check.toml`
  - `.cursor/commands/aigon-feature-review-check.md`
  - `.agents/skills/aigon-feature-review-check/SKILL.md` (codex skill with valid YAML frontmatter, name + description from the marker)
- `node -c aigon-cli.js`: ok
- `npm test`: 13/13 + 11/11 + landing test all green
- `scripts/check-test-budget.sh`: 1624 / 2000 LOC

## Decisions
- **No `mv` agent**: spec mentioned `mv` (mistral-vibe) but `templates/agents/` only contains `cc`, `gg`, `cu`, `cx`. Implemented for the four that exist; the template itself still references `mv` in the branch-parsing instruction so a future `mv` agent will work transparently.
- **Branch parsing in the prompt, not in `lib/git.js`**: per the spec's "no new CLI code" constraint, the resolution happens entirely inside the prompt body. The agent runs `git branch --show-current`, parses, then resolves via `aigon feature-list --active`. Keeps the diff to a single template file + registry one-liner.
- **`afrc` alias**: registered via `COMMAND_REGISTRY` so the existing `COMMAND_ALIAS_REVERSE` flow generates `.claude/commands/afrc.md`, `.gemini/commands/afrc.toml`, etc. for cc/gg/cu. Codex install path explicitly skips alias-skill generation (per feature 223), so `cx` users invoke the full `$aigon-feature-review-check` name — exactly the documented behaviour.
- **`feature-review.md` Step 8 wording**: kept agent-neutral ("Run `feature-review-check <ID>` in the implementer's session") so the same instruction reads correctly whether the implementer is running cc/gg/cu (slash command) or cx (skill).
- **No test added**: per Rule T2, pure template + config edits are explicitly exempt. Verified end-to-end by running `install-agent` for all four agents and inspecting the generated files.

## Manual Testing Checklist
1. From this worktree, run the cc install: `node aigon-cli.js install-agent cc`. Verify both `.claude/commands/aigon/feature-review-check.md` and `.claude/commands/afrc.md` exist.
2. In a Claude Code session inside this worktree, type `/afrc` (no args). Confirm Claude reads its own branch, infers the feature ID (224), looks for `fix(review)` commits, and reports the result without prompting for an ID.
3. Repeat #2 with `/aigon:feature-review-check 224` (explicit ID). Confirm it short-circuits branch inference.
4. cd to a non-feature directory (e.g. `~/`), run Claude, type `/afrc`. Confirm it prints the "can't infer feature ID" message and stops without guessing.
5. `node aigon-cli.js install-agent gg` → verify `.gemini/commands/aigon/feature-review-check.toml` and `.gemini/commands/afrc.toml` exist with valid TOML.
6. `node aigon-cli.js install-agent cu` → verify `.cursor/commands/aigon-feature-review-check.md` and `.cursor/commands/afrc.md` exist.
7. `node aigon-cli.js install-agent cx` → verify `.agents/skills/aigon-feature-review-check/SKILL.md` exists with valid YAML frontmatter (`name: aigon-feature-review-check`, `description:` populated from the template marker). Confirm there is **no** `aigon-afrc` skill directory.
8. Open `templates/generic/commands/feature-review.md` → confirm Step 8 mentions running `feature-review-check <ID>` in the implementer's session, and the prompt suggestion line at the bottom is `{{CMD_PREFIX}}feature-review-check <ID>`.
9. `node -c aigon-cli.js` and `npm test` both pass.
