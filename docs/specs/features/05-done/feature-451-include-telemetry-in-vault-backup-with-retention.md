---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T10:05:21.421Z", actor: "cli/feature-prioritise" }
---

# Feature: include-telemetry-in-vault-backup-with-retention

## Summary

`.aigon/telemetry/` is currently in the vault backup's `PROJECT_EXCLUDES` set (`@aigon/pro/lib/backup.js:30`), grouped with truly-ephemeral runtime state (`sessions`, `locks`, `cache`). That grouping is wrong now that telemetry is the input corpus for shipped features (F443 signal-health, F447 aigon-eval) and the operator's only record of historical token usage / cost / agent-stuck patterns. On a machine wipe, that history is lost — aigon-eval's model-quality scoring resets to zero, cost-per-feature analysis evaporates, and any post-hoc analysis of the auto-nudge default flip becomes impossible.

This feature drops `'telemetry'` from `PROJECT_EXCLUDES` so it travels with the vault, adds a jsonl-aware merge for `signal-health/<date>.jsonl` files (so cross-machine same-day writes don't conflict), and pairs that with a retention policy (gzip files older than 90d, drop after 365d) so the vault doesn't grow forever.

## User Stories

- [ ] As a solo operator, I want my telemetry to come with me to a new machine via `aigon backup pull`, so my F447 aigon-eval scoring corpus and cost-per-feature history survive a hardware swap or theft.
- [ ] As a multi-machine user, I want signal-health JSONL written on machine A and machine B on the same day to merge cleanly, so I never see vault sync conflicts on telemetry.
- [ ] As an operator running aigon for years, I want old telemetry to be compressed and eventually pruned automatically, so my vault doesn't grow into hundreds of MB of mostly-stale JSON.

## Acceptance Criteria

- [ ] `'telemetry'` is removed from `PROJECT_EXCLUDES` in `@aigon/pro/lib/backup.js`. After `aigon backup push`, the vault repo contains `projects/<name>/telemetry/`.
- [ ] `aigon backup pull` on a fresh checkout restores `.aigon/telemetry/` with both per-session `*.json` files and `signal-health/*.jsonl` files intact.
- [ ] `signal-health/<YYYY-MM-DD>.jsonl` written on two machines on the same date merges cleanly via a jsonl-aware path in `sync-merge.js`: union of lines, sorted by `t`, deduplicated. Other `.jsonl` files anywhere under `.aigon/` use the same merge if added later.
- [ ] On `aigon backup push`, telemetry retention is applied: per-session `*.json` files with `endAt` older than 90 days are gzipped in place (`*.json` → `*.json.gz`); files older than 365 days (by `endAt` or filename mtime fallback) are deleted. `signal-health/<date>.jsonl` files use the same age windows by filename date.
- [ ] Retention thresholds are configurable via `~/.aigon/config.json → backup.telemetryRetention.{compressAfterDays, dropAfterDays}` with the defaults above. `0`/`null` disables that step.
- [ ] Existing vault users on upgrade do not lose telemetry — first push after upgrade adds telemetry to the vault rather than complaining about new files.
- [ ] Per-session telemetry reader code (used by aigon-eval, dashboard analytics) tolerates gzipped files transparently. Either the reader auto-decompresses, or there's a single helper used everywhere.
- [ ] Unit tests cover: `PROJECT_EXCLUDES` change (telemetry now included), jsonl merge (concat + sort + dedup), retention compress (>90d → .gz), retention drop (>365d → deleted), config override (retention disabled when set to 0/null).

## Validation

```bash
# Pro module is in node_modules; standard test suite covers OSS surface.
# Pro tests run in the aigon-pro repo, not here.
node --check aigon-cli.js
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

**Scope split between repos.** The bulk of this feature lives in the closed-source `aigon-pro` repo (`lib/backup.js`, `lib/sync-merge.js`, possibly a new `lib/telemetry-retention.js`). The OSS aigon repo only changes if the per-session JSON reader needs gzip support — likely in `lib/commands/misc.js` (`capture-session-telemetry` consumers) and any aigon-eval / dashboard analytics code that reads `.aigon/telemetry/*.json` directly.

**Three concrete edits in `aigon-pro`:**

1. **`lib/backup.js:27-35`** — drop `'telemetry'` from `PROJECT_EXCLUDES`. Single-line change. The existing rsync-style copy logic already handles arbitrary subdirs, so no walker changes needed.

2. **`lib/sync-merge.js`** — add a jsonl-aware merge path. When the merge encounters a path matching `**/*.jsonl`, instead of last-write-wins, it should: read both versions, split into lines, parse each as JSON, dedup by full-line content (cheap and correct since events are append-only with unique `t`), sort by `t`, write the union. Fall back to last-write-wins if any line fails to parse.

3. **New retention pass in `lib/backup.js` push path** — runs once per `backup push` before the rsync step. For each project's `.aigon/telemetry/` directory:
   - Walk per-session `*.json` files. If `endAt` (or stat mtime fallback) is older than `compressAfterDays`, gzip in place. If older than `dropAfterDays`, delete.
   - Walk `signal-health/*.jsonl`. Parse the date from the filename (`YYYY-MM-DD.jsonl`). Same compress/drop windows by that date.
   - Skip if `backup.telemetryRetention.compressAfterDays` or `dropAfterDays` is `0`/`null`.

**OSS reader changes.** Audit who reads `.aigon/telemetry/*.json`:
- `lib/commands/misc.js` — `capture-session-telemetry` writes; readers likely live in aigon-eval and dashboard analytics. Check `lib/dashboard-status-collector.js` and `lib/insights*.js` (if present) for telemetry consumers.
- Add a `readTelemetryFile(path)` helper that auto-detects `.gz` and decompresses transparently. Replace direct `fs.readFile`/`require` calls on telemetry paths with the helper.

**Config defaults** in `lib/config.js` `DEFAULT_GLOBAL_CONFIG.backup`:
```js
telemetryRetention: {
    compressAfterDays: 90,
    dropAfterDays: 365,
}
```

**Cross-machine path concern.** Per-session telemetry files contain `repoPath: /Users/jviner/src/aigon` — an absolute path tied to the writing machine. After `backup pull` on a different machine with a different `$HOME`, that field is stale but harmless (it's read-only metadata, not a lookup key). Document this in the migration note; do not rewrite paths on pull (would be invasive and mostly pointless).

## Dependencies

- Pro module access — this feature edits closed-source code in `node_modules/@aigon/pro` and ships through the aigon-pro release.

## Out of Scope

- **Cost-data toggle.** Per-session telemetry contains `costUsd`. This feature ships costs into the (private) vault unconditionally. If a user later wants to exclude cost figures (e.g., shared/multi-tenant vault), that's a separate `backup.includeCostData: false` toggle — not part of this feature.
- **Public-repo telemetry hardening.** This feature assumes the vault repo is private (the F388 default). Sanitizing telemetry for public exposure (stripping `repoPath`, `costUsd`, etc.) is a separate concern and out of scope here.
- **Schema migrations / versioning of telemetry on read.** Existing `schemaVersion: 1` is preserved as-is; if telemetry schema evolves later, that migration is its own feature.
- **Real-time telemetry streaming or remote dashboards.** Vault is a periodic backup, not a sync channel. Live cross-machine telemetry is a different design.
- **Pruning per-session files by feature ID** (e.g., "drop all telemetry for closed features"). Retention here is purely time-based; per-feature pruning would need feature-state lookups and is more invasive.

## Open Questions

- Should retention run on every `aigon backup push` (default cadence: daily), or only when a `backup prune` subcommand is invoked? Running on every push keeps the vault tight but adds a few hundred ms to each push as the corpus grows. **Default to "every push" with a fast skip when nothing is over the compress threshold.**
- Are there any current telemetry readers that would break if a `.json` file becomes `.json.gz`? Need to grep for direct `JSON.parse(fs.readFileSync(...telemetry...))` in both aigon and aigon-pro.
- Should `signal-health/*.jsonl` be merged inside the vault working copy on `backup push`, or only on `backup pull`? Either works; pushing pre-merged files is simpler downstream but requires the push flow to know about merge semantics. **Default: merge on pull (existing sync-merge.js extension), leave push as plain rsync.**

## Related
- Set:
- Prior features in set:
