# `docs/competitive/` — Source of truth

This directory is the **internal** source of truth for everything Aigon claims about its competitive position. The public surfaces are projections of it:

- `site/content/comparisons.mdx` — public 5-axis × ~10-tool projection.
- `docs/marketing/positioning.md` — positioning copy that cites this landscape.
- `README.md`, `AGENTS.md`, `site/public/llms.txt`, GitHub repo description — taglines that align to the category claim grounded here.

**Direction of edits:** matrix and landscape change *here first*. Public surfaces follow in the same PR. Never edit a projection without updating this directory.

## Layout

| File | Purpose |
|---|---|
| `landscape.md` | The 4-tier model (direct competitors / spec-driven peers / single-agent tools / autonomous cloud agents). One paragraph per tier; named tools with one-line characterisations. |
| `matrix.md` | The 10-axis × all-tracked-tools comparison. The full grid the public 5-axis page is sliced from. |
| `weaknesses.md` | Per-competitor "what they do better than Aigon" + Aigon's own honest weaknesses. |
| `entries/<slug>.md` | Per-tool deep-dive with sources, last-verified date, and citation pointers used by the matrix cells. |

## Contributing

- Cite sources for every cell in `matrix.md` either inline or in the relevant `entries/<slug>.md`.
- "Last verified" dates matter — a stale matrix is worse than a missing one.
- The recurring competitive scan (`recurring-competitive-refresh`, separate feature in this set) writes draft patches against `matrix.md` and a "what changed" summary; a human applies them.
- Lineage edge cases (e.g. archived projects, name collisions, forks) belong in the relevant `entries/<slug>.md` so the matrix stays compact.

## Category claim

Aigon's category claim — used verbatim across every public surface — is **`spec-driven multi-agent harness`**. The reasoning lives in `../marketing/positioning.md`. The landscape and matrix here are what justify that claim.
