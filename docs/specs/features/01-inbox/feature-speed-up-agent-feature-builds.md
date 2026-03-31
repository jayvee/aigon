# Feature: Speed Up Agent Feature Builds

## Summary

Agent feature builds take 15-45 minutes when they should take 5-10. The problem isn't compute — it's context engineering. Agents spend most of their time: (1) reading files they don't need, (2) planning when they should be coding, (3) running tests nobody asked for, (4) creating tasks/tracking overhead, and (5) waiting for permission prompts. This feature optimises the `feature-do` template and agent configuration to eliminate wasted time and get agents to code immediately.

## Observed Time Waste (from today's sessions)

| Waste | Time burned | Root cause |
|-------|-------------|------------|
| Extended planning / "Newspapering" | 10-20 min | Template says "plan your approach" before coding |
| Running full test suites | 5-15 min | Template has test steps; agent interprets as mandatory |
| Reading every file in lib/ | 5-10 min | No guidance on which files matter; agent explores broadly |
| Creating detailed task lists | 3-5 min | Template says "create a task for each acceptance criterion" |
| Waiting at idle prompts | 5-15 min | Agent finishes thinking but doesn't auto-continue |
| Permission prompts for bash/edit | 2-5 min | Bypass not always enabled in worktree settings |

## User Stories

- [ ] As a user, I want agents to start writing code within 60 seconds of feature-do
- [ ] As a user, I want a feature build to complete in under 10 minutes for a typical spec
- [ ] As a user, I want agents to stop running tests unless the spec explicitly requires it

## Acceptance Criteria

### Template changes (`feature-do.md`)
- [ ] Remove "create a task for each acceptance criterion" — replace with "work through the acceptance criteria in order"
- [ ] Remove plan mode section entirely — the spec IS the plan, don't re-plan
- [ ] Add "start coding within 60 seconds" directive at the top of Step 3
- [ ] Add explicit "do NOT explore the codebase broadly — read only files listed in the spec's Technical Approach section"
- [ ] Add "do NOT create new test files unless the spec explicitly says to"
- [ ] Move validation/testing to AFTER commit, not before — validate, then fix if needed, don't block on green tests
- [ ] Remove Step 3.8/4.2/4.8 testing sections for repos with `instructions.testing: "skip"` (feature 180 already supports this — ensure aigon repo uses it)
- [ ] Add time budget: "Target: complete implementation in under 10 minutes. If you're still reading files after 2 minutes, start coding."

### Agent config changes
- [ ] Ensure worktree `.claude/settings.json` has full bypass permissions enabled by default
- [ ] `feature-do` template includes the spec's "Key files to modify" list inline so the agent doesn't need to search

### Context engineering in spec
- [ ] `feature-do` template passes the spec content directly to the agent instead of making the agent read it (saves a file read + processing step)
- [ ] The spec's Technical Approach section is treated as the implementation plan — no separate planning phase

### Aigon repo config
- [ ] Set `instructions.testing: "skip"` in aigon's `.aigon/config.json` so agents stop running tests during feature builds
- [ ] Verify `check-version` config-change detection triggers reinstall after this config change

## Validation

```bash
node -c aigon-cli.js
# Verify testing is skip for aigon
node -e "const c = require('./lib/config'); const p = c.loadProjectConfig(process.cwd()); console.log('testing:', p.instructions?.testing || 'full'); if (p.instructions?.testing !== 'skip') { process.exit(1); }"
```

## Technical Approach

### 1. Trim `feature-do.md` template

Remove:
- Plan mode section (`{{PLAN_MODE_SECTION}}`)
- "Create a task for each acceptance criterion" paragraph
- Testing write/run sections for skip mode (already conditional via placeholders)

Add at top of Step 3:
```
**TIME BUDGET: Complete implementation in under 10 minutes.**
- Start coding within 60 seconds. The spec IS your plan.
- Read ONLY the files listed in Technical Approach. Do not explore broadly.
- Do not create test files unless the spec explicitly requires them.
- Commit first, validate after. Fix issues in follow-up commits.
```

### 2. Set aigon repo testing config

```json
// .aigon/config.json
{
  "instructions": {
    "testing": "skip"
  }
}
```

Then run `aigon install-agent cc` to regenerate command files with skip-mode placeholders.

### 3. Inline spec content in feature-do

Currently the template tells the agent to run `aigon feature-spec <ID>` and read the file. Instead, have `feature-do` CLI command print the spec content directly to stdout so it's already in the agent's context. No extra file read needed.

### 4. Ensure bypass permissions

In `addWorktreePermissions()`, ensure the generated `.claude/settings.json` for worktrees includes:
```json
{
  "permissions": {
    "allow": ["Bash(*)", "Read(*)", "Write(*)", "Edit(*)"]
  }
}
```

### Key files to modify:
- `templates/generic/commands/feature-do.md` — trim template
- `.aigon/config.json` — set testing to skip
- `lib/commands/feature.js` — feature-do command prints spec inline
- `lib/worktree.js` — verify bypass permissions in worktree settings

## Dependencies

- depends_on: configurable-instruction-directives (180, done)

## Out of Scope

- Changing the agent model or provider (that's a cost decision, not a speed decision)
- Parallelising implementation within a single agent (agents are sequential by nature)
- Changing the workflow engine or close flow

## Related

- Feature 180: Configurable Instruction Directives (provides the testing skip mechanism)
- Feature 191: Simplify Feature-Close (reduces close overhead, separate concern)
