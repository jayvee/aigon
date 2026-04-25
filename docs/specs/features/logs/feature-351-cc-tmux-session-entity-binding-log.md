# Implementation Log: Feature 351 - tmux-session-entity-binding
Agent: cc

Sidecar gains `category` + `tmuxId` + `shellPid` (captured via `tmux display-message -p '#{session_id}\\t#{pane_pid}'` after `new-session`); `loadSessionSidecarIndex`/`pruneStaleSessionSidecars` now key on `tmuxId` when present (fallback to name); `repo`-category sidecar is written for `/api/session/ask`; `resolveTmuxTarget(tmuxId, fallbackName)` helper added; `aigon session-list` prints the table from spec; deferred: snapshot `sessions[]` array (engine-managed snapshot) and migrating existing send-keys/attach call sites to `resolveTmuxTarget`.
