# Implementation Log: Feature 247 - settings-page-section-navigation

## Plan
- Merge the separate `Config` top-level dashboard tab into `Settings`.
- Preserve the current side-by-side compare layout for defaults, overrides, and effective values.
- Add in-page section navigation so `Settings` can scale without becoming a long undifferentiated page.
- Replace the old sidebar-driven config targeting with an in-page scope selector that can switch between `All repos` and a specific repository.

## Progress
- Refactored the dashboard so `Settings` is now the only top-level settings surface.
- Added a section rail with four named sections: `Repositories`, `Notifications`, `Models`, and `Defaults & Overrides`.
- Folded the old config editor content into the unified Settings screen.
- Kept the compare-table pattern intact for both model settings and defaults/override settings.
- Added a scope selector inside Settings so the user can compare `All repos` or a specific repository without using a separate `Config` screen.
- Removed the old `config` view routing and local-storage view state now migrates `config` to `settings`.
- Updated the dashboard reference docs to describe Settings as the unified settings surface.
- Verified the unified Settings screen in the browser and captured screenshots for the merged view and repo-scoped compare state.

## Decisions
- Kept the existing compare model instead of introducing a separate "effective settings" page. The right answer here was to keep `Default`, `Override`, and `Effective` visible together.
- Used `Defaults & Overrides` as the config-related section name. It is specific enough to describe the content without reintroducing the generic `Config` label.
- Used an in-page section rail on desktop instead of more top-level tabs. This keeps the settings area navigable while preserving one settings surface.
- Reused the current settings APIs and save flows. This feature changes presentation and navigation, not the underlying schema.
- Switched from the old repo-sidebar dependency in Config to an in-page scope selector so the unified Settings page remains self-contained.
