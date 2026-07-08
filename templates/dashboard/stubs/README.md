# Dashboard Pro module stubs (OSS)

OSS serves these string templates in place of `/js/<module>.js` when `@aigon/pro` is not installed (or a script is missing). The dashboard loads them as normal ES modules via `main.js` import URLs.

## Contract

Each stub (or real Pro module at the same URL) **must**:

1. Export the named functions the OSS dashboard calls (see callers in `templates/dashboard/js/`).
2. May assign those exports to `globalThis` with a one-line comment — Pro scripts are the only intentional `Object.assign(globalThis, …)` surface besides `window.aigon` (F640) and `globalThis.state` on Alpine init (F641).
3. Use `typeof globalThis.<export> === 'function'` at call sites in OSS when the export is optional (settings panels, insights, reports).

| URL | Export(s) | OSS caller |
|-----|-----------|------------|
| `/js/backup-sync.js` | `renderBackupSync`, `fmtSyncTime` | `settings.js` |
| `/js/scheduled-features.js` | `renderScheduledFeatures` | `settings.js` |
| `/js/benchmark-matrix.js` | `AigonProBenchmarkMatrix` | pipeline/settings |
| `/js/pro-reports.js` | `renderProReports` | `logs.js` |
| `/js/insights-dashboard.js` | `renderInsightsDashboard` | insights view |

Stub source lives in `templates/dashboard/stubs/*.js` (`proMissing` / `proUnavailable` variants); `lib/dashboard-pro-assets.js` resolves stub vs Pro file at request time.
