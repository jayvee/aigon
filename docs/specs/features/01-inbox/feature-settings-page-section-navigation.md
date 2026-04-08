# Feature: settings-page-section-navigation

## Summary
Consolidate the dashboard's current `Settings` and `Config` surfaces into one `Settings` screen with in-page section navigation. The goal is to make the settings area easier to understand and to remove the ambiguity between two top-level tabs that both describe configuration-like concepts. The page should keep the current side-by-side compare pattern so users can see global defaults, repository overrides, and effective values together.

## User Stories
- As a user, I want one obvious place to manage dashboard settings, so I do not have to decide between `Settings` and `Config`.
- As a user, I want the settings page divided into named sections, so I can jump directly to the part I need.
- As a user, I want the repo-level settings comparison to stay side by side, so I can see the default, override, and effective values at the same time.
- As a user on a smaller screen, I want the same information to remain navigable without the page becoming an overwhelming wall of controls.

## Acceptance Criteria
- The dashboard exposes a single top-level `Settings` tab.
- The separate top-level `Config` tab is removed.
- The `Settings` page has in-page navigation to reach each section without changing screens.
- The visible sections use specific user-facing names, not the generic label `Config`.
- Repository management remains available and still supports the current add/remove/visibility behavior.
- Notification controls remain available and retain their current behavior.
- Model settings remain visible in a compare layout with `Default`, `Override`, and `Effective` columns.
- The config-related area keeps the current side-by-side pattern, so global defaults, repo overrides, and the resolved value are visible together.
- The section navigation remains usable on the current dashboard width and degrades cleanly on narrower screens.
- Existing settings data flows, save behavior, and stored values are preserved.

## Validation
```bash
node -c templates/dashboard/js/settings.js
node -c templates/dashboard/js/init.js
node -c templates/dashboard/index.html
```

## Technical Approach
1. Merge the separate `Config` top-level tab into `Settings`.
2. Keep the existing settings read/write logic intact.
3. Introduce in-page section navigation inside `Settings` so the page is broken into clear named areas.
4. Preserve the compare layout for values that have global defaults, repo overrides, and effective results.
5. Use section names that describe the content directly:
   - `Repositories`
   - `Notifications`
   - `Models`
   - a config-related section name that explicitly describes global defaults and repository overrides
6. Make the navigation responsive:
   - desktop: a left-side rail or similar anchored section navigator
   - mobile: a compact stacked or tabbed treatment that does not consume too much vertical space
7. Update any dashboard docs or screenshots that reference the old top-level split between `Settings` and `Config`.

## Dependencies
- None

## Out of Scope
- Changing the underlying settings schema or config file format
- Reworking how values are saved or loaded
- Changing notification transport or repo registration behavior
- Refactoring unrelated dashboard tabs such as Logs, All Items, Monitor, or Pipeline

## Open Questions
- What exact label should be used for the config-related section now that `Config` is no longer a top-level tab?
- Should the in-page navigator be a left rail on desktop, or should it become a stacked set of anchored section links?
- Should the existing compare table styling be kept as-is, or tightened slightly to make the side-by-side values clearer?

## Related
- Research:
