# Feature: Dashboard Notification Drawer

## Summary

Add a persistent notification drawer to the Aigon Radar dashboard that accumulates agent status events (waiting, error, all-submitted, auto-eval) and lets the user review and dismiss them. Unlike the current auto-dismissing toasts, the drawer retains history so events aren't missed when the user is away.

## User Stories

- [ ] As a user, I can see all agent events that happened while I was away from the dashboard, so I don't miss anything.
- [ ] As a user, I can dismiss individual notifications or clear all, so the drawer stays relevant.
- [ ] As a user, I can see a badge on the notification icon showing how many unread events there are, so I know if something needs attention without opening the drawer.

## Acceptance Criteria

### Notification bell / trigger
- [ ] A bell icon (or similar) appears in the dashboard header, next to the refresh button.
- [ ] A numeric badge on the bell shows the count of unread notifications. Hidden when count is zero.
- [ ] Clicking the bell toggles a slide-out drawer or dropdown panel.

### Drawer content
- [ ] Each notification shows: timestamp, event type icon, message text (same text as the macOS notification).
- [ ] Event types: `waiting` (warning colour), `error` (red), `all-submitted` (green), `auto-eval` (accent).
- [ ] Notifications are sorted newest-first.
- [ ] Maximum 50 notifications retained (oldest evicted when exceeded).

### Interaction
- [ ] Each notification has a dismiss (X) button to remove it individually.
- [ ] A "Clear all" button at the top of the drawer removes all notifications and resets the badge.
- [ ] Opening the drawer marks all current notifications as "read" (badge resets to zero, but items remain until dismissed).
- [ ] Clicking a notification could optionally scroll to / highlight the relevant feature card in the main grid.

### Persistence
- [ ] Notifications persist across page refreshes via localStorage.
- [ ] Badge count persists across page refreshes via localStorage.

### Integration with existing toasts
- [ ] Toasts continue to fire as they do now (for immediate in-view feedback).
- [ ] Every event that triggers a toast also appends to the notification drawer.

## Technical Approach

### State

```javascript
state.notifications = JSON.parse(localStorage.getItem('aigon.dashboard.notifications') || '[]');
state.notifReadCount = Number(localStorage.getItem('aigon.dashboard.notifReadCount') || '0');
```

Unread count = `state.notifications.length - state.notifReadCount`.

### Adding notifications

In the `poll()` function, alongside `showToast()`, call:

```javascript
function addNotification(type, message, featureKey) {
  state.notifications.unshift({ id: Date.now(), type, message, featureKey, time: new Date().toISOString() });
  if (state.notifications.length > 50) state.notifications.pop();
  localStorage.setItem('aigon.dashboard.notifications', JSON.stringify(state.notifications));
  renderNotifBadge();
}
```

### Drawer HTML

Injected next to the refresh button. Toggle visibility with a CSS class. Styled consistently with existing `.card` / `.toast` patterns.

### CSS

Drawer slides in from the right or drops down from the bell. Uses existing `--bg-elevated`, `--border-subtle` tokens. Each notification row uses the same status colour coding as the main grid (`.waiting`, `.error`, etc.).

## Validation

```bash
node -c aigon-cli.js && node -c lib/utils.js
```

Manual checks:
- Trigger a waiting state on an agent — notification appears in drawer and as toast
- Close dashboard, wait for events, reopen — notifications are retained from localStorage
- Dismiss individual and clear all — verify localStorage updates
- Badge count increments on new events, resets when drawer is opened

## Dependencies

- None (extends existing dashboard template)

## Out of Scope

- Server-sent events or WebSocket push (still uses polling)
- Notification sound
- Filtering notifications by type or repo
- macOS notification click-to-open (already implemented separately via `terminal-notifier` upgrade)

## Related

- Feature 57: control-surface-dashboard-operator-console (the dashboard this extends)
- `sendMacNotification()` in `lib/utils.js` (server-side notifications, now with `terminal-notifier` support)
- Dashboard toast system in `templates/dashboard/index.html`
