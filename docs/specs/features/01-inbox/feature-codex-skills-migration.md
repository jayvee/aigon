# Feature: codex-skills-migration

## Summary

OpenAI is deprecating custom prompts in Codex (`~/.codex/prompts/`) and replacing
them with **Skills** (`SKILL.md` files under `.agents/skills/`). A startup
deprecation warning landed in Codex 0.117.0; full removal is planned. Aigon's
`install-agent cx` still writes the deprecated `~/.codex/prompts/aigon-*.md`
prompt files. This feature migrates Codex installation to emit Skills instead,
removes all references to the deprecated prompt directory, and updates the
agent metadata, install reporting, **internal repo docs (`CLAUDE.md`,
`AGENTS.md`, `docs/architecture.md`, `docs/agents/codex.md`), AND the
user-facing docs site (`site/content/**.mdx`)** accordingly. **Docs updates
are not optional follow-up — they ship in the same PR as the code.** The
`agent-prompt-resolver.js` inline-prompt path (which is what actually drives
aigon-launched Codex sessions) is preserved as-is — it already does not depend
on slash-command discovery.

## User Stories

- [ ] As a Codex user, when I run `aigon install-agent cx`, aigon writes Skills under `.agents/skills/aigon-*/SKILL.md` rather than deprecated prompt files in `~/.codex/prompts/`.
- [ ] As a Codex user, I can invoke any aigon workflow inside Codex via `$aigon-feature-do`-style skill mentions (or implicit invocation), with no startup deprecation warnings.
- [ ] As a Codex user upgrading from a previous aigon version, `aigon install-agent cx` cleans up the old `~/.codex/prompts/aigon-*.md` files automatically.
- [ ] As an aigon maintainer, I have one source of truth (`templates/generic/commands/*.md`) feeding both the inline launch path and the installed Skills, so we don't drift.

## Acceptance Criteria

- [ ] `templates/agents/cx.json` updated: `output.commandDir` → `.agents/skills` (project-local, not global), `output.global` → `false`, file layout produces one directory per command containing a `SKILL.md` file (not a flat `aigon-*.md` file).
- [ ] `templates/agents/cx.json` `placeholders.CMD_PREFIX` updated from `/prompts:aigon-` to the skill invocation form (`$aigon-` mention) so any rendered help text reflects reality.
- [ ] `lib/commands/setup.js` install loop supports the per-skill directory layout for cx (one folder per command, `SKILL.md` inside) without regressing other agents that use a flat `<prefix><cmd><ext>` file.
- [ ] Each generated `SKILL.md` has correct YAML frontmatter (`name:`, `description:`) derived from the existing template `<!-- description: ... -->` marker; body is the processed template body with `$ARGUMENTS` / `$1` substitution preserved for codex's runtime args.
- [ ] `install-agent cx` cleans up legacy `~/.codex/prompts/aigon-*.md` files (and any aigon-installed alias prompts) on first post-upgrade run, with a one-line console report of what was removed.
- [ ] `install-agent cx` no longer prints `⚠️  Note: Codex prompts are global (shared across all projects)` — replaced with a skill-scoped install message pointing at `.agents/skills/`.
- [ ] `aigon doctor` reports the installed Skills location for cx, not `~/.codex/prompts/`.
- [ ] `lib/agent-prompt-resolver.js` continues to work unchanged for the in-process inline launch path; comments updated to remove the "deprecation pending" framing now that the migration is complete.
- [ ] **Internal repo docs** updated in the same PR:
  - [ ] `CLAUDE.md` Install Architecture section: cx outputs change from `~/.codex/prompts/aigon-*.md` to `.agents/skills/aigon-*/SKILL.md`.
  - [ ] `AGENTS.md` (if it duplicates any of the above).
  - [ ] `docs/architecture.md` § Install Architecture mirrors the same change.
  - [ ] `docs/agents/codex.md` install-marker block updated with the new layout and invocation syntax (`$aigon-feature-do <id>` instead of `/prompts:aigon-feature-do <id>`).
- [ ] **User-facing docs site (`site/content/**.mdx`)** updated in the same PR. Affected files identified by grep: `getting-started.mdx`, `concepts/execution-modes.mdx`, `concepts/evaluation.mdx`, `reference/configuration.mdx`, `reference/file-structure.mdx`, `reference/agents.mdx`, `reference/commands/feature/feature-do.mdx`, `reference/commands/infra/dev-server.mdx`, `guides/telemetry.mdx`, `guides/research-workflow.mdx`, `guides/fleet-mode.mdx`, `comparisons.mdx`. Each one must be reviewed and any reference to `~/.codex/prompts/`, `/prompts:aigon-...`, or "Codex prompts are global" replaced with the skills equivalent.
- [ ] Docs-site screenshot taken (Playwright) of any page that materially changed for Codex setup, to confirm rendering didn't break.
- [ ] No grep hits for `~/.codex/prompts`, `.codex/prompts`, or `/prompts:aigon` remain in `lib/`, `templates/`, `docs/`, or `site/content/` except inside an explicit "removed in vX.Y" historical note.
- [ ] `node -c` passes for any edited `lib/*.js`; `npm test` passes; `aigon install-agent cx` followed by `aigon doctor` runs clean on a fresh test repo.
- [ ] Manual smoke: in a Codex CLI session inside a freshly-installed repo, no deprecation banner appears, `$aigon-feature-do <id>` resolves and runs.

## Validation

```bash
node -c lib/commands/setup.js
node -c lib/agent-prompt-resolver.js
npm test
```

## Technical Approach

**Why this works without breaking aigon-launched Codex sessions.** Aigon
already inlines the prompt body at launch time via
`lib/agent-prompt-resolver.js` → `resolveCxPromptBody()`. That path reads
`templates/generic/commands/feature-<verb>.md` directly and hands the body to
codex as the initial positional argument — it never goes through
`~/.codex/prompts/`. So this migration is purely about (a) what
`install-agent cx` writes to disk for *interactive* user-typed invocations and
(b) cleaning up the deprecated artifacts.

**Codex Skill format (per developers.openai.com/codex/skills).**
A skill is a directory containing a required `SKILL.md`:

```
.agents/skills/aigon-feature-do/
└── SKILL.md
```

`SKILL.md` requires YAML frontmatter:

```yaml
---
name: aigon-feature-do
description: Drive a feature implementation through the aigon workflow
---

<body — same as the existing template body, with $ARGUMENTS preserved>
```

Discovery scopes (priority order): `./.agents/skills`, `../.agents/skills`,
`$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills`,
bundled. We install to **repo-root `.agents/skills/`** (project-scoped), which
matches every other agent's pattern (cc/gg/cu all install project-locally).
Going project-scoped also fixes the long-standing complaint flagged in
`templates/agents/cx.json` and the install banner that "Codex prompts are
global". Users can still drop their own skills into `~/.agents/skills/` if
they want cross-project versions.

**Invocation.** Skills are invoked explicitly via `/skills` or by `$skill-name`
mention; Codex can also implicitly invoke based on the `description:` field.
Existing alias-shortcut behavior (`afd`, `afs` etc.) does not apply to Codex
because those are slash-command shortcuts in cc/gg/cu; for Codex the user
types `$aigon-feature-do 218` (or just describes intent and lets implicit
selection fire). We do **not** generate alias skills — they would pollute the
implicit-invocation namespace.

**`templates/agents/cx.json` changes.**

```jsonc
{
  "placeholders": {
    "CMD_PREFIX": "$aigon-"
  },
  "output": {
    "format": "skill-md",          // new format key, see setup.js change
    "commandDir": ".agents/skills",
    "commandFilePrefix": "aigon-", // becomes the skill *directory* prefix
    "commandFileExtension": "",     // not used in skill layout
    "skillFileName": "SKILL.md",
    "frontmatter": ["name", "description"],
    "global": false
  },
  "extras": {
    "prompt": { "enabled": false },  // .codex/prompt.md no longer needed
    "config": { "enabled": true, "path": ".codex/config.toml" }
  }
}
```

`legacy.promptFile` retained as a hint to the cleanup routine; the cleanup
routine deletes it on next install.

**`lib/commands/setup.js` changes.**

The current install loop assumes a flat layout: one file per command at
`<cmdDir>/<prefix><cmd><ext>`. For Codex we need one *directory* per command
containing a `SKILL.md`. Add a branch on `config.output.format === 'skill-md'`
in the existing per-command loop:

```js
if (config.output.format === 'skill-md') {
    const skillDirName = `${config.output.commandFilePrefix}${cmdName}`;
    const skillDir = path.join(cmdDir, skillDirName);
    const skillBody = stripDescriptionComment(genericContent);
    const skillContent = renderSkillMd({
        name: skillDirName,
        description,
        body: skillBody,
    });
    safeWriteWithStatus(path.join(skillDir, config.output.skillFileName), skillContent);
} else {
    // existing flat-file path (cc/gg/cu/mv) unchanged
}
```

`renderSkillMd()` is a small local helper (no need for a new module — single
caller, ~10 lines): emit the YAML frontmatter, blank line, body. No alias
generation for skill-md format.

`removeDeprecatedCommands()` and the alias-cleanup block need a parallel
implementation for the directory layout — walk `.agents/skills/`, drop any
`aigon-*` directory whose name is not in the current command set.

**Cleanup of legacy `~/.codex/prompts/aigon-*.md`.** Add a new step at the
top of the cx install path: if `~/.codex/prompts/` exists, glob
`aigon-*.md` and unlink. Print a single line:
`🧹 Removed N deprecated Codex prompt file(s) from ~/.codex/prompts/`. Idempotent.

**`lib/agent-prompt-resolver.js`.** Update the docstring to remove
"deprecation pending" framing — the migration *is* the deprecation. Keep the
inline behavior. The `~/.codex/prompts/` reference in the comment becomes a
historical "this is why we inline" note.

**Doc updates (mandatory, same PR — not follow-up).**

*Internal repo docs:*
- `CLAUDE.md` § Install Architecture: change the `**cx**` line.
- `AGENTS.md`: grep and update if any duplicate content references the old path.
- `docs/architecture.md` § Install Architecture: same.
- `docs/agents/codex.md`: replace install-marker block with new skill layout
  and invocation example (`$aigon-feature-do <id>`).
- `docs/development_workflow.md`: only if it shows codex slash-command syntax
  anywhere (grep first).

*User-facing docs site (`site/content/`)* — these ship to aigon.build and are
the first thing new Codex users read. **All twelve files identified by grep
above must be reviewed.** Likely changes per file:
- `getting-started.mdx` — Codex install + first-run section
- `concepts/execution-modes.mdx`, `concepts/evaluation.mdx` — any examples
  using `/prompts:aigon-*`
- `reference/agents.mdx`, `reference/configuration.mdx`,
  `reference/file-structure.mdx` — Codex paths and config
- `reference/commands/feature/feature-do.mdx`,
  `reference/commands/infra/dev-server.mdx` — invocation examples
- `guides/telemetry.mdx`, `guides/research-workflow.mdx`,
  `guides/fleet-mode.mdx` — any Codex-specific notes
- `comparisons.mdx` — Codex-vs-other-agent table

Take a Playwright screenshot of at least the Codex section of
`getting-started.mdx` after editing — per CLAUDE.md rule #3.

**Source-of-truth.** `templates/generic/commands/*.md` remains the canonical
template for both the install path and the inline launch path. No template
content changes — only the wrapping format is different.

## Dependencies
- Codex CLI ≥ 0.117 installed for manual smoke testing (skill discovery is
  only available on recent versions).

## Out of Scope
- **No changes to cc/gg/cu/mv install paths.** Their slash-command output is
  not deprecated and stays exactly as-is.
- **No changes to `agent-prompt-resolver.js` resolution logic.** Only the
  docstring is touched. The inline launch path is what actually drives
  aigon-spawned Codex sessions and continues to work regardless of skill
  discovery.
- **No changes to `templates/generic/commands/*.md` body content.** This is
  a packaging change, not a content change.
- **No alias-skill generation.** We don't ship `$afd`, `$afs`, etc. as skills.
  Aliases are a slash-command-shortcut idea; the Codex equivalent is the
  description-driven implicit invocation.
- **No support for installing skills to `~/.agents/skills/` (user scope).**
  All agents currently install project-local; we keep that consistent.
- **No migration of `.codex/prompt.md` content into a skill.** That file is a
  static project context document, not a workflow command — it's removed via
  `extras.prompt.enabled = false` and not replaced.

## Open Questions
- Does Codex's implicit invocation pick aigon skills too eagerly given the
  generic descriptions? May need to tune `description:` text — defer until
  manual smoke shows a problem, or set `policy.allow_implicit_invocation:
  false` via `agents/openai.yaml` per skill if it's noisy.
- Codex docs mention `$skill-installer` and bundled skills like
  `$skill-creator` — confirm there's no name collision with our `aigon-*`
  prefix (very unlikely but worth grepping during smoke).
- Should `aigon doctor` actively warn when it sees stale `~/.codex/prompts/aigon-*.md`
  files (e.g., user copied an old install)? Probably yes — small addition.

## Related
- Research:
- Upstream: https://developers.openai.com/codex/skills
- Upstream: https://developers.openai.com/codex/changelog (0.117.0 deprecation warning, removal in PR #15851)
- Upstream issue: openai/codex#15941 (`~/.codex/prompts/` discovery broken — original reason we inlined)
- Code: `lib/agent-prompt-resolver.js`, `lib/commands/setup.js` (install loop ~L758-852), `templates/agents/cx.json`
