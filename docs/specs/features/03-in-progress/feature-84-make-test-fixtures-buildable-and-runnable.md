# Feature: Make test fixtures buildable and runnable

## Summary

The three test fixtures (brewboard, brewboard-api, trailhead) in `test/setup-fixture.js` contain project code that looks realistic but cannot actually be built or run. When using Aigon to implement a backlog feature against a fixture repo, agents immediately hit compile/build errors in the *existing* code — not in the feature they're trying to implement. Each fixture should be a minimal but valid, buildable project so that feature implementation can succeed end-to-end.

## User Stories

- [ ] As a developer testing Aigon's feature workflow, I want `npm run build` to succeed in the brewboard fixture so agents implementing backlog features start from a working baseline
- [ ] As a developer testing Aigon's feature workflow, I want `npm start` to succeed in the brewboard-api fixture so agents can verify their changes against a running server
- [ ] As a developer testing Aigon's feature workflow, I want `swift build` to succeed in the trailhead fixture so agents implementing iOS features start from compilable code

## Acceptance Criteria

- [ ] **brewboard**: After generating the fixture and running `npm install && npx next build`, the build exits 0
  - Add `tsconfig.json` with standard Next.js settings
  - Add minimal `next.config.js` (can be empty export)
  - Ensure all TSX files have valid imports and types
- [ ] **brewboard-api**: After generating the fixture and running `npm install && node src/index.js`, the server starts and `GET /health` returns 200
  - Wire up the beers router in `index.js`
  - Add graceful shutdown so the validation script can stop it
- [ ] **trailhead**: After generating the fixture, `swift build` exits 0 on macOS
  - Fix `Package.swift` to include `.macOS(.v14)` platform (SPM builds for macOS by default)
  - Fix `TrailPin.swift` — `CLLocationCoordinate2D` doesn't conform to `Codable`; use `latitude: Double` / `longitude: Double` instead, or add custom Codable conformance
  - Fix `ContentView.swift` — remove `import MapKit` if not used, or gate behind `#if canImport(MapKit)`
  - Ensure all Swift files compile without warnings
- [ ] **Existing e2e tests still pass**: `npm test` exits 0 — the fixture changes must not break the Aigon spec structure that tests rely on
- [ ] **Fixture quality test**: Add a new e2e test group `fixture buildability` that verifies each fixture's base code is syntactically valid:
  - brewboard: `npx tsc --noEmit` (TypeScript check only, no full Next.js build — fast)
  - brewboard-api: `node --check src/index.js && node --check src/routes/beers.js`
  - trailhead: `swift build` (only on macOS, skip on CI if not available)

## Validation

```bash
npm test
```

## Technical Approach

All changes are in `test/setup-fixture.js` — the fixture generator. No changes to the Aigon CLI itself.

**brewboard (web):**
- Add `tsconfig.json` generation with `{ "extends": "next/tsconfig" }` or inline config targeting `es2017`/`jsx: preserve`
- Add `next.config.js` (empty `module.exports = {}`)
- The existing TSX files are close to valid — just need the config files so TypeScript resolves

**brewboard-api (api):**
- Mount the beers router: `app.use('/api/beers', require('./routes/beers'))`
- This is a one-line fix in the `src/index.js` template string

**trailhead (ios):**
- Add `.macOS(.v14)` to platforms in `Package.swift` — SPM needs a macOS target to build on macOS
- Replace `CLLocationCoordinate2D` in `TrailPin.swift` with plain `latitude: Double` / `longitude: Double` properties — simpler, avoids CoreLocation import issues, and `Codable` works automatically
- Guard MapKit import in `ContentView.swift` or remove it (SPM macOS build won't have MapKit available the same way)

**Test additions:**
- Add a `fixture buildability` test group to `test/e2e.test.js` that runs syntax/type checks on each fixture
- These should be fast (seconds, not minutes) — no full builds, just validation

## Dependencies

- Node.js (already required for tests)
- Swift toolchain (already present if running iOS fixture tests)
- No new npm dependencies

## Out of Scope

- Installing `node_modules` in fixtures as part of setup (too slow, not needed for Aigon tests)
- Making fixtures production-ready (just buildable/runnable)
- Adding more source files beyond what's needed to fix build errors
- Changing the Aigon spec content (features, research, feedback) — those are already excellent

## Open Questions

- Should the `fixture buildability` tests run in CI? Swift may not be available on all CI runners. Likely: skip with a clear message if `swift` isn't on PATH.
- Should we add a `package-lock.json` to the web fixtures for reproducible installs? Probably not — it would bloat the fixture generator and isn't needed for syntax checking.

## Related

- `test/setup-fixture.js` — the fixture generator (only file that needs changes)
- `test/e2e.test.js` — test suite (add new test group)
