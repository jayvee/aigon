<!-- description: Manage dev server - start, stop, logs, list -->
# aigon-dev-server

Manage the dev server for the current project. Handles port allocation, process lifecycle, proxy registration, and log viewing.

> **CRITICAL:** NEVER run `npm run dev`, `next dev`, or any dev command directly. ALWAYS use `aigon dev-server start`. Running the dev command directly bypasses port allocation and will cause port conflicts — especially in worktrees where port 3000 is reserved for the main app.

## Usage

Run the appropriate subcommand based on what's needed:

### Start the dev server

```bash
aigon dev-server start
```

This will:
- Allocate a unique port (each agent gets its own offset from the base port — never port 3000 in worktrees)
- Start the dev server process in the background with `PORT=<allocated>`
- Register with the local proxy for a custom subdomain URL (e.g. `http://cx-121.myapp.test`)
- Wait for the server to become healthy
- Print the URL to access the app — **use this URL**, not `http://localhost:3000`

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

### Get the URL for the current context

```bash
aigon dev-server url
```

Prints the proxy subdomain URL (or localhost fallback) for use in testing and browser access.

## Notes

- The dev server command is read from `devProxy.command` in `.aigon/config.json` (default: `npm run dev`)
- Port is allocated automatically — agents get offsets from the base port (cc=+1, gg=+2, cx=+3, cu=+4)
- Port 3000 is the main app. Worktree agents NEVER use port 3000.
- If the local proxy is set up (`aigon proxy-setup`), the server gets a subdomain URL like `http://cx-121.myapp.test`
- Without the proxy, it falls back to `http://localhost:<port>`
- Use `aigon dev-server logs` to diagnose startup issues — all stdout/stderr is captured
- To check what's running: `aigon dev-server list` shows all active servers with their ports and URLs
