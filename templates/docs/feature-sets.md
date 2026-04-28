# Feature Sets

A **feature set** is a group of related features that ship together as one initiative. Sets are derived state — they exist whenever two or more feature specs share the same `set:` slug in their frontmatter. There is no separate "set" file, no engine record, and no manual create/destroy step.

## When to use a set

Use a set when you have a small group of features (typically 2–6) that:
- Share an architectural goal that no single feature spec can hold
- Have inter-dependencies you want enforced at prioritise time and at autonomous-run time
- Will be implemented in a known order

Do **not** use a set for unrelated work, for one feature, or to track a long-running theme. A set is a delivery unit, not a product area.

## Tagging a feature into a set

Add `set:` to the spec frontmatter:

```yaml
---
complexity: medium
set: aigon-install-contract
---
```

You can do this at create time:

```bash
aigon feature-create vendor-aigon-docs --set aigon-install-contract
```

Or by editing the inbox spec file directly before prioritise.

The slug must match `[a-z0-9][a-z0-9-]*` (no slashes or whitespace) so it is safe as a CLI arg, URL value, and DOM id. Invalid slugs are silently dropped from set membership.

## Dependencies inside a set

The standard `depends_on:` frontmatter still applies — sets do not introduce a new edge type. Inside a set, `depends_on` may reference:

- **Other inbox peers** by slug (e.g. `depends_on: [vendor-aigon-docs-to-dot-aigon-folder]`)
- **Backlog or later features** by numeric ID (e.g. `depends_on: [415]`)

`set-prioritise` uses intra-set edges to assign IDs in dependency order. Cross-set deps are checked against the existing prioritised features via the standard resolver.

## Prioritising a set

```bash
aigon set-prioritise <slug>
```

Topologically orders all inbox members and runs `feature-prioritise` for each, so dependents always get higher IDs than what they depend on. Errors loudly when the intra-set graph is cyclic or when a `depends_on` slug names something that is neither an inbox peer nor an existing prioritised feature.

After prioritise, members live in the backlog with stable numeric IDs.

## Inspecting sets

```bash
aigon set list                 # incomplete sets only (default)
aigon set list --all           # include completed sets
aigon set list --json
aigon set show <slug>          # members in dependency order, edges, autonomous state
aigon set show <slug> --json
```

`set show` also prints the dashboard-equivalent autonomous state: paused-on-failure, current member, completed/failed lists.

## Set state derivation

Set state is **derived** from member workflow state — the dashboard never persists set status independently. The rollup is computed by `lib/feature-sets.js` (`summarizeSets`, `getSetMembersSorted`, `getSetDependencyEdges`) and consumed by `lib/dashboard-status-collector.js` for the per-set card payload. Action eligibility (`set-autonomous-{start,stop,resume,reset}`) lives in `lib/feature-set-workflow-rules.js`; the frontend renders only what the server emits.

## Autonomous sets (Pro)

The set conductor (`lib/set-conductor.js`) runs members sequentially in topological order:

```bash
aigon set-autonomous-start <slug>
aigon set-autonomous-stop <slug>
aigon set-autonomous-resume <slug>     # after fixing a failed member
aigon set-autonomous-reset <slug>      # discard durable conductor state
```

Each member is delegated to `feature-autonomous-start`, polled, and recorded in `.aigon/state/set-<slug>-auto.json`. A member failure pauses the whole set; resume restarts at the failed member.

## Common patterns

- **Install contract bundle**: a set of 5 features that together change install behaviour. Tag all five with the same slug, declare deps on each side of the contract change, and `set-prioritise` to keep IDs in build order.
- **Refactor with seed-repo follow-up**: `[refactor]` → `[refresh-seed]`. Two-member set; the seed feature `depends_on:` the refactor.
- **Documentation reorg followed by code change**: doc-only first feature, code feature `depends_on:` the doc one, single set so they land in order.

## Frontmatter reference

| Field | Type | Notes |
|-------|------|-------|
| `set` | string | Slug, `[a-z0-9][a-z0-9-]*`. Optional. |
| `depends_on` | string[] | Each entry is either a numeric feature ID or an inbox-peer slug. |

`set:` and `depends_on:` are independent: a feature can sit in a set without depending on anyone, and a feature can `depends_on` a non-set feature.

## See also

- `docs/development_workflow.md` — feature lifecycle (`feature-create` → `feature-prioritise` → `feature-do` → `feature-close`)
- `lib/feature-sets.js` — derived-state scanner (no engine writes)
- `lib/set-conductor.js` — autonomous-set sequencer (Pro)
