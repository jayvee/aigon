# Project Instructions

<!--
  Add project-specific instructions below. Agents read this file at the
  start of every session. These sections are referenced by Aigon workflow
  commands and will NOT be overwritten by `aigon update`.
-->

## Testing
<!-- How to test this project, e.g.:
     - `npm test`
     - `docker compose up -d && npm run test:e2e`
     - `xcodebuild test -scheme MyApp` -->

## Build & Run

To start a development server for this project, always use:

```bash
aigon dev-server start
```

This allocates a unique port, starts the project's dev server (e.g. `npm run dev`), and registers it with the proxy for a named URL. **Never run `npm run dev` or `next dev` directly** — it bypasses port allocation and causes conflicts in worktrees.

> Note: `aigon server` is a different thing entirely — it is Aigon's centralised management server (dashboard UI + supervisor), not this project's dev server. Never use it to preview project changes.

## Dependencies
<!-- How to install dependencies, e.g.:
     - `npm ci`
     - `pip install -r requirements.txt`
     - `pod install` in ios/ directory -->

