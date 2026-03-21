# Feature: menubar-showcase

## Summary

Add a section to the Aigon website showcasing the Conductor Menubar feature — a macOS menubar icon that shows live agent status across all repos and lets you jump directly to running terminals with one click.

## User Stories

- [ ] As a visitor, I want to see what the menubar looks like in action so I can understand the value before installing
- [ ] As a visitor, I want to understand the setup steps (install SwiftBar, register repos, install plugin) in a clear visual flow

## Acceptance Criteria

- [ ] New section on the site titled "Menubar: Always-on Agent Status" (or similar)
- [ ] Screenshot or mockup showing the menubar expanded with repos, features, and agent status lines
- [ ] Brief description: what it shows (running/waiting counts), what click does (opens terminal), what option-click does (copies command)
- [ ] Setup steps shown as a clean code block: `brew install --cask swiftbar` → `aigon conductor add` → `aigon conductor menubar-install`
- [ ] Positioned alongside or after the existing VS Code sidebar and terminal board sections
- [ ] Visual showing the xbar/SwiftBar menu format with status icons (○ ● ✓)

## Technical Approach

- Add a new section to `index.html` in the features/workflow area
- Include a static screenshot or styled HTML mockup of the menubar dropdown
- Reuse existing site styling patterns

## Related

- Aigon feature #39: conductor-menubar (the feature being showcased)
- Existing site sections for VS Code sidebar and Kanban board
