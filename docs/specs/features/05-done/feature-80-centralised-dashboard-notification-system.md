# Feature: Centralised Dashboard Notification System

## Summary

Replace the scattered notification code (raw `osascript` calls in shared.js, `sendMacNotification()` in utils.js, Claude Code notification hooks) with a single notification system owned by the AIGON server process. All notification events are routed through one function, persisted to a log, and delivered via macOS notifications when the dashboard is running. The user can configure notification preferences (which event types, enable/disable) from the Settings view in the dashboard. Notifications only fire while the dashboard is running — this is an explicit design choice, not a limitation.

## User Stories

- [ ] As a user, I get macOS notifications for agent status changes (waiting, submitted, all-submitted) only when the dashboard is running, and I understand this is the deal
- [ ] As a user, I can configure which notification types I receive from the dashboard Settings view (e.g., disable "waiting" notifications but keep "all submitted")
- [ ] As a user, I can turn off all macOS notifications from the dashboard Settings view without editing code or config files
- [ ] As a user, I see a history of recent notification events in the dashboard even if I missed the macOS popup

## Acceptance Criteria

### Phase 1: Remove scattered notification code

- [ ] Remove all raw `osascript -e 'display notification ...'` calls from `lib/commands/shared.js` (feature-autopilot monitor loop ~L3149, ~L3169, research-autopilot monitor loop ~L3428, ~L3446, conductor daemon ~L3540)
- [ ] Remove the Claude Code `Notification` hook injection from `feature-setup` in `lib/utils.js` (~L5019-L5028)
- [ ] `sendMacNotification()` in `lib/utils.js` remains as the single low-level delivery function — all other code that wants to notify must call through the central system
- [ ] `node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done` passes
- [ ] `npm test` passes
- [ ] Grep confirms zero `osascript.*display notification` calls outside of `sendMacNotification()`

### Phase 2: Central notification system in the dashboard

- [ ] New function `emitNotification(type, message, meta)` in the AIGON server code that:
  - Checks user's notification preferences (from global config) before firing
  - Calls `sendMacNotification()` if the notification type is enabled
  - Appends the event to an in-memory ring buffer (max 100 events) for the dashboard UI
  - Logs the event to the dashboard log file
- [ ] Notification types: `agent-waiting`, `agent-submitted`, `all-submitted`, `all-research-submitted`, `error`
- [ ] The `pollStatus()` function in `lib/utils.js` calls `emitNotification()` instead of `sendMacNotification()` directly
- [ ] Autopilot monitor loops in `shared.js` print to console only (they already do this) — no macOS notifications from autopilot (the dashboard poll loop handles it)

### Phase 3: Settings UI

- [ ] New "Notifications" section in the dashboard Settings view
- [ ] Master toggle: "Enable macOS notifications" (on/off)
- [ ] Per-type toggles for each notification type (all default to on)
- [ ] Settings persisted to `~/.aigon/config.json` under a `notifications` key, e.g.: `{ "notifications": { "enabled": true, "types": { "agent-waiting": true, "agent-submitted": false, "all-submitted": true } } }`
- [ ] Settings changes take effect immediately (no dashboard restart needed)
- [ ] Settings UI uses the existing dashboard styling (`.settings-section`, `.settings-area` patterns)

### Phase 4: Notification history in dashboard

- [ ] New endpoint `GET /api/notifications` returns the in-memory ring buffer as JSON
- [ ] Dashboard UI shows a notification bell icon in the header with unread count badge
- [ ] Clicking the bell opens a dropdown/drawer showing recent notification events with timestamp, type, and message
- [ ] Opening the drawer marks all as read (badge resets)
- [ ] Notification history does NOT persist across dashboard restarts (in-memory only — localStorage persistence is a future feature if needed)

## Validation

```bash
node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done
npm test
# Verify no stray osascript notification calls remain
! grep -r "osascript.*display notification" lib/ --include="*.js" | grep -v sendMacNotification
```

## Technical Approach

### Architecture

```
  Autopilot loops (shared.js)     ──→ console.log only (no notifications)
  Dashboard pollStatus() loop     ──→ emitNotification(type, msg, meta)
                                         │
                                         ├─→ check config.notifications.types[type]
                                         ├─→ if enabled: sendMacNotification()
                                         ├─→ append to notificationBuffer[]
                                         └─→ log to dashboard log file
```

### Config storage

Add `notifications` key to `~/.aigon/config.json` (read via `loadGlobalConfig()`, written via `saveGlobalConfig()`):

```json
{
  "notifications": {
    "enabled": true,
    "types": {
      "agent-waiting": true,
      "agent-submitted": true,
      "all-submitted": true,
      "all-research-submitted": true,
      "error": true
    }
  }
}
```

Defaults: all enabled. Missing keys treated as enabled (additive — new event types automatically notify until explicitly disabled).

### Dashboard API

- `GET /api/notifications` — returns `{ events: [...], unreadCount: N }`
- `POST /api/notifications/read` — marks all as read
- `GET /api/settings/notifications` — returns current notification config
- `POST /api/settings/notifications` — updates notification config (partial merge into global config)

### Settings UI

Add a "Notifications" section to the existing `renderSettings()` function in `index.html`. Use toggle switches matching the existing dashboard styling. Master toggle disables all; per-type toggles are greyed out when master is off.

### What happens to autopilot without notifications?

The autopilot monitor loops (`feature-autopilot`, `research-autopilot`) already print status tables to the terminal every poll cycle. They continue doing this. They stop firing their own `osascript` notifications. If the dashboard is also running, the dashboard's poll loop will detect the same status changes and fire notifications through the central system. If the dashboard is NOT running, the user sees the status in the autopilot terminal output but gets no macOS notification — which is acceptable because they're already watching the autopilot terminal.

### Work order

1. Phase 1 first (remove scattered code) — leaves the system with only the dashboard `pollStatus()` notifications working, which is already the most reliable path
2. Phase 2 (central system) — refactor the remaining `pollStatus()` notifications to go through `emitNotification()`
3. Phase 3 (settings UI) — add config and UI
4. Phase 4 (notification history) — add bell icon and drawer

Each phase leaves the system in a working state.

## Dependencies

- None — uses existing dashboard infrastructure, global config, and `sendMacNotification()`

## Out of Scope

- Notification sound
- Notification persistence across dashboard restarts (use in-memory ring buffer only)
- Push notifications when dashboard is NOT running (explicit design choice)
- Notification filtering by repo
- Click-to-navigate from notification history to feature card (future enhancement)
- The existing `feature-dashboard-notification-drawer` spec in inbox (this feature supersedes it — that spec should be closed)

## Open Questions

- Should `terminal-notifier` vs `osascript` preference be a user setting, or keep the current auto-detect? (Recommendation: keep auto-detect, it works fine)

## Related

- Feature 70: dashboard-infrastructure-rebuild (replaced radar with foreground dashboard)
- Research 11: radar-dashboard-radical-simplification
- `feature-dashboard-notification-drawer` in inbox (superseded by Phase 4 of this feature)
- `sendMacNotification()` in `lib/utils.js:2139`
- Dashboard Settings view in `templates/dashboard/index.html`
