<!-- description: Restart the Aigon dashboard server (use after editing lib/*.js) -->
# Restart Server

Restart the Aigon dashboard server. Required after any edit to `lib/*.js` — the server does not hot-reload.

```bash
aigon server restart
```

Notes:
- Dashboard runs at http://localhost:4100.
- No hot-reload — you must restart to pick up backend changes.
- Does NOT open a new browser tab; reload your existing one.
