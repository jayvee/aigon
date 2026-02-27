# Feature: dev-server-open

## Summary
Add an `open` subcommand to `aigon dev-server` that opens the default browser to the dev server's URL (e.g., `http://farline.test` or `http://localhost:3001`). Also add an `--open` flag to `aigon dev-server start` to open the browser automatically after the server is healthy.

## User Stories
- [ ] As a developer, I want to type `aigon dev-server open` to quickly open my running dev server in my default browser
- [ ] As a developer, I want `aigon dev-server start --open` to automatically open the browser once the server is ready

## Acceptance Criteria
- [ ] `aigon dev-server open` opens the default browser to the dev server URL for the current context
- [ ] Uses proxy URL (e.g., `http://farline.test`) when proxy is available, falls back to `http://localhost:PORT`
- [ ] `aigon dev-server start --open` opens the browser after the health check passes
- [ ] URL resolution reuses the same logic as the existing `url` subcommand
- [ ] Works on macOS (`open`), Linux (`xdg-open`), and Windows (`start`)
- [ ] Help text is updated to include the new subcommand and flag
- [ ] `node --check aigon-cli.js` passes (syntax valid)

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach
- Add a helper function `openInBrowser(url)` that uses `child_process.execSync` with the platform-appropriate command (`open` on macOS, `xdg-open` on Linux, `start` on Windows)
- Add `open` as a new subcommand in the `dev-server` command handler, reusing the URL resolution logic from the `url` subcommand
- Add `--open` flag parsing in the `start` subcommand, calling `openInBrowser(url)` after a successful health check

## Dependencies
- Existing `getDevProxyUrl()`, `detectDevServerContext()`, and `isProxyAvailable()` functions

## Out of Scope
- Opening specific paths/routes within the app
- Choosing a specific browser

## Open Questions
- None

## Related
- `dev-server url` subcommand (reuses same URL resolution)
