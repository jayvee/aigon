---
status: submitted
updated: 2026-03-17T14:56:35Z
startedAt: 2026-03-17T14:56:35Z
events:
  - { ts: "2026-03-17T14:56:35Z", status: implementing }
  - { ts: "2026-03-17T14:56:35Z", status: submitted }
---

# Implementation Log: Feature 84 - Make Test Fixtures Buildable and Runnable

## Plan

Fixed all three fixtures (brewboard, brewboard-api, trailhead) so their base code is syntactically valid and buildable. Also fixed a pre-existing FIXTURES_DIR mismatch that was causing all 66 e2e tests to fail.

## Progress

- brewboard: Added tsconfig.json (standalone TS config without next dependency), next.config.js, src/global.d.ts (minimal JSX namespace declaration), fixed layout.tsx to use `unknown` instead of `React.ReactNode` to avoid needing @types/react.
- brewboard-api: Wired up beers router (`app.use('/api/beers', require('./routes/beers'))`) and added SIGTERM/SIGINT graceful shutdown handlers.
- trailhead: Added .macOS(.v14) to Package.swift platforms; replaced CLLocationCoordinate2D with latitude/longitude Doubles in TrailPin.swift; removed unused import MapKit from ContentView.swift and unused import CoreLocation from Hike.swift.
- Fixed FIXTURES_DIR in setup-fixture.js from ~/src/ to test/fixtures/ to match what e2e.test.js expects.
- Added ensureFixtures() call before test groups in e2e.test.js.
- Added 'fixture buildability' test group with 5 tests.

All 66 tests pass.

## Decisions

- Used a src/global.d.ts with a minimal JSX namespace rather than @types/react so tsc --noEmit works without npm install.
- Kept tsc check as "skip if not in PATH" to avoid slow npx downloads in CI.
- Swift build test skips gracefully if not on macOS or swift not in PATH.
- Changed FIXTURES_DIR to test/fixtures/ (the path the e2e tests expect per the comment in setup-fixture.js: "rm -rf test/fixtures && node test/setup-fixture.js").
