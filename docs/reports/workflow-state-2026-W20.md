# Workflow State Integrity Report — 2026-W20

Generated: 2026-07-25T10:07:59.641Z

Operator machine: `vinorgair`

Repos scanned: 17 (from `~/.aigon/config.json` `repos` array)

## Executive summary

- **0** registered repo path(s) missing on disk
- **5** repo(s) with workflow-state anomalies (snapshotless inbox/backlog, folder drift, or missing snapshots)
- **7** distinct port conflict group(s) across the machine
- **0** slug-only spec(s) outside inbox
- **4** spec-folder vs workflow-state drift item(s)

## Per-repo summary

| Repo | Path | Doctor issues | Inbox/backlog snapshotless | Recommendation |
|------|------|---------------|---------------------------|----------------|
| aigon | `/Users/jviner/src/aigon` | 64 issue(s) | 29 | run `aigon doctor --fix` on /Users/jviner/src/aigon |
| sen-labs-site | `/Users/jviner/src/sen-labs-site` | 37 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/sen-labs-site |
| farline | `/Users/jviner/src/farline` | 38 issue(s) | 30 | run `aigon doctor --fix` on /Users/jviner/src/farline |
| aigon-pro | `/Users/jviner/src/aigon-pro` | 33 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/aigon-pro |
| farline-ai-forge | `/Users/jviner/src/farline-ai-forge` | 36 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/farline-ai-forge |
| diviner | `/Users/jviner/src/diviner` | 34 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/diviner |
| when-swell | `/Users/jviner/src/when-swell` | 35 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/when-swell |
| trailhead | `/Users/jviner/src/trailhead` | 34 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/trailhead |
| john-viner | `/Users/jviner/src/john-viner` | 37 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/john-viner |
| static-site-template | `/Users/jviner/src/static-site-template` | 35 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/static-site-template |
| whos-up-next-site | `/Users/jviner/src/whos-up-next-site` | 33 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/whos-up-next-site |
| brewboard-old | `/Users/jviner/src/brewboard-old` | 32 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/brewboard-old |
| brewboard-seed | `/Users/jviner/src/brewboard-seed` | 30 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/brewboard-seed |
| brewboard-storage-lab | `/Users/jviner/src/brewboard-storage-lab` | 33 issue(s) | 12 | run `aigon doctor --fix` on /Users/jviner/src/brewboard-storage-lab |
| brewboard-sync-test | `/Users/jviner/src/brewboard-sync-test` | 35 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/brewboard-sync-test |
| brewboard | `/Users/jviner/src/brewboard` | 33 issue(s) | 0 | run `aigon doctor --fix` on /Users/jviner/src/brewboard |
| aigon-f684-brewboard.iIz6oG | `/private/tmp/aigon-f684-brewboard.iIz6oG` | 33 issue(s) | 0 | run `aigon doctor --fix` on /private/tmp/aigon-f684-brewboard.iIz6oG |

## Snapshotless inbox/backlog specs

### aigon

- feature codeburn-telemetry-inspiration (inbox, feature-codeburn-telemetry-inspiration.md)
- feature dashboard-spec-anchor-discussion (inbox, feature-dashboard-spec-anchor-discussion.md)
- feature frontmatter-claim-sync (inbox, feature-frontmatter-claim-sync.md)
- feature git-native-team-sync (inbox, feature-git-native-team-sync.md)
- feature github-create-pr-action (inbox, feature-github-create-pr-action.md)
- feature github-repo-launch-readiness (inbox, feature-github-repo-launch-readiness.md)
- feature jira-integration-foundation (inbox, feature-jira-integration-foundation.md)
- feature jira-lifecycle-sync (inbox, feature-jira-lifecycle-sync.md)
- feature linear-adapter (inbox, feature-linear-adapter.md)
- feature metrics-code-durability (inbox, feature-metrics-code-durability.md)
- feature metrics-insights-scorecard (inbox, feature-metrics-insights-scorecard.md)
- feature reduce-tokens-1-cost-dashboard (inbox, feature-reduce-tokens-1-cost-dashboard.md)
- feature reduce-tokens-2-slim-instructions (inbox, feature-reduce-tokens-2-slim-instructions.md)
- feature reduce-tokens-3-lazy-workflow (inbox, feature-reduce-tokens-3-lazy-workflow.md)
- feature reduce-tokens-4-output-compression (inbox, feature-reduce-tokens-4-output-compression.md)
- feature refs-state-backend (inbox, feature-refs-state-backend.md)
- feature shippable-model-catalog-discovery-2026-06 (inbox, feature-shippable-model-catalog-discovery-2026-06.md)
- feature stale-claim-recovery (inbox, feature-stale-claim-recovery.md)
- feature tracker-webhook-conflict (inbox, feature-tracker-webhook-conflict.md)
- feature 717 (backlog, feature-717-security-scan-2026-w20.md)
- feature 718 (backlog, feature-718-agent-matrix-benchmark-2026-w20.md)
- feature 719 (backlog, feature-719-agent-matrix-pricing-refresh-2026-w20.md)
- feature 720 (backlog, feature-720-dep-sweep-2026-w20.md)
- feature 721 (backlog, feature-721-docs-gap-scan-2026-w20.md)
- feature 722 (backlog, feature-722-stale-entity-sweep-2026-w20.md)
- feature 724 (backlog, feature-724-competitive-scan-2026-06.md)
- feature 725 (backlog, feature-725-agent-matrix-qualitative-refresh-2026-q3.md)
- research integrate-with-llm-observability-tools (inbox, research-integrate-with-llm-observability-tools.md)
- research investigate-spdd (inbox, research-investigate-spdd.md)

### farline

- feature chart-theme-engine (inbox, feature-chart-theme-engine.md)
- feature chart-theme-settings (inbox, feature-chart-theme-settings.md)
- feature chat-scenario-comparison (inbox, feature-chat-scenario-comparison.md)
- feature chat-spof-split-assistant (inbox, feature-chat-spof-split-assistant.md)
- feature customizable-keyboard-shortcuts (inbox, feature-customizable-keyboard-shortcuts.md)
- feature diagram-export-ui-enhancement (inbox, feature-diagram-export-ui-enhancement.md)
- feature diagram-integration (inbox, feature-diagram-integration.md)
- feature export-plan-data-to-excel-csv (inbox, feature-export-plan-data-to-excel-csv.md)
- feature export-to-lucid-standard-import (inbox, feature-export-to-lucid-standard-import.md)
- feature improve-home-docs-on-ai (inbox, feature-improve-home-docs-on-ai.md)
- feature mermaid-per-scenario-diagrams-with-aligned-timelines (inbox, feature-mermaid-per-scenario-diagrams-with-aligned-timelines.md)
- feature migrate-dns-namecheap-to-cloudflare (inbox, feature-migrate-dns-namecheap-to-cloudflare.md)
- feature model-for-browser-control (inbox, feature-model-for-browser-control.md)
- feature operational-improvements (inbox, feature-operational-improvements.md)
- feature qa-environment (inbox, feature-qa-environment.md)
- feature schema-versioning-infrastructure (inbox, feature-schema-versioning-infrastructure.md)
- feature shared-miro-export-orchestration (inbox, feature-shared-miro-export-orchestration.md)
- feature small-screen-tabs (inbox, feature-small-screen-tabs.md)
- feature staging-environment-with-smoke-tests (inbox, feature-staging-environment-with-smoke-tests.md)
- feature survey-response-analyzer (inbox, feature-survey-response-analyzer.md)
- feature sync-dependencies-to-jira-when-syncing-epics (inbox, feature-sync-dependencies-to-jira-when-syncing-epics.md)
- feature video-tutorials-product-walkthrough (inbox, feature-video-tutorials-product-walkthrough.md)
- feature visual-builder-enhancements (inbox, feature-visual-builder-enhancements.md)
- feature waitlist-admin-notifications (inbox, feature-waitlist-admin-notifications.md)
- research evaluate-gemini-2-5-flash-as-a-backup-model-to-claude-haiku-4-5 (inbox, research-evaluate-gemini-2-5-flash-as-a-backup-model-to-claude-haiku-4-5.md)
- research improve-claude-code (inbox, research-improve-claude-code.md)
- research move-off-helicone (inbox, research-move-off-helicone.md)
- research multi-tab-editing-strategy (inbox, research-multi-tab-editing-strategy.md)
- research video-project-summaries (inbox, research-video-project-summaries.md)
- research 25 (backlog, research-25-competitive-cost-tracking-optimization-and-scenario-cost-comparison-in-project-planning-tools.md)

### brewboard-storage-lab

- feature beer-style-filters (inbox, feature-beer-style-filters.md)
- feature 03 (backlog, feature-03-user-profiles.md)
- feature 04 (backlog, feature-04-rating-system.md)
- feature 09 (backlog, feature-09-dark-mode.md)
- feature 10 (backlog, feature-10-social-sharing.md)
- research 06 (inbox, research-06-half-star-ratings-round-down-silently.md)
- research 07 (inbox, research-07-search-is-unusable-on-mobile-5-seconds-per-keystroke.md)
- research payment-providers (inbox, research-payment-providers.md)
- research 01 (backlog, research-01-caching-strategy.md)
- research 02 (backlog, research-02-offline-sync.md)
- research 04 (backlog, research-04-please-let-me-export-my-collection-to-csv.md)
- research 05 (backlog, research-05-white-flash-on-every-page-navigation-in-dark-mode.md)

## Slug / numeric ID mismatches

### Spec folder vs workflow state drift

- **aigon**: spec-folder-drift [research 52]: in 05-done/ but state says 04-in-evaluation/ (run `aigon doctor --fix` to correct)
- **aigon**: spec-folder-drift [research 29]: in 06-paused/ but state says 03-in-progress/ (run `aigon doctor --fix` to correct)
- **aigon-pro**: spec-folder-drift [feature 233]: in 02-backlog/ but state says 06-paused/ (run `aigon doctor --fix` to correct)
- **farline-ai-forge**: spec-folder-drift [feature 29]: in 04-in-evaluation/ but state says 05-done/ (run `aigon doctor --fix` to correct)

## Port conflicts

- Port **3000**: farline and farline-ai-forge
- Port **3010**: aigon and aigon-dashboard-state-gallery and aigon-dashboard-ux-preview and feature-168-cu-ai-builder-shared-package
- Port **3300**: sen-labs-site and static-site-template
- Port **3500**: when-swell and whos-up-next-site
- Port **3600**: aigon.backup-2026-04-07 and aigon.pre-author-rewrite-2026-04-08
- Port **4200**: aigon-f684-brewboard.iIz6oG and brewboard and brewboard-a2 and brewboard-no-aigon and brewboard-old and brewboard-s and brewboard-seed and brewboard-storage-lab and brewboard-sync-test
- Port **4200**: aigon-f684-brewboard.iIz6oG and brewboard and brewboard-old and brewboard-seed and brewboard-storage-lab

## Missing workflow state (all stages)

- **aigon**: 52 feature(s) and 5 research topic(s) missing workflow state
- **farline**: 171 feature(s) and 6 research topic(s) missing workflow state
- **brewboard-storage-lab**: 9 feature(s) and 7 research topic(s) missing workflow state

## Notes

- This report is read-only; no `aigon doctor --fix` was applied.
- Doctor scans from each repo cwd; port-health and multi-repo sections reflect machine-wide registration, so counts may overlap across repos.
- Pre-authorised: skip eval on close (diagnostic report only).
