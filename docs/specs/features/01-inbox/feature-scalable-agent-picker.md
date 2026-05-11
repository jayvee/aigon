---
complexity: medium
---

# Feature: scalable-agent-picker

## Summary

The `aigon setup` wizard's **Step 3: Agents** picker currently shows every registered agent as an equal-weight checkbox, regardless of whether the agent CLI is installed on the host. With 6 agents today that already produces a visually flat list where the user can't quickly tell what they already have. With 20 agents (a believable future), it becomes a wall of indistinguishable rows. Redesign the picker so:

1. **Installed agents are visually distinct and listed at the top** — clearly marked as already present, version-stamped, pre-selected-OFF by default (the wizard's job is to install missing agents; reinstalling existing ones is the override path).
2. **Uninstalled agents are listed below the installed group, subtly indicated** — present and selectable but visually lower-emphasis, not competing for attention.
3. **The picker scales to many agents without consuming half the screen** — when the agent count exceeds N, uninstalled agents collapse behind a "Show N more agents to install" expander, with search/filter once the count is bigger still.

This is a pure UX feature in `lib/onboarding/wizard.js` Step 3. No engine, dashboard, or CLI-command surface changes.

## User Stories

- [ ] As a returning user with Claude Code, Gemini, and Codex already installed, when I run `aigon setup --resume` I see those three agents at the top, marked `✓ installed v…`, deselected by default, and the four-or-more uninstalled agents listed below in a clearly secondary visual treatment.
- [ ] As a new user on a fresh machine, I see all agents in one list because none are installed — no two-section split for an empty installed group, no empty-state clutter.
- [ ] As an Aigon maintainer adding a 7th, 12th, 20th agent to the registry, the picker keeps working without becoming visually overwhelming — uninstalled agents past a threshold collapse behind an expander.
- [ ] As a user reinstalling an installed agent (rare — usually because the CLI auto-updates or I want a clean re-auth), I can tick the installed row to add it to the install batch.
- [ ] As a user scanning the list, I can immediately tell which agents are installed vs which aren't without hovering or focusing any single row.

## Acceptance Criteria

### Layout

- [ ] When `installedCount > 0` AND `uninstalledCount > 0`: the picker renders **two visually-separated groups** within the same multiselect (a Clack separator row between them, or a heading like `── installed ──` / `── available to install ──`).
- [ ] When `installedCount === 0` OR `uninstalledCount === 0`: render a **single flat list** — no empty group header, no separator.
- [ ] Installed agents appear **first**; uninstalled agents appear **second**. Order within each group preserves the agent-registry order (no alphabetical re-sort).
- [ ] Installed agent rows render with the existing `✓ installed v<version>` suffix in the label (already shipped). Uninstalled rows render with just the label.
- [ ] Initial selection: installed = none ticked; uninstalled = all ticked. (User can override.)

### Visual emphasis for uninstalled rows

- [ ] Uninstalled rows render in a **dimmer style** than installed rows so the user's eye reads "these are the installable extras" rather than "more equally-important checkboxes". Use Clack's `hint` field with a subtle label like `not installed` if no other styling primitive is available, or Clack's group-label feature if it exists.
- [ ] The dimming must not break keyboard navigation, focus highlight, or selectability.

### Collapse threshold for scale

- [ ] When `uninstalledCount > UNINSTALLED_COLLAPSE_THRESHOLD` (default `4`), the uninstalled group is **collapsed by default** behind a single expander row labelled `Show <N> more agents to install ▾`. Selecting that row expands the group inline. Pressing it again collapses.
- [ ] If Clack's multiselect does not support inline collapsible groups, fall back to a `clack.select` pre-step: ask `"Install some additional agents not on this machine?"` (Yes / No / Show list). "No" skips uninstalled entirely; "Show list" routes to a second multiselect populated only with uninstalled agents.
- [ ] When `uninstalledCount > SEARCH_THRESHOLD` (default `10`), the uninstalled group switches from a static list to Clack's `autocompleteMultiselect` so the user can type to filter. Installed agents above remain a static group.

### Empty / degenerate states

- [ ] When **all** registered agents are installed: the picker still shows the installed group with the `(select to reinstall)` hint, no "Available to install" group, and a footer note `All registered agents are already installed.`
- [ ] When **no** registered agents are installed (fresh machine): no group split — single flat list, all rows ticked by default.
- [ ] If the registry is empty, the wizard's existing "No agents registered" path is preserved unchanged.

### Behaviour preservation

- [ ] Same flag wiring as today: `--yes` continues to install nothing.
- [ ] Same install loop downstream: agents the user ticks get installed via `detector.install()`; already-installed ones the user ticks get the "re-installing" no-auth path; agents the user doesn't tick are skipped.
- [ ] The Pro and seed-clone steps that follow are unaffected.

## Validation

```bash
node --check lib/onboarding/wizard.js
# Manual smoke in the authed clean-room snapshot (which has claude + gemini installed):
docker run --rm -it --hostname clean-room aigon-clean-room-authed:local bash -lc '
  sudo npm install -g @senlabsai/aigon@next >/dev/null
  yes "" | aigon setup --resume 2>&1 | grep -A20 "Which AI agents"
'
# Expected output should show installed group + uninstalled group visibly distinct.
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

**Scope of the file change:** only `lib/onboarding/wizard.js` Step 3 (lines around 247-358 — the agents block). Detector code in `lib/onboarding/detectors.js` is unchanged; we already pre-verify each detector and have `verifiedById` per-agent.

**Group separation.** Clack's `multiselect` supports an `options` array with arbitrary entries. There's no native group separator, but the de-facto pattern is to insert a disabled/non-selectable label row in `options` between groups. Check Clack's API:

- `@clack/prompts@1.2.0` ships `groupMultiselect` which is the closest primitive — it accepts `{ groupName: [options] }` and renders each group's name as a header. That's the preferred path. If it doesn't exist on the installed version, fall back to inserting a label row plus deliberate spacing.

**Visual dimming.** Clack renders the `hint` field in dim text after the label. Use it for uninstalled rows: `hint: 'not installed'`. This is enough subtle differentiation when combined with the group split.

**Collapse for scale.** `clack.multiselect` does not support inline collapsible groups. The fallback path is:

```js
if (uninstalledCount > UNINSTALLED_COLLAPSE_THRESHOLD) {
  // Pre-step: ask if the user wants to see the uninstalled list at all.
  const showExtras = await clack.confirm({
    message: `Install any of the ${uninstalledCount} agents not yet on this machine?`,
    initialValue: false,
  });
  if (showExtras) {
    // Second multiselect, only uninstalled agents, optionally autocomplete.
    const picker = uninstalledCount > SEARCH_THRESHOLD ? clack.autocompleteMultiselect : clack.multiselect;
    const extras = await picker({ /* uninstalled only */ });
    selectedAgents = selectedAgents.concat(extras);
  }
}
```

Constants live near the top of the agents block:

```js
const UNINSTALLED_COLLAPSE_THRESHOLD = 4;  // show inline if ≤ 4 uninstalled
const SEARCH_THRESHOLD = 10;               // switch to autocomplete if > 10
```

**Edge cases worth a one-line comment in code:**

- `agentRegistry.getAllAgents()` returns ordered by registration order. Preserve that within each group.
- `verifiedById` may have a `version: null` field; render `✓ installed` without the version suffix in that case (already handled in the existing label-builder).
- A user who has all 20 agents installed should not see an empty "Available to install" group header.

## Dependencies

- None — pure refactor of one wizard step.

## Out of Scope

- Changing what `install-agent` writes (slash commands, config files, hooks). Unchanged.
- Changing the agent registry schema or how `templates/agents/*.json` declare themselves.
- Adding an in-wizard preview of what an agent does (could be a future spec — "show a 1-line description per agent on focus"). Not this feature.
- Dashboard parity. The dashboard has its own agent-picker UI; that's a separate surface and out of scope.
- Persisting user picks for re-runs ("you skipped Kimi last time, skip again?"). Future feature; not this one.

## Open Questions

- Should installed agents that are *out of date* (older than the version `install-agent` would emit) get a distinct third bucket (`⚠ update available`)? Default: no — that's the F498 drift-notice concern, separately surfaced. The picker stays binary (installed / not installed).
- Should the picker remember the previous run's selection? Default: no — `aigon setup --resume` skips completed steps entirely, so this only matters for `--force` re-runs, which are rare enough that "all uninstalled, none selected" is fine.
- Should the threshold constants be configurable via `aigon config`? Default: no — they're internal UX knobs, not user-facing settings.

## Related

- Research: <!-- none — pure UX -->
- Set: <!-- standalone -->
- Prior features in set: <!-- n/a -->
