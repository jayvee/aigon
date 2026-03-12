# Evaluation: Feature 41 - conductor-web-dashboard

**Mode:** Fleet (Multi-agent comparison)
**Evaluator:** cc (anthropic/opus) — same-family bias warning acknowledged for cc evaluation

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-41-conductor-web-dashboard.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-41-cc-conductor-web-dashboard`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-41-cx-conductor-web-dashboard`
- [x] **gg** (Gemini): `/Users/jviner/src/aigon-worktrees/feature-41-gg-conductor-web-dashboard`

## Evaluation Criteria

| Criteria | cc | cx | gg |
|----------|---|---|---|
| Code Quality | 8/10 | 8.5/10 | 7/10 |
| Spec Compliance | 9.5/10 | 9/10 | 7.5/10 |
| Performance | 7/10 | 7.5/10 | 6.5/10 |
| Maintainability | 7.5/10 | 7.5/10 | 7/10 |

All three pass `node --check aigon-cli.js`.

## Detailed Findings

### CSS Budget (spec: under 6KB)

| Agent | CSS Size | Status |
|-------|----------|--------|
| cc | 7.33 KB | Over (+22%) |
| cx | **5.0 KB** | **Under budget** |
| gg | 8.53 KB | Over (+42%) |

Only cx meets the 6KB CSS budget — a notable discipline advantage.

### Spec Criteria Coverage

| Category | cc | cx | gg |
|----------|---|---|---|
| Core Functionality (13 items) | 13/13 | 13/13 | 13/13 |
| Visual Design (14 items) | 13/14 | 12/14 | 12/14 |
| Premium UX Features (9 items) | 9/9 | 9/9 | 9/9 |
| Screenshot Automation (4 items) | 4/4 | 4/4 | 4/4 |
| **Total** | **39/40** | **38/40** | **38/40** |

### Shared Misses (all three)

- **No DOM diffing**: All three do full `innerHTML` replacement every 10s poll. The spec called for "diff response against current DOM state" and "only animate elements that changed (fade-in-up for new items)."
- **Green dot vs checkmark**: Spec says "green static checkmark" for submitted status; all three use a green dot.

### `@layer` CSS Cascade

- **gg**: Only implementation that includes `@layer` (though `reset` and `utilities` layers are empty shells)
- **cc/cx**: No `@layer` — flat CSS rules

### XSS Protection

- **cc**: Full `escHtml()` on all dynamic content — best practice
- **cx**: `escapeForHtmlScript()` for JSON in `<script>` tags — adequate
- **gg**: **No escaping on dynamic HTML** — feature names, agent IDs, and paths are interpolated directly into `innerHTML`. Low risk (localhost + local filesystem data) but poor hygiene.

### Codebase Integration

- **cx**: Best reuse — correctly calls existing functions (`buildTmuxSessionName`, `tmuxSessionExists`, `openTerminalAppWithCommand`, `waitForHealthy`, `shellQuote`, `parseCliOptions`, `getOptionValue`) instead of duplicating
- **cc**: Good CLI integration (arg hints, help text, examples) but duplicates `menubar-render` data-gathering logic
- **gg**: Hoisted shared functions (`readConductorRepos`, `parseFrontMatterStatus`) to module scope — structural improvement, but leaves old nested copies as shadows. Also uses deprecated `url.parse` API.

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths: Highest spec compliance (39/40), precise design system execution (every hex/font/spacing token matches), focus buttons with `/api/focus` endpoint (unique), XSS protection, filter system with clickable summary badges, thorough error handling, good CLI integration
- Weaknesses: CSS 7.33 KB (over budget), filter state resets on every 10s poll (bug), full DOM rebuild with no diffing, duplicates menubar-render logic, dead code (`toastCount`, `elapsed` variables), no `@layer`

#### cx (Codex)
- Strengths: **Only implementation under CSS budget (5.0 KB)**, best codebase reuse (no logic duplication), filter state persisted in localStorage, conservative `nextAction` inference for slash commands, attach-to-terminal endpoint, clean function decomposition, proper error handling
- Weaknesses: No `@layer`, no card shadows (spec called for "layered shadows"), changed responsive grid from auto-fit to fixed 2-column, frontend JS uncommented, no DOM diffing

#### gg (Gemini)
- Strengths: Only implementation with `@layer` CSS cascade, context-aware slash commands (fleet vs solo), attach-to-terminal feature, hoisted shared functions to module scope
- Weaknesses: CSS 8.53 KB (42% over budget), **no XSS escaping** on dynamic HTML, deprecated `url.parse`, dead code (`writeConductorRepos`), fragile Safari screenshot fallback (race condition with `sleep 5`), empty `@layer` shells

## Recommendation

**Winner:** cx (Codex)

**Rationale:**

While cc has the highest raw spec compliance count (39 vs 38), cx wins on overall quality balance:

1. **CSS discipline**: cx is the only implementation that meets the 6KB budget — a hard spec requirement that both cc and gg missed
2. **Best codebase integration**: cx reuses existing functions instead of duplicating menubar-render logic, reducing the maintenance surface
3. **No functional bugs**: cc has the filter-state-reset bug; cx's filter state persists correctly via localStorage
4. **Clean architecture**: Well-decomposed backend functions with single responsibilities
5. **Practical beyond-spec features**: Conservative next-action inference, persistent filter state, and attach-to-terminal add real operator value

cc is a very close second — its visual design precision and XSS protection are exemplary. The focus-button feature is genuinely useful. But the CSS budget miss, filter bug, and duplicated logic tip the balance.

**Cross-pollination:** Before merging cx, consider adopting from cc:
- The `escHtml()` XSS protection function — cx should escape all dynamic content inserted via `innerHTML`
- The `/api/focus` endpoint concept (cx has `/api/attach` which is similar, so this may already be covered)
- The `aria-live` and `aria-label` accessibility attributes on interactive elements
