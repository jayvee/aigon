<!-- description: Hard reset a seed demo repo (brewboard, trailhead) back to its canonical seed state -->
# Seed Reset

Wipes a demo repo and re-clones it from its canonical seed. Three phases: Nuke → Clone → Provision.

```bash
aigon seed-reset $ARGUMENTS
```

Known seeds: `brewboard`, `trailhead`

Examples:
- `aigon seed-reset brewboard` — resolves to `$HOME/src/brewboard`
- `aigon seed-reset trailhead --dry-run` — preview what would happen
- `aigon seed-reset brewboard --force` — skip confirmation prompt

> **If you are making changes to a seed repo**, read `docs/seeds.md` before touching anything.
> Each seed has two GitHub repos. Pushing only to `origin` is silently wiped on the next reset.
> Changes must be pushed to the seed repo (`brewboard-seed.git`) to survive.
