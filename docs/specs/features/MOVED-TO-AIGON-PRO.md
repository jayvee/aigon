# Specs moved to aigon-pro

The following feature and research specs were moved to the private
**aigon-pro** repo on **2026-04-07** as part of the OSS/Pro split.

If you're reading old commit messages, log files, or memory entries that
reference any of the IDs below, the spec lives in
`~/src/aigon-pro/docs/specs/` rather than here. The numbers were preserved
on the move, so `feature-219` still means `feature-219` — it just lives in
a different repo now.

Aigon's `getNextId()` was unaffected by the split, so its counter continued
from 232 onwards. Aigon-pro seeded its counter to start at 233 (see the
split marker spec at `aigon-pro/docs/specs/features/05-done/feature-232-aigon-pro-split-marker.md`).
From 233 onwards both repos increment independently — like JVBot, FarLine,
and other unrelated repos. Eventual ID collisions are expected and
disambiguated by repo name.

## Moved features (done)

| ID  | Title                                              |
|-----|----------------------------------------------------|
| 114 | aade-insights                                      |
| 115 | aade-git-signals                                   |
| 118 | aade-amplification-dashboard                       |
| 122 | aade-extract-to-private-package                    |
| 123 | aade-telemetry                                     |
| 152 | pro-gated-reports                                  |
| 153 | pro-landing-page-and-docs                          |
| 159 | pro-autonomy-bundle                                |
| 211 | update-docs-telemetry-and-more                     |
| 219 | pro-extension-point-single-seam-for-aigon-pro-integration |
| 221 | pro-gate-infrastructure                            |
| 222 | pro-gate-research-autopilot                        |
| 226 | pro-availability-is-global-not-project-scoped      |

## Moved features (inbox — never started)

| Title                                              |
|----------------------------------------------------|
| feature-aade-commercial-site                       |
| feature-pro-autonomy-metering                      |
| feature-pro-insights-tier                          |
| feature-pro-licensing-and-billing                  |

## Moved research topics (done)

| ID | Title                                              |
|----|----------------------------------------------------|
| 13 | ai-development-effectiveness                       |
| 15 | aade-commercial-gate                               |
| 23 | autonomous-mode-as-pro                             |

## Moved research topics (inbox)

| Title                                              |
|----------------------------------------------------|
| research-integrate-with-llm-observability-tools    |

## Also moved

- Implementation logs for all 13 done features
- Evaluation files for features 114, 118, 123
- Research findings logs for research 13, 15, 23
- Workflow engine state directories
  (`.aigon/workflows/features/{114,115,118,122,123,152,153,159,211,219,221,222,226}/`)
- Per-feature telemetry files for features 159, 211, 219, 221, 222, 226

## Specs that mention Pro but stayed in aigon

These are OSS specs that mention Pro tangentially. They were lightly
sanitized in commit `db2ea020` (now part of the rewritten history) to
remove Pro-internal framing while preserving the OSS narrative:

- `feature-202-agent-attributed-token-analytics`
- `feature-209-token-usage-chart-by-activity-agent-model`
  (renamed to "Token Usage Time Series by Activity, Agent & Model" —
  the OSS data series only; chart rendering moved to aigon-pro)
- `research-19-ai-native-workflow-metrics`
- `research-19-{cc,cx,gg}-findings`

## Recovery / context

- Pre-split aigon HEAD: `3e942326a0b5dd48097f8b59058414d80e2dd850`
- Post-split aigon HEAD: `a88b8beec7fba7add8e2bccaaccf5c6f18c7b643`
- Backup tarballs: `~/Backups/aigon-2026-04-07.tar.gz`,
  `~/Backups/aigon-pro-2026-04-07.tar.gz`
- Backup notes: `~/Backups/aigon-split-notes-2026-04-07.md`
