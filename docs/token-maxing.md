# Token Maxing

Aigon helps operators align provider rolling usage windows with their real workday. This is sometimes called "token maxing" in the community.

## Mental Model

Many AI coding assistants on premium plans use **rolling windows** for intensive usage. For example, Claude Pro/Max users report a **~5 hour sliding** cap: the limit is tied to **when you use the product**, not a single fixed clock reset. The window "moves" with your activity.

**Key implications:**
- **Window start:** Your first real interaction of the day often starts (or resets) the relevant clock.
- **Warm-up:** Before deep work, a minimal, legitimate message can start the window so that by the time you need heavy use, the oldest high-usage slice has fallen out of the tail.
- **Multi-block days:** Some operators use two or three intentional blocks (morning, midday, late afternoon) to align multiple rolling windows with their workday.
- **Peak hours:** Usage limits may be stricter or faster to deplete during provider peak hours.
- **Shared quota:** Usage is often shared across surfaces (IDE/terminal, web, mobile).

## The `aigon token-window` Command

```bash
# Send a kickoff nudge to all active agent sessions
aigon token-window

# Use a custom message
aigon token-window --message="Good morning"

# Target only specific agents
aigon token-window --agents=cc,gg

# Preview without sending
aigon token-window --dry-run
```

The command:
1. Discovers all active Aigon-managed tmux sessions.
2. Sends a minimal kickoff message via `lib/nudge.js`.
3. Records the kickoff timestamp to `.aigon/state/last-token-kickoff`.
4. Exposes the timestamp via `/api/budget` as `lastTokenKickoffAt`.

If no sessions are active, the command prints a clear no-op message and exits 0.

## Configuration

Store defaults in `~/.aigon/config.json` under the `tokenWindow` key:

```json
{
  "tokenWindow": {
    "timezone": "Australia/Melbourne",
    "targetAgents": ["cc", "gg"],
    "message": "Checking in to align token window"
  }
}
```

- `timezone` — informational only; Aigon does not enforce scheduling.
- `targetAgents` — empty array means all active agents.
- `message` — default kickoff text.

## Scheduler Setup Examples

Aigon does not ship a long-running scheduler daemon. Use your OS scheduler to invoke `aigon token-window`.

### macOS (launchd)

Create `~/Library/LaunchAgents/com.aigon.token-window.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.aigon.token-window</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/aigon</string>
    <string>token-window</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>5</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/aigon-token-window.out</string>
  <key>StandardErrorPath</key>
  <string>/tmp/aigon-token-window.err</string>
</dict>
</plist>
```

Load with:
```bash
launchctl load ~/Library/LaunchAgents/com.aigon.token-window.plist
```

### systemd timer (Linux)

Create `~/.config/systemd/user/aigon-token-window.service`:

```ini
[Unit]
Description=Aigon token window kickoff

[Service]
Type=oneshot
ExecStart=/usr/local/bin/aigon token-window
```

Create `~/.config/systemd/user/aigon-token-window.timer`:

```ini
[Unit]
Description=Run Aigon token-window at 05:00

[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable with:
```bash
systemctl --user daemon-reload
systemctl --user enable --now aigon-token-window.timer
```

### cron

```bash
# Run at 05:00 local time every day
0 5 * * * cd /path/to/repo && /usr/local/bin/aigon token-window
```

## Observability

After a kickoff, confirm the session is live before heavy work:

- Dashboard `/api/budget` shows `lastTokenKickoffAt`.
- `aigon session-list` shows active tmux sessions.
- Existing budget surfaces (`aigon board`, dashboard budget tab) show provider usage.

## Differences from Heartbeat and Token Exhaustion

- **Heartbeat** (30s touch): display-only liveness for the dashboard. It does not interact with provider limits.
- **Token exhaustion (F308):** Aigon's supervisor detects when an agent hits a hard limit and can pause or failover. This is reactive.
- **Token window:** proactive scheduling to align rolling windows with your workday.

## Caveats and Terms of Service

- **Stay within normal product use.** Do not attempt to circumvent, spoof, or hide provider usage.
- **Provider rules drift.** Do not hardcode assumptions about 5-hour blocks or peak-hour penalties. Provider policies change.
- **Not a guarantee.** Scheduling a kickoff does not guarantee a full block of availability.
- **Third-party tools.** Tools like `ccusage` or Usagebar may provide complementary UIs. Aigon respects the same read paths where already integrated (`lib/budget-poller.js`).
