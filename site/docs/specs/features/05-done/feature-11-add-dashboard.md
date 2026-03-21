# Feature: Aigon Dashboard Showcase

## Summary

Add a prominent new section to the aigon.build website showcasing the Aigon Dashboard — a visual, browser-based interface for managing your spec-driven workflow. Positioned high on the page (after Modes, before the terminal demos), it pitches the dashboard as the alternative entry point for developers who prefer a Kanban-style UI over CLI commands and agent sessions. The section should include screenshots of the Kanban board, monitor view, statistics, and settings, plus highlight the "Use AI" button that launches an agent session directly from the dashboard.

## User Stories

- [ ] As a visitor unfamiliar with CLI tools, I want to see that Aigon has a visual dashboard, so I understand I don't need to live in the terminal to use it.
- [ ] As a visitor, I want to see the Kanban board view, so I can visualise how features move through the workflow (inbox → backlog → in-progress → evaluation → done).
- [ ] As a visitor, I want to see the monitor view, so I understand how Aigon tracks running agents and surfaces attention items.
- [ ] As a visitor, I want to see statistics and settings screens, so I know the dashboard is a complete management tool, not just a board.
- [ ] As a visitor, I want to understand the "Use AI" button, so I can see how the dashboard bridges into agent-powered development — opening a spec on the right while an agent session works on the left.

## Acceptance Criteria

- [ ] A new `#dashboard` section is added to `index.html`
- [ ] The section appears high on the page — after `#modes` and before `#demo` (terminal examples)
- [ ] A nav link "Dashboard" is added in the correct position
- [ ] The section includes at least four screenshots: Kanban view, monitor view, statistics view, and settings
- [ ] The "Use AI" workflow is called out: clicking the button opens a split view with an agent session (e.g. Claude Code) on the left and the feature spec on the right
- [ ] Copy positions the dashboard as the visual alternative to CLI — "same workflow, visual interface"
- [ ] The section follows the existing design language (warm palette, Sora headings, generous whitespace)
- [ ] All images use `loading="lazy"` and have descriptive `alt` text
- [ ] The section is responsive and works on mobile viewports

## Technical Approach

### Placement

Insert the new `#dashboard` section between `#modes` and `#demo` in `index.html`. This puts it front and centre — visitors see the visual dashboard before encountering terminal demos, which is the right order for the "you don't need the CLI" pitch.

Update the `<nav>` to add a "Dashboard" link at the appropriate position.

### Section structure

```
Eyebrow: "Your workflow, visualised"
H2: "A Kanban board for spec-driven development."
Lead paragraph: pitches the dashboard as the visual way to use Aigon —
  same spec-driven workflow, same agents, but through a browser UI
  instead of CLI commands. No terminal required.
```

**Screenshot gallery:** A tabbed or stacked layout showing 4 views:

1. **Kanban Board** — Features as cards moving across columns (inbox, backlog, in-progress, evaluation, done). The primary visual — this is what people see first.
2. **Monitor** — Live agent sessions, attention items, repo status. Shows what Radar surfaces in a richer UI.
3. **Statistics** — Throughput, cycle time, agent leaderboard. (Links to or replaces the existing `#statistics` section.)
4. **Settings** — Configuration, agent setup, repo management.

**"Use AI" callout:** A dedicated card or subsection explaining the workflow:
- Click "Use AI" on any feature card in the Kanban board
- A split view opens: agent session (Claude Code, Cursor, etc.) on the left, the feature spec on the right
- The agent reads the spec and starts working — you watch, guide, or step away
- This is how you bridge from visual management into agent-powered implementation

### Feature cards (below screenshots)

| Card | Heading | Copy |
|------|---------|------|
| Visual Workflow | Drag specs from inbox to done | Move features through your development pipeline with a familiar Kanban interface. Every column maps to an Aigon workflow state — no commands to memorise. |
| Use AI | One click from spec to agent session | Hit "Use AI" on any feature and the dashboard opens a split view: your agent on the left, the spec it's working from on the right. Watch it build, intervene when needed. |
| Monitor | See every agent, every repo, at a glance | The monitor tab shows running sessions, attention items, and recent events across all your repositories — the same data as Radar, in a richer interface. |
| Measure | Throughput, cycle time, agent performance | The statistics tab turns your spec history into metrics. Know which agents ship fastest, how your cycle time trends, and whether your pace is accelerating. |

### Screenshots needed

The following screenshots should be captured from a live Aigon Dashboard instance:

1. `img/aigon-dashboard-kanban.png` — Kanban board with features in multiple columns (busy state preferred)
2. `img/aigon-dashboard-monitor.png` — Monitor view showing active agents and attention items
3. `img/aigon-dashboard-statistics.png` — Already exists, may need updating
4. `img/aigon-dashboard-settings.png` — Settings/configuration view
5. `img/aigon-dashboard-use-ai.png` — The split-view experience: agent session on left, spec on right

### CSS approach

Reuse existing patterns (`.feature-grid`, `.feature-card`, `.menubar-screenshot`). Add minimal new CSS:
- `.dashboard-gallery` — container for the screenshot tabs or stack
- `.dashboard-tab` / `.dashboard-tab--active` — if using tabbed screenshot switching (reuse the existing tab JS pattern from `#demo`)
- `.dashboard-callout` — for the "Use AI" highlight block

### Relationship to existing `#statistics` section

The existing `#statistics` section (currently after `#radar`) covers the same ground as the dashboard's statistics tab. Options:
- **Recommended:** Keep `#statistics` but add a forward-link from the dashboard section ("See detailed metrics below") so the dashboard section stays focused on the visual workflow pitch.
- Alternative: Merge statistics into the dashboard section and remove the standalone section.

## Validation

```bash
# HTML syntax check
python3 -c "from html.parser import HTMLParser; HTMLParser().feed(open('index.html').read())"

# Verify screenshots exist
ls -la img/aigon-dashboard-*.png

# Check nav link exists
grep -c 'href="#dashboard"' index.html
```

## Dependencies

- Screenshots of the Aigon Dashboard in its current state (Kanban, monitor, statistics, settings, Use AI split view)
- The dashboard itself must be running to capture screenshots

## Out of Scope

- Interactive/live dashboard embed (static screenshots are sufficient)
- Removing or restructuring the existing `#statistics` or `#radar` sections (can be done as follow-up)
- Dashboard installation or setup instructions (that's Radar's job)
- Mobile dashboard experience (the dashboard itself is desktop-focused; the website section just needs to be responsive)

## Open Questions

- Should the screenshots use a tabbed switcher (like the terminal demos) or a vertical stack? Recommend: tabbed — it saves vertical space and encourages interaction.
- Should the Kanban screenshot show real feature names from this project, or generic/example ones? Recommend: real ones — it's more authentic and shows the workflow in action.
- Should the "Use AI" screenshot show Claude Code specifically, or keep it agent-agnostic? Recommend: show Claude Code (it's the most recognisable), but mention in copy that it works with any supported agent.

## Related

- Feature 08 (showcase v2.33 features) — added the statistics section
- Feature 10 (Aigon Radar showcase) — the `#radar` section this complements
- Existing `#statistics` section — overlaps with dashboard statistics tab
