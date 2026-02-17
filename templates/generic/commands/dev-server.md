<!-- description: Manage dev server - start, stop, logs, list -->
# aigon-dev-server

Manage the dev server for the current project. Handles port allocation, process lifecycle, proxy registration, and log viewing.

## Usage

Run the appropriate subcommand based on what's needed:

### Start the dev server

```bash
aigon dev-server start
```

This will:
- Allocate an available port
- Start the dev server process in the background
- Register with the local proxy (if set up) for a subdomain URL
- Wait for the server to become healthy
- Print the URL to access the app

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

## Notes

- The dev server command is read from `devProxy.command` in `.aigon/config.json` (default: `npm run dev`)
- Port is allocated automatically and passed to the process via the `PORT` environment variable
- If the local proxy is set up (`aigon proxy-setup`), the server gets a subdomain URL like `http://cc-119.myapp.test`
- Without the proxy, it falls back to `http://localhost:<port>`
- Use `aigon dev-server logs` to diagnose startup issues — all stdout/stderr is captured
