<!-- description: Restart the local aigon dashboard server -->
# Restart Aigon Server

Restart the local aigon dashboard server. Useful after editing code in `lib/` or
`templates/` so the running dashboard picks up the change.

```bash
aigon server restart
```

If a launchd/systemd service is installed, this triggers a service restart.
Otherwise it stops the running process (if any) and relaunches on the same port.

Status: `aigon server status` · Logs: `aigon server logs`
