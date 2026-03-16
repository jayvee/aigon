# Testing Dashboard Changes

> **Do this first, before writing any code:**
> ```bash
> aigon radar start   # start the worktree's radar daemon
> aigon radar open    # opens http://localhost:420x in your browser
> ```
> Keep that tab open. **Reload it after every change.** The template is read fresh on every request — no restart needed.

The Aigon dashboard (`templates/dashboard/index.html`) is served by the **Radar service** — a Node.js HTTP daemon. It is **not** a web app with a dev server. Do not use `aigon dev-server` or `npm run dev` to test dashboard changes.

## How It Works

- `aigon radar start` spawns the Radar daemon using the current directory's `aigon-cli.js`
- The daemon reads `templates/dashboard/index.html` from the same directory
- This means: starting Radar from a **worktree** serves the worktree's template — your changes are live

## Testing Dashboard Changes in a Worktree

### 1. Start Radar from within the worktree

```bash
aigon radar start
```

Radar detects the worktree context automatically and allocates a dynamic port (from 4201 upward). Output looks like:

```
✅ Radar started (worktree: cc-66)
   API:       http://127.0.0.1:4201/api/status
   Dashboard: http://127.0.0.1:4201
```

Use the URL printed — not the main app's port 4100.

### 2. Open the dashboard

```bash
aigon radar open
```

This opens the dashboard URL in your browser. Radar auto-detects the worktree and resolves the correct port. If the proxy is configured, you'll get a subdomain URL like `http://cc-66.aigon.test`.

### 3. Reload to see changes

After editing `templates/dashboard/index.html`, reload the browser tab — the daemon reads the template fresh on each request, so no restart is needed.

### 4. Stop the worktree Radar instance

```bash
aigon radar stop
```

This stops the worktree's instance without affecting the main Radar service.

## Port Reference

| Context | Port | URL |
|---------|------|-----|
| Main repo | 4100 (fixed) | `http://127.0.0.1:4100` or `http://aigon.test` |
| Worktree | 4201+ (dynamic) | printed on `aigon radar start` |

## Checking What's Running

```bash
aigon radar status
```

## Running the Playwright Dashboard Tests

The `tests/dashboard-statistics.spec.js` tests require a running Radar instance. Set `DASHBOARD_URL` to your worktree's URL:

```bash
DASHBOARD_URL=http://127.0.0.1:4201 npx playwright test tests/dashboard-statistics.spec.js
```

Or if the proxy is set up:

```bash
DASHBOARD_URL=http://cc-66.aigon.test npx playwright test tests/dashboard-statistics.spec.js
```

## Key Facts for Future Agents

- The dashboard is a single-file template at `templates/dashboard/index.html`
- No build step — it's plain HTML/CSS/JS served directly
- Changes are picked up on browser reload (no restart needed)
- The analytics endpoint is `/api/status` — the dashboard fetches it on load
- `aigon radar start` from a worktree is isolated from the main Radar instance
- `aigon radar stop` only stops the instance for the current context (worktree or main)
