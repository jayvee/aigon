---
name: iTerm2 should open tabs not windows
description: iTerm2 adapter opens agent sessions as tabs in one window, not separate windows
type: feedback
---

iTerm2 adapter must open tmux sessions as tabs in the current window, not as separate floating windows.

**Why:** Multiple floating windows per agent was chaotic and hard to organize. User confirmed tabs-in-one-window works well. The old `create window with default profile command` was replaced with `create tab with default profile command` (falling back to new window if none exists).

**How to apply:** Never change the iTerm2 adapter back to creating new windows. The key line is `tell current window to create tab with default profile command`. Also: cmux and tmux -CC control mode were evaluated and rejected — cmux replaces tmux (wrong model for aigon), and -CC creates weird control stream tabs.
