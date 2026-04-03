# Feature: standardise tmux session naming with explicit role prefix

## Summary

tmux session naming is currently inconsistent. Eval and review sessions carry an explicit role string (`eval`, `review-{agent}`), but standard implementation sessions are just `{repo}-f{id}-{agent}` — the role is implicit and ambiguous. Looking at `tmux ls` you cannot tell what a session is doing. This feature introduces a uniform `{repo}-{type}{id}-{role}-{agent}(-desc)` pattern across all session types, with an explicit allowlist of roles: `do`, `eval`, `review`, `auto`. The `auto` role is reserved for the upcoming autonomous orchestrator session (feature-automation-profiles) and is defined here but not yet used. This is a prerequisite for that feature.

## Current naming (inconsistent)

| Session type | Current pattern | Example |
|---|---|---|
| Implementation | `{repo}-f{id}-{agent}(-desc)` | `aigon-f212-cc-fix-autopilot` |
| Eval (feature) | `{repo}-f{id}-eval(-desc)` | `aigon-f212-eval-fix-autopilot` |
| Eval (research) | `{repo}-r{id}-eval-{agent}(-desc)` | `aigon-r31-eval-gg-my-topic` |
| Review | `{repo}-f{id}-review-{agent}(-desc)` | `aigon-f212-review-cc-fix-autopilot` |

## Target naming (consistent)

| Session type | New pattern | Example |
|---|---|---|
| Implementation | `{repo}-f{id}-do-{agent}(-desc)` | `aigon-f212-do-cc-fix-autopilot` |
| Eval (feature) | `{repo}-f{id}-eval-{agent}(-desc)` | `aigon-f212-eval-gg-fix-autopilot` |
| Eval (research) | `{repo}-r{id}-eval-{agent}(-desc)` | `aigon-r31-eval-gg-my-topic` |
| Review | `{repo}-f{id}-review-{agent}(-desc)` | `aigon-f212-review-cc-fix-autopilot` |
| Autonomous monitor | `{repo}-f{id}-auto(-desc)` | `aigon-f212-auto-fix-autopilot` |

Role allowlist: `do`, `eval`, `review`, `auto`. The `auto` role has no agent suffix.

## User Stories

- [ ] As a developer, I can run `tmux ls` and immediately know what role each session is playing (implementing, evaluating, reviewing, orchestrating) without having to cross-reference feature IDs and agent codes.
- [ ] As a maintainer adding a new session type (e.g. autonomous orchestrator), I have a clear, consistent pattern to follow rather than inventing ad-hoc naming.

## Acceptance Criteria

### Core naming functions (`lib/worktree.js`)

- [ ] `buildTmuxSessionName` accepts a `role` option (`do` | `eval` | `review` | `auto`) and produces `{repo}-{type}{id}-{role}-{agent}(-desc)` — agent is omitted when role is `auto`
- [ ] `buildTmuxSessionName` defaults to role `do` when no role is provided (backwards-compatible default)
- [ ] `parseTmuxSessionName` parses all four role patterns and returns `{ repoPrefix, type, id, role, agent }` — `agent` is null for `auto` sessions
- [ ] `parseTmuxSessionName` falls back gracefully for old-style `{repo}-f{id}-{agent}` sessions (no role prefix) — interprets them as role `do` so existing live sessions are not orphaned
- [ ] `matchTmuxSessionByEntityId` correctly matches all four role patterns against a feature/research ID
- [ ] `buildResearchTmuxSessionName` deprecated wrapper continues to produce correct output via `buildTmuxSessionName`

### Callers updated

- [ ] `lib/commands/feature.js` — all `buildTmuxSessionName` calls for implementation sessions pass `role: 'do'`
- [ ] `lib/commands/research.js` — implementation session calls pass `role: 'do'`, eval calls pass `role: 'eval'`
- [ ] `lib/dashboard-server.js` — review session construction (currently passes `review-${agentId}` as the agentId arg) refactored to pass `role: 'review'` + `agentId` separately; eval session construction similarly refactored
- [ ] `lib/dashboard-status-helpers.js` — `safeTmuxSessionExists` and agent matching handle the new role segment
- [ ] `lib/dashboard-status-collector.js` — any session name construction or parsing updated
- [ ] `lib/commands/misc.js` — `parseTmuxSessionName` usage updated to read `role` field from parsed result
- [ ] `lib/entity.js` — `sessionNameBuilder` callbacks pass `role: 'do'`

### `auto` role reserved but not yet used

- [ ] `auto` is in the role allowlist and parser but no code creates `auto` sessions in this feature — reserved for feature-automation-profiles

### Backwards compatibility

- [ ] Old-style sessions (`aigon-f212-cc-desc`) already running in tmux are still matched and parsed correctly — they are not orphaned
- [ ] Dashboard continues to show correct liveness for any live sessions using the old naming

### Regression safety

- [ ] `node -c lib/worktree.js` passes
- [ ] `node -c lib/commands/feature.js` passes
- [ ] `node -c lib/commands/research.js` passes
- [ ] `node -c lib/dashboard-server.js` passes
- [ ] `npm test` passes
- [ ] `aigon feature-start <id> cc` creates a session named `{repo}-f{id}-do-cc-{desc}`
- [ ] `aigon feature-eval <id>` creates a session named `{repo}-f{id}-eval-{agent}-{desc}`
- [ ] `aigon feature-review <id>` creates a session named `{repo}-f{id}-review-{agent}-{desc}`
- [ ] Dashboard shows correct session liveness for all session types after the rename

## Validation

```bash
node -c lib/worktree.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/dashboard-server.js
npm test
```

## Technical Approach

### 1. Update `buildTmuxSessionName` (`lib/worktree.js`)

```js
const VALID_ROLES = ['do', 'eval', 'review', 'auto'];

function buildTmuxSessionName(entityId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    const num = toUnpaddedId(entityId);
    const typeChar = (options && options.entityType) || 'f';
    const role = (options && options.role) || 'do';
    const desc = options && options.desc;
    const noAgent = role === 'auto';
    const agent = noAgent ? null : (agentId || 'solo');
    const middle = noAgent ? role : `${role}-${agent}`;
    return desc
        ? `${repo}-${typeChar}${num}-${middle}-${desc}`
        : `${repo}-${typeChar}${num}-${middle}`;
}
```

### 2. Update `parseTmuxSessionName` (`lib/worktree.js`)

Parse in order:
1. `auto` (no agent): `/^(.+)-(f|r)(\d+)-auto(?:-|$)/` → `{ role: 'auto', agent: null }`
2. Role+agent: `/^(.+)-(f|r)(\d+)-(do|eval|review)-([a-z]{2})(?:-|$)/` → `{ role, agent }`
3. Legacy fallback (no role prefix): `/^(.+)-(f|r)(\d+)-([a-z]{2})(?:-|$)/` → `{ role: 'do', agent }`

Returns `{ repoPrefix, type, id, role, agent }` in all cases.

### 3. Update `matchTmuxSessionByEntityId` (`lib/worktree.js`)

Replace the current two-branch regex with patterns that cover all four role types.

### 4. Key caller to watch: `lib/dashboard-server.js`

The dashboard server currently constructs role+agent as a single string passed as `agentId`:
```js
// Current (awkward):
buildTmuxSessionName(featureId, `review-${agentId}`, { ... })
buildTmuxSessionName(featureId, `eval-${agentId}`, { ... })

// Fixed:
buildTmuxSessionName(featureId, agentId, { role: 'review', ... })
buildTmuxSessionName(featureId, agentId, { role: 'eval', ... })
```

This is the main structural caller change — all others just add `role: 'do'`.

## Dependencies

- `lib/worktree.js` — `buildTmuxSessionName`, `parseTmuxSessionName`, `matchTmuxSessionByEntityId`
- `lib/commands/feature.js`
- `lib/commands/research.js`
- `lib/commands/misc.js`
- `lib/dashboard-server.js`
- `lib/dashboard-status-helpers.js`
- `lib/dashboard-status-collector.js`
- `lib/entity.js`

## Out of Scope

- Creating `auto` sessions (feature-automation-profiles)
- Renaming existing live tmux sessions (handled by legacy fallback parser)
- Changing worktree directory naming

## Open Questions

- None — naming scheme agreed in design discussion

## Related

- Feature: feature-automation-profiles (depends on this — `auto` role used there)
- `lib/worktree.js` — all session naming logic lives here
