---
status: waiting
updated: 2026-03-17T06:05:50.339Z
startedAt: 2026-03-17T05:53:01.061Z
events:
  - { ts: "2026-03-17T05:53:01.061Z", status: implementing }
  - { ts: "2026-03-17T05:55:38.757Z", status: implementing }
  - { ts: "2026-03-17T06:05:50.339Z", status: waiting }
---

# Implementation Log: Feature 80 - centralised-dashboard-notification-system
Agent: cc

## Plan

All four phases implemented in one pass:
1. Remove scattered `osascript` calls from `shared.js` (autopilot loops, conductor daemon) and `feature-setup` CC hook in `lib/utils.js`
2. Add `emitNotification()` + `notificationBuffer` to `runDashboardServer`, update `pollStatus()` to use it
3. New API routes + Notifications settings section in Settings view with master toggle and per-type toggles
4. Bell icon with unread badge in header, notification drawer with event history and click-to-monitor

## Progress

**`lib/commands/shared.js`** — removed 4 `osascript` try/catch blocks from feature-autopilot and research-autopilot monitor loops, removed the `sendNotification()` function and its two call sites from the conductor daemon (replaced with `log()` entries).

**`lib/utils.js`** — removed the CC `Notification` hook injection block from `feature-setup` (~L5019-5028). In `runDashboardServer`: added `notificationBuffer`, `notificationUnreadCount`, `notificationIdSeq`, `getNotificationConfig()`, `emitNotification()`. Changed `globalConfig` from `const` to `let` for live reload. Updated `pollStatus()` to call `emitNotification()` with typed events and meta. Added 4 API routes: `GET /api/notifications`, `POST /api/notifications/read`, `GET /api/settings/notifications`, `POST /api/settings/notifications`.

**`templates/dashboard/index.html`** — added notification CSS (bell button, badge, slide-in drawer, toggle switches). Added bell icon to `.meta` header bar. Added notification drawer + overlay HTML. Added Notifications section to `renderSettings()` with `loadAndRenderNotifToggles()`. Added notification JS: `renderNotifList()`, `updateBadge()`, `loadNotifications()`, `openNotifDropdown()`, badge polling every 30s. Fixed `align-items:center` on `.meta`. Added repo name to notification type label and click-to-monitor on notification items.

All tests pass (2 pre-existing failures unrelated to this feature).

## Decisions

- **`globalConfig` as `let`** — allows `POST /api/settings/notifications` to `loadGlobalConfig()` immediately after saving, so changes take effect without a dashboard restart.
- **Raw config file for saving notifications** — reads `~/.aigon/config.json` directly before updating the `notifications` key, to avoid persisting computed defaults (`terminal`, `agents`) back to the file.
- **Ring buffer** — `push()` + `shift()` at max 100 items; simple and sufficient.
- **Conductor daemon** — `sendNotification()` removed entirely; the daemon is a legacy background process, `pollStatus()` in the dashboard is the authoritative source.
- **Transition-only notifications** — `pollStatus()` only emits on status *transitions* (requires a previous state). Agents already in `waiting` when the dashboard starts won't trigger a notification on the first poll — this is by design (same as the original behaviour).
- **Click-to-monitor** — clicking a notification item closes the drawer and navigates to Monitor view rather than opening an external URL, since the notification is already in the dashboard context.
