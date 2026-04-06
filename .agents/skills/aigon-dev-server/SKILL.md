---
name: aigon-dev-server
description: Manage dev server - start, stop, logs, list
---

# aigon-dev-server

Manage the dev server for the current project. Handles port allocation, process lifecycle, proxy registration, and log viewing.

> **CRITICAL:** NEVER run `npm run dev`, `next dev`, or any dev command directly. ALWAYS use `aigon dev-server start`. Running the dev command directly bypasses port allocation and will cause port conflicts in worktrees.

## Usage

Run the appropriate subcommand based on what's needed:

### Start the dev server

```bash
aigon dev-server start
```

This will:
- Allocate a unique port (each agent gets its own offset from the project's base port)
- Start the dev server process in the background with `PORT=<allocated>`
- Register with the local proxy for a custom subdomain URL (e.g. `http://cx-121.myapp.test`)
- Wait for the server to become healthy
- Print the URL to access the app — **always use this URL**

### Check dev server logs

```bash
aigon dev-server logs
```

Use `-f` to follow logs in real time:

```bash
aigon dev-server logs -f
```

### Stop the dev server

```bash
aigon dev-server stop
```

### List all running dev servers

```bash
aigon dev-server list
```

### Open in browser

```bash
aigon dev-server open
```

Opens the dev server URL in the default browser. Uses the proxy subdomain URL if available, otherwise falls back to localhost.

You can also auto-open when starting the server:

```bash
aigon dev-server start --open
```

### Get the URL for the current context

```bash
aigon dev-server url
```

Prints the proxy subdomain URL (or localhost fallback) for use in testing and browser access.

## Notes

- The dev server command is read from `devProxy.command` in `.aigon/config.json` (default: `npm run dev`)
- Port is allocated automatically — agents get offsets from the base port (cc=+1, gg=+2, cx=+3, cu=+4)
- The base port is configured per-project in `.aigon/config.json` (devProxy.basePort). Worktree agents get offsets from this.
- If the proxy is running (`aigon proxy install`), the server gets a named URL like `http://cx-121.myapp.localhost`
- Without the proxy, it falls back to `http://localhost:<port>`
- Use `aigon dev-server logs` to diagnose startup issues — all stdout/stderr is captured
- To check what's running: `aigon dev-server list` shows all active servers with their ports and URLs
