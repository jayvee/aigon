> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.

# Cross-repo feature support

**Status:** inbox (draft, awaiting OSS/Pro spec split decision)
**Driven by:** the Aigon Pro/OSS repo split (Option G in the OSS/Pro separation discussion, 2026-04-07)
**Lives here because:** this feature exists to serve the Pro/OSS split, which is itself a Pro concern.

## Problem

After splitting feature specs between `aigon` (OSS) and `aigon-pro` (private),
some features will need to make changes in *both* repos in a single
coordinated unit of work. Examples:

- A new Pro feature (e.g. weekly insights digest) that needs a new event
  type registered in `aigon/lib/pro-bridge.js`
- A Pro behavior change that depends on an OSS engine change shipping
  alongside it

Today, `aigon feature-start` creates one worktree in one repo. There is no
mechanism for "this feature touches another repo too." Without support, the
agent has to manually edit the sibling repo's main checkout, which:

- Pollutes that repo's `main` branch with uncommitted work
- Collides with parallel features in the same sibling repo
- Provides no clean branch / commit / push story for the OSS side
- Leaves no machine-readable trace linking the two repos' commits

## Goal

When a feature spec declares that it touches another repo, `aigon
feature-start` should create paired worktrees — one in the primary repo
(where the spec lives) and one in each declared sibling repo — with branch
names that self-document the cross-repo origin. `aigon feature-submit` and
`aigon feature-close` should handle both worktrees as a unit.

## The convention

### 1. Spec marker

Specs that touch a sibling repo include a `## Cross-repo touch` section:

```markdown
## Cross-repo touch
- aigon-pro: src/insights/digest.js (new)
- aigon: lib/pro-bridge.js (register new event type)
```

The header is parsed by `aigon feature-start`. Each line is `<repo>:
<path> (<note>)`. The repo name maps to a configured sibling repo path
(see config below).

### 2. Sibling repo config

`~/.aigon/config.json` (global) or `.aigon/config.json` (per-repo) gains a
`siblings` map:

```json
{
  "siblings": {
    "aigon": "/Users/jviner/src/aigon",
    "aigon-pro": "/Users/jviner/src/aigon-pro"
  }
}
```

This is how the tool resolves "the spec says aigon, where does that live on
disk?"

### 3. Paired worktree naming

When the primary feature is `aigon-pro` feature 245, the paired worktree in
aigon uses branch name `feature/pro-245-<agent>`:

```
~/src/aigon-pro-worktrees/feature-245-cc/   (primary, branch: feature/245-cc)
~/src/aigon-worktrees/feature-pro-245-cc/   (paired,  branch: feature/pro-245-cc)
```

The `pro-` prefix in the paired branch name is a flag to anyone browsing
aigon's branches that this branch exists because of a Pro feature. It does
not reveal the spec title.

### 4. Pairing metadata file

Each paired worktree gets a small `.aigon-paired-with` file at its root:

```json
{
  "primary": {
    "repo": "aigon-pro",
    "feature": 245,
    "worktree": "/Users/jviner/src/aigon-pro-worktrees/feature-245-cc"
  }
}
```

This makes the link discoverable without parsing branch names.

### 5. Commit message footers

**Paired (OSS) commit:**

```
feat(pro-bridge): register insights:weekly-digest event type

<body>

Cross-repo: aigon-pro feature 245
```

**Primary (Pro) commit:**

```
feat(insights): weekly digest report

<body>

Depends on: aigon@<short-sha>
Spec: docs/specs/features/.../feature-245-weekly-insights-digest.md
```

The OSS commit footer (`Cross-repo: aigon-pro feature N`) lets anyone
reading public aigon history know the commit was Pro-driven, without
revealing what the Pro feature does. The Pro commit footer (`Depends on:
aigon@<sha>`) pins the exact OSS revision the Pro change requires.

## CLI changes

### `aigon feature-start <id>`
- Parse the spec for `## Cross-repo touch`
- For each sibling listed, resolve via `siblings` config
- Create a paired worktree in each sibling with branch `feature/pro-<id>-<agent>`
  (when primary is aigon-pro) or `feature/<primary-repo>-<id>-<agent>`
  (general form)
- Write `.aigon-paired-with` to each paired worktree
- Include all worktree paths in the agent launch prompt

### `aigon feature-submit`
- Run from the primary worktree
- Verify primary worktree is clean and committed
- For each paired worktree (discovered via `.aigon-paired-with` reverse
  lookup, or by re-parsing the spec): verify clean, push branch to its
  remote
- Write the implementation log to the primary worktree's spec folder

### `aigon feature-close <id> [winner]`
- Run from the primary repo
- Merge the primary worktree's branch into primary `main`
- For each paired worktree: merge its branch into the sibling repo's `main`
- Clean up all worktrees (primary + paired)
- Move spec from `02-active/` (or wherever it is) to `05-done/` in primary

### `aigon feature-spec <id>`
- Unchanged for the primary repo case
- For lookup of "what is feature 245 in aigon-pro?" from inside aigon: out
  of scope for this feature; users `cd` to the right repo

## Agent launch prompt

When a feature has paired worktrees, the launch prompt (built by
`feature-start`) includes:

```
You are implementing aigon-pro feature 245: <title>.

Primary worktree (aigon-pro):
  /Users/jviner/src/aigon-pro-worktrees/feature-245-cc

Paired worktrees:
  - aigon: /Users/jviner/src/aigon-worktrees/feature-pro-245-cc

Spec: docs/specs/features/02-active/feature-245-<title>.md
(in the primary worktree)

Cross-repo touch (from spec):
  - aigon-pro: src/insights/digest.js (new)
  - aigon: lib/pro-bridge.js (register new event type)

Convention:
  - Make Pro changes in the primary worktree
  - Make OSS changes in the paired aigon worktree
  - Commit each repo separately
  - In the OSS commit, add footer: Cross-repo: aigon-pro feature 245
  - In the Pro commit, add footer: Depends on: aigon@<sha>
```

## Out of scope

- Multi-primary cross-repo features (a feature whose "home" is split across
  repos). The model is always one primary + N paired siblings.
- Automatic test orchestration across paired worktrees. Convention is
  manual: agent runs tests in both before submit. Could be a follow-up.
- Dashboard support for showing cross-repo features in both repos'
  dashboards. Today the spec lives in one repo, so it shows in one
  dashboard. Acceptable.
- Renaming or moving cross-repo features after creation.

## Open questions

- Should `aigon feature-close` be transactional across repos? (i.e. if the
  paired merge fails, roll back the primary merge.) Probably not in v1 —
  the user can `git revert` if needed and the commit footers make the link
  recoverable.
- Should `aigon feature-start` refuse to proceed if a sibling repo has
  uncommitted changes on `main`? Probably yes — surface the conflict early.
- What happens if a cross-repo feature is started, work begins, and then
  the user realizes the OSS side isn't needed after all? Convention:
  delete the paired worktree manually and remove the `## Cross-repo touch`
  line from the spec. CLI doesn't need to support this case explicitly.

## Acceptance criteria

- [ ] `## Cross-repo touch` parser in spec utilities
- [ ] `siblings` config schema in `lib/config.js`
- [ ] `aigon feature-start` creates paired worktrees when spec declares them
- [ ] Paired branches use `feature/<primary-repo>-<id>-<agent>` naming
- [ ] `.aigon-paired-with` written to each paired worktree
- [ ] Agent launch prompt includes paired worktree paths and convention
- [ ] `aigon feature-submit` checks and pushes paired worktrees
- [ ] `aigon feature-close` merges and cleans up paired worktrees
- [ ] CLAUDE.md (in both repos) documents the convention and commit footers
- [ ] At least one real cross-repo feature implemented end-to-end as a smoke test
- [ ] Tests for the spec parser and the paired-worktree resolver
