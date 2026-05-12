---
complexity: high
---

# Feature: terminal-background-launch

## Summary

Add a user-configurable option to launch terminal tabs/windows in the **background** (without stealing focus) when aigon opens worktree sessions. Default the new behaviour to background, since the dashboard is the daily command center and being interrupted by a terminal slamming into the foreground every time a feature starts is friction the user doesn't want. Foreground remains an opt-in setting.

The **dashboard settings panel is the canonical surface** for this option — users should not need to touch JSON. JSON storage exists so the setting persists; the dashboard owns the UX.

## User Stories

- [ ] As a dashboard user, when I click "Start" on a feature, the new terminal tab opens silently in the background so I can keep reading the dashboard / writing a spec / continuing my thought, without my window context being yanked away.
- [ ] As a dashboard user, I can flip "Bring terminal to foreground on start" in the dashboard settings panel without leaving the browser. The setting takes effect on the next launch — no server restart, no JSON editing.
- [ ] As a user across macOS terminals (iTerm2, Ghostty, cmux, Apple Terminal, Warp), the background-launch behaviour is consistent — picking a terminal app doesn't change whether focus is stolen.
- [ ] As a Linux user (kitty / gnome-terminal / xterm), the behaviour is whatever my WM already does for newly-spawned windows; aigon doesn't try to override the WM, and the docs say so.
- [ ] (Advanced fallback only) As a power user, I can set the same value in `~/.aigon/config.json` if I'm scripting setup. The dashboard reads from and writes to the same file, so the two stay in sync.

## Acceptance Criteria

- [ ] **Dashboard settings UI is the primary entry point.** A new toggle in the dashboard settings panel ("Bring terminal to foreground when starting a session" — off by default) writes the setting. The toggle is discoverable from the same place users already configure their preferred terminal app — same group, adjacent control.
- [ ] New config key `terminal.focusOnLaunch` accepts `'foreground' | 'background'`. Default: `'background'`. Storage layered: `~/.aigon/config.json` (where the dashboard writes) < `.aigon/config.json` (per-repo override, advanced). Resolved via the existing `getEffectiveConfig()` path in `lib/worktree.js`. Users should rarely if ever edit JSON directly — that path exists for scripting and for power users, not as the default UX.
- [ ] `adapter.launch(cmd, opts)` receives a new `opts.background: boolean` field, threaded from the single call site at `lib/worktree.js:1640` based on the resolved config.
- [ ] **iTerm2 adapter** (`lib/terminal-adapters.js:117-192`): when `background=true`, capture the frontmost app via `System Events` before opening the tab/window, drop the `activate` lines, and re-activate the previous app at the end. Both the primary `create tab` path and the fallback `create window` path are covered. The `_focus` existing-tab path also honours `background` (no `activate`).
- [ ] **Ghostty adapter** (`:193-274`): same capture-frontmost / re-activate-previous pattern applied to both AppleScript paths. The CLI fallback (`ghostty +new-window`) also runs without focusing — investigate whether `ghostty` has a `--background` style flag; otherwise document the limitation.
- [ ] **cmux adapter** (`:275-346`): same pattern.
- [ ] **Apple Terminal adapter** (`:360-393`): same pattern — both the focus-existing path and the new-tab path drop `activate`/`set frontmost to true` when `background=true`, and restore the previous frontmost app.
- [ ] **Warp adapter** (`:84-115`): switch from `execSync('open "warp://launch/..."')` to `execSync('open -g "warp://launch/..."')` when `background=true`. `-g` is the documented macOS `open(1)` flag for "do not bring the application to the foreground."
- [ ] **Linux adapters** (`:347-359`): no code change. The detached `spawn` already delegates focus behaviour to the WM. Add a short paragraph in the docs noting this is WM-controlled and listing common WM focus-stealing-prevention settings.
- [ ] **Dashboard wiring**: the toggle reads current state on settings-panel open and writes via the existing config-write API (or a new endpoint if none exists — implementer to check). Round-trip: flip in dashboard → next "Start" click respects the new value without a server restart.
- [ ] **Focus-existing semantics**: when the user clicks "Open" on a tab that's already attached and `background=true`, the function should still no-op (don't steal focus). Decided in the spec, but document this clearly so the implementer doesn't surface the previous-frontmost-restore as a "blink."
- [ ] Tests: unit test the config resolution (default = background, override = foreground, per-repo wins over user-level). Smoke test each macOS adapter generates the expected AppleScript with/without `activate`. No new Playwright tests required — this is below the dashboard UI layer.
- [ ] Docs: update `docs/architecture.md` or the relevant terminal-adapters doc with the new config key and the "Linux is WM-controlled" note.

## Validation

```bash
```

## Technical Approach

**One knob, threaded through one call site.** The good news is there's exactly one place where adapters are invoked (`lib/worktree.js:1640`), so the config plumbing is small. The bulk of the work is in the per-adapter AppleScript edits and getting the capture-restore-frontmost pattern right.

**Capture-restore-frontmost pattern (macOS):**

```applescript
tell application "System Events"
    set prevApp to name of first process whose frontmost is true
end tell
-- ... do the work that would normally call `activate` ...
if prevApp is not "<TerminalAppName>" then
    tell application prevApp to activate
end if
```

Wrap this as a helper in `terminal-adapters.js` so the four AppleScript-driven adapters (iTerm2, Ghostty, cmux, Apple Terminal) share one implementation. Pass `background` through, build the script with or without the wrapper, run it.

**Warp is the easy one:** `open -g "warp://launch/<name>"` is a one-line guard on `opts.background`.

**Linux is the no-op:** document and move on. The reason it Just Works is that `spawn(..., { detached: true })` doesn't carry an "activate" semantics across the X11/Wayland boundary — focus is decided by the WM's focus-stealing-prevention policy, which is set by the user/distro, not by aigon. Trying to override this from a node process would be both fragile (WM-specific) and unwelcome (it's the user's WM, not ours).

**Default = background:** explicit decision. Reasoning: the dashboard is the always-on surface (per `project_dashboard_always_on`), and starting a feature is a frequent action. Stealing focus on every start is precisely the kind of small papercut the always-on dashboard exists to remove. Foreground stays available as a one-click opt-in for users who *want* to be taken to the new tab.

**Dashboard-first principle:** the dashboard is the canonical surface for settings users actually flip. JSON files are storage, not UX. The toggle lives in the dashboard settings panel; the JSON path is documented but de-emphasised. This matches the broader project stance that the dashboard is where users live and the CLI/JSON layers exist mainly to support scripting and recovery.

**Config schema:**

```json
{
  "terminal": {
    "focusOnLaunch": "background"  // "background" (default) | "foreground"
  }
}
```

Resolution lives in `getEffectiveConfig()`. Reads happen once per launch call in `lib/worktree.js:1626`.

**Per-launch override (out of scope for v1, noted for later):** shift-click on dashboard "Start" → opposite-of-default. Mentioned in Open Questions.

## Dependencies

- None. Self-contained config + adapter changes.

## Out of Scope

- Per-adapter overrides (e.g. "background for iTerm but foreground for Warp"). One global toggle only — adding granularity later is cheap if anyone asks.
- Per-launch override via modifier-click on the dashboard. Nice-to-have, not required for v1.
- Changing Linux WM focus behaviour. Out of aigon's scope; WM-controlled.
- Changing terminal-app **choice** UI. This feature is about *how* the chosen terminal launches, not *which* terminal is chosen.
- Reverse direction: a "force foreground" mode that aggressively raises the window even if the WM/user said no.

## Open Questions

- **Focus-existing path in background mode**: when the user clicks "Open" on an already-attached tab and `background=true`, should the click be a complete no-op, or should it still update tab order / select the tab without raising the window? Proposed: complete no-op (no `select`, no `set index`, no `activate`). Implementer should confirm by trying both and picking the one that doesn't feel like a "ghost flash."
- **Ghostty CLI fallback (`ghostty +new-window`)**: does Ghostty have a no-focus launch flag? If not, the CLI fallback path may unavoidably foreground Ghostty. Document the limitation if so.
- **Warp `open -g` + AppleScript focus restore**: `open -g` should be sufficient on its own. Verify before adding any restore-frontmost dance on the Warp path.
- **Should the dashboard "Open" button (existing-session focus) honour background?** Arguably "Open" implies the user wants to look at the session, so background mode shouldn't apply there. But "Start" (new session) is the common case where background makes sense. Proposal: `background` applies to new launches only; "Open" always foregrounds. Implementer to validate against the user's expectation.
- **Per-launch override via modifier key on dashboard**: worth a follow-up feature?

## Related

- Research:
- Set:
- Prior features in set:
