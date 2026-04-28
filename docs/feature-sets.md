# Feature Sets

A **feature set** groups related features that share scope — typically a multi-step initiative, a refactor with several stages, or a research-derived bundle of work that should land in a coordinated way. Sets are tagged via a single line of YAML frontmatter and tied together by `depends_on` edges between members.

Aigon derives all set state from the members' workflow state — there is no separate "set engine." This means sets are cheap: tag a spec with `set: <slug>` and the dashboard, CLI, and prioritisation workflow pick it up automatically.

## When to use a set

Use a set when:

- Several specs share a common scope and must land in a coordinated order (e.g. a refactor split into reorg → cleanup → migration → test).
- You want the dashboard to render members as a single card with progress, deps, and bulk actions.
- You want `aigon set-prioritise <slug>` to assign sequential IDs in dependency order so the board reflects execution order at a glance.
- You want `aigon set-autonomous-start` (Pro) to drive the whole set through autopilot.

Don't use a set for:

- A single feature with no peers — sets are a grouping mechanism; one feature is just a feature.
- Loosely related work that doesn't share dependencies — tag with similar names instead.

## Creating set members

Pass `--set <slug>` when creating each feature:

```bash
aigon feature-create my-feature-name --set my-set-slug
```

The slug must match `[a-z0-9][a-z0-9-]*` (no slashes or whitespace). Aigon writes `set: <slug>` into the spec's frontmatter automatically.

You can also tag an existing spec by adding the line manually to its frontmatter:

```yaml
---
complexity: medium
set: my-set-slug
---
```

## Declaring intra-set dependencies

Use `depends_on:` in frontmatter to express ordering between set members. The value can be a slug (for inbox peers) or a numeric ID (for already-prioritised features):

```yaml
---
complexity: medium
set: my-set-slug
depends_on: earlier-feature-slug
---
```

For multiple dependencies, use a list:

```yaml
depends_on:
  - earlier-feature-slug
  - feature-42
```

Slug references resolve against:

1. **Inbox peers in the same set** — the prioritisation workflow assigns IDs in topological order.
2. **Already-prioritised features** (any set, by slug or numeric ID) — useful when a set member depends on prior backlog work.

A `depends_on` slug that doesn't match either of these will fail at `feature-prioritise` time with a clear error, so typos surface early.

## Bulk-prioritising a set

Once all members are tagged and their `depends_on` edges declared, prioritise the entire set in one command:

```bash
aigon set-prioritise my-set-slug
# alias:
aigon asp my-set-slug
```

This:

1. Runs Kahn's topological sort over the set's intra-set `depends_on` graph.
2. Calls `feature-prioritise` once per member, in dependency order.
3. Assigns sequential numeric IDs — **roots get the lowest IDs, leaves get the highest** — so the board reflects execution order at a glance.
4. Moves each spec from `01-inbox/` to `02-backlog/`.

If the graph has a cycle, or a `depends_on` doesn't resolve, the command fails before any side effects.

You can still prioritise members one-by-one with `feature-prioritise <slug>`, but you must do so in dependency order yourself; aigon will refuse to prioritise a member whose deps are not yet resolved.

## Inspecting set state

```bash
aigon set list                 # all sets with stage counts (inbox/backlog/in-progress/done)
aigon set list --all --json    # machine-readable
aigon set show <slug>          # members in topological order + intra-set edges
aigon set show <slug> --json   # full set state
```

`set show` displays members in topological order once they have IDs; until prioritisation assigns IDs, the listing is alphabetical. The DEPS column populates after prioritisation.

## Set state derivation

Set state is **derived**, not stored:

- **Set status** = aggregate of member statuses. A set is "done" when every member is in `05-done/`; "in progress" when any member is in `03-in-progress/`; "blocked" when a member's `depends_on` predecessor is not yet done.
- **Set autonomous availability** = computed by `lib/feature-set-workflow-rules.js` from member states and snapshot data. The dashboard renders only the actions the server-side rules return; never infer eligibility from the frontend.
- **Set membership** = scan of every spec's `set:` frontmatter; no separate index file.

This means there is no "wrong" set state to clean up — fix any member's spec or workflow state and the set's derivation updates on the next read.

## Pro: autonomous set execution

`aigon set-autonomous-start <slug> [agents...]` (Pro tier) drives every backlog member through autopilot in dependency order:

```bash
aigon set-autonomous-start my-set-slug cc --mode=sequential --stop-after=close
```

Modes:

- `sequential` (default) — one member at a time, each starting only after its deps are `05-done`.
- Other modes — see `aigon set-autonomous-start --help`.

Pause, resume, and reset:

```bash
aigon set-autonomous-stop my-set-slug
aigon set-autonomous-resume my-set-slug
aigon set-autonomous-reset my-set-slug
```

## Common patterns

**Research-derived feature sets.** When `aigon research-eval` recommends multiple features, it groups them under a set slug derived from the research topic. The eval prompt explicitly instructs the agent to assign `--set <slug>` and prioritise in dependency order so IDs reflect execution order. See `templates/generic/commands/research-eval.md` for the canonical guidance.

**Refactors split into stages.** A multi-step refactor (e.g. "extract module → migrate callers → delete legacy → add migration test") fits naturally as a set with a linear `depends_on` chain.

**Coordinated rollouts.** A feature with database migration, server-side change, frontend change, and rollback test can use a set so the dashboard surfaces all four under one card.

## Frontmatter reference

```yaml
---
complexity: low | medium | high | very-high
set: optional-set-slug                # tag a spec into a set
depends_on: optional-slug-or-id       # single dep, or:
depends_on:                            # list:
  - earlier-slug
  - feature-123
agent: optional-default-agent-id       # default reviewer for spec-revise
research: optional-research-id         # auto-stamped by research-eval
---
```

## See also

- `aigon set --help` — full set command list with flags
- `templates/generic/commands/set-prioritise.md` — `set-prioritise` command details
- `templates/generic/commands/research-eval.md` — research-eval workflow that creates sets from recommended features
