# Specs merged back from aigon-pro

On **2026-07-25** F693 dissolved the OSS/Pro split created on 2026-04-07 and
folded the `aigon-pro` codebase, tests, and spec history back into this repo.
Aigon is a single free, open-source product with no commercial tier: Insights,
Aigon Sync, Vault, Profile Sync, Scheduled Kickoffs, Recurring Features, the
Benchmark Matrix, and Agent Failover ship to every user with no key and no gate.

This file replaces `MOVED-TO-AIGON-PRO.md` (the record of the split). The
`aigon-pro` GitHub repo survives as a **private archive** for marketing,
competitive analysis, `docs/sdd-eval/`, and the beta-tester roster. It is no
longer an installable package and holds no code or specs that matter here.

## How to read an old reference

Commit messages, logs, and memory entries written between 2026-04-07 and
2026-07-25 use **aigon-pro's** numbering. Use the table below to translate.
Specs whose IDs were vacant in this repo kept their original number, so
`F219` still means `F219`. Specs that collided were renumbered into a
contiguous block starting at the allocator's ceiling (702), in ascending
original-ID order so relative chronology still holds.

Imported spec bodies had their own cross-references rewritten to the new IDs.
Where a quoted commit message would have been falsified by rewriting, the
original number was left alone.

## Features restored at their original IDs

`114` aade-insights · `115` aade-git-signals · `118` aade-amplification-dashboard ·
`122` aade-extract-to-private-package · `123` aade-telemetry · `152` pro-gated-reports ·
`153` pro-landing-page-and-docs · `159` pro-autonomy-bundle ·
`211` update-docs-telemetry-and-more · `219` pro-extension-point-single-seam ·
`221` pro-gate-infrastructure · `222` pro-gate-research-autopilot ·
`226` pro-availability-is-global-not-project-scoped

## Features renumbered

| aigon-pro ID | New ID | Title | Stage |
|---|---|---|---|
| 233 | 702 | cross-repo-feature-support | paused |
| 234 | 703 | workflow-definitions-unified | done |
| 235 | 704 | workflow-model-picker-and-launch-honouring | done |
| 236 | 705 | move-backup-sync-and-scheduling-to-pro | done |
| 238 | 706 | merge-comparisons-extended-into-public-site | paused |
| 320 | 707 | recurring-features | done |
| 359 | 708 | aigon-state-sync | done |
| 367 | 709 | server-scheduled-kickoff-for-features-and-research | done |
| 379 | 710 | scheduler-agent-prompt-action | done |
| 380 | 711 | aigon-profile-sync | done |
| 388 | 712 | aigon-vault | done |
| 420 | 713 | settings-pro-perf-benchmark-dashboard | done |
| 421 | 714 | agent-failover-pro-tier | done |
| 431 | 715 | aigon-pro-github-packages-beta-distribution | done |
| 434 | 716 | review-and-refine-tests-2026-w20 | backlog |
| 435 | 717 | security-scan-2026-w20 | backlog |
| 436 | 718 | agent-matrix-benchmark-2026-w20 | backlog |
| 437 | 719 | agent-matrix-pricing-refresh-2026-w20 | backlog |
| 438 | 720 | dep-sweep-2026-w20 | backlog |
| 439 | 721 | docs-gap-scan-2026-w20 | backlog |
| 440 | 722 | stale-entity-sweep-2026-w20 | backlog |
| 441 | 723 | workflow-state-integrity-2026-w20 | backlog |
| 442 | 724 | competitive-scan-2026-06 | backlog |
| 443 | 725 | agent-matrix-qualitative-refresh-2026-q3 | backlog |

## Research

| aigon-pro ID | New ID | Title |
|---|---|---|
| 13 | 13 | ai-development-effectiveness (restored at original ID) |
| 24 | 65 | git-native-team-sync-architecture |
| 26 | 66 | reduce-token-usage |

## Not imported

These stayed in the private archive. Nothing in this repo depends on them, and
imported bodies that pointed at them were rewritten rather than left dangling.

| aigon-pro spec | Why |
|---|---|
| `feature-232-aigon-pro-split-marker` | Existed only to hold a counter floor that no longer means anything. |
| `feature-432-publish-pipeline-minification` | Existed only to hide the private beta key in a bundled build. |
| `feature-433-beta-key-validation` | The beta-key access control it designed is deleted. |
| `feature-pro-licensing-and-billing` | Checkout-vendor evaluation; Aigon has no paid tier. |
| `feature-pro-autonomy-metering` | Usage metering for billing. |
| `feature-marketing-monitoring-and-metrics`, `feature-content-publishing-pipeline`, `feature-launch-campaign-prep`, `feature-remotion-videos` | Marketing operations, not product. |
| `feature-settings-pro-perf-benchmark-dashboard` (inbox) | Stale duplicate of the shipped spec (420 → 713). |
| `feature-evaluate-private-monorepo-for-oss-and-pro` | Evaluates a layout for the split this merge dissolves. |
| `research-15-aade-commercial-gate` + findings | Pricing and packaging analysis. |
| `research-23-autonomous-mode-as-pro` + findings | Pricing and packaging analysis. |
| `research-25-marketing-aigon` + findings | Marketing strategy. |
| `.aigon/beta-testers/`, `.aigon/marketing/`, `MARKETING.md`, `docs/competitive/`, `docs/sdd-eval/`, `docs/proposals/`, `docs/marketing/` | Private, non-product material. |

## Historical banner

Imported specs that describe the tiered architecture carry a banner at the top:

> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.

They are engineering history — they explain why `lib/pro-bridge.js` existed and
how the extension seam was shaped — not a description of how Aigon works today.

## Re-running the import

`scripts/import-aigon-pro-specs.js` is the idempotent script that performed this
import. It moves the spec markdown (tracked) **and** the
`.aigon/workflows/{features,research}/<id>/` engine directories (gitignored).
Because engine state is not committed, it must be run once from the primary
checkout after this branch merges:

```
cd <your aigon checkout>
node scripts/import-aigon-pro-specs.js
aigon doctor
```

After that the allocator sits at `feature.next = 726`, `research.next = 67`.
