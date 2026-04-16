# Feature: rewrite comparisons page

## Summary

Rewrite `site/content/comparisons.mdx` from scratch with a simpler, more defensible comparison model, a curated tool list, and an honest "what Aigon doesn't do" section. Delete `docs/comparisons-extended.md` afterward — single source of truth.

The current page mixes marketing claims, binary dots, and broad competitor buckets. The new page should use concrete observable rows, cover the most relevant competitors first, and lead with what makes Aigon different rather than a feature checklist.

## Design decisions (from research session 2026-04-16)

### Dimensions — concrete, not vibes

Replace the 8-column dot matrix with rows that readers can verify from product docs and demos:

| Dimension | What it captures |
|---|---|
| **Primary unit of work** | Feature spec / task card / session / issue / branch |
| **Source of truth** | Markdown specs / board cards / chat history / IDE project state / hosted workspace |
| **Isolation model** | Git worktrees / branches / cloud sandbox / editor workspace |
| **Multi-agent behavior** | Parallel competition / dependency chains / sequential delegation / single-agent |
| **Evaluation model** | Formal review / rubric / diff review / none |
| **IDE / browser support** | Native IDE, browser testing, TUI, CLI-only, or mixed |
| **Pricing model** | BYO subscriptions / platform fee / usage-based / free |
| **Open source** | Yes / No / Partial |

Dropped from the old matrix: abstract vendor-independence scoring and loose “autonomy” labels that collapse too many distinct behaviors into one cell.

### Tool list (10 + native CLIs)

**Closest competitors:**
- **Cline Kanban** — closest surface-area match. Task-board workflow, parallel agents, dependency chains, worktree isolation. Closest to Aigon on orchestration UI, but task-card-based rather than spec-driven and without Aigon's evaluation/research model.
- **SpecKit** (GitHub) — spec-driven development toolkit. Strong on upstream planning structure (constitution → spec → plan → tasks) but not a multi-agent orchestration system.
- **GSD** — wave-based parallel execution with milestone specs. Nearest OSS competitor on spec execution and dependency ordering.

**Commercial agents:**
- **Cursor** — dominant IDE agent. Strong IDE integration, weaker workflow orchestration than Aigon. Also an Aigon engine via `cu`.
- **Windsurf** — major IDE agent with broad mindshare and tighter editor-native flow than Aigon.
- **Kiro** (AWS) — closest commercial spec-driven comparator. EARS-style specs and task generation, but still an IDE-first product.
- **Devin** — highest-profile autonomous agent. Cloud-first and opaque, with a very different control model.
- **Jules** (Google) — autonomous coding agent in the same broad category as Devin.

**OSS tools:**
- **Roo Code** — OSS IDE extension with custom modes and multi-step agent workflows.
- **Aider** — mature CLI pair programmer with strong git-aware editing.

**Native CLIs column** (not competitors — Aigon's engines):
- Claude Code, Gemini CLI, Codex CLI — single entry showing what they are and aren't.

**Cut from current page:**
- AmpCode (niche, no mindshare)
- Augment Code (enterprise-only, different audience)
- OpenSpec (too small)
- OpenCode (canonical repo archived)

**Not adding (from old spec):**
- GitHub Copilot Workspace (discontinued May 2025)
- LangGraph (framework, not a tool)
- BMad Method (methodology, not a tool)
- Tessl (complementary platform, not competitive)

### What Aigon does differently

- Uses your existing subscriptions — runs through CLIs you already pay for (Claude Max via Claude Code, Gemini via Gemini CLI, etc.)
- Spec-driven lifecycle from idea to done, not just task execution
- Competitive evaluation — agents compete, then a fresh agent picks the winner
- Research and feedback workflows are first-class, not add-ons

### What Aigon doesn't do

- No native IDE extension or embedded editor UI
- No embedded browser testing or visual diffs
- No single-file quick-edit workflow (designed for features, not one-liners)
- No automatic model selection — you always choose which agent/model runs

### Cline Kanban deep comparison

Cline Kanban is the closest competitor and deserves a detailed side-by-side (similar to the current OpenCode treatment). Key differentiators:

- Cline Kanban is a **task board for agent orchestration** — ad-hoc cards, dependency chains, worktree-per-task execution.
- Aigon is a **spec-driven feature lifecycle system** — specs define work, research and feedback are tracked separately, and evaluation chooses the winner.
- Cline is stronger at **board-centric review UX** and direct task visibility.
- Aigon is stronger at **cross-feature lifecycle management**, **research**, **feedback triage**, and **event-sourced state**.
- Both use worktree isolation, but Aigon ties worktrees into a broader workflow engine rather than only a task board.
- The user-facing question is: "Do I want a task board for agents, or a system that manages the whole feature lifecycle?"

## Acceptance Criteria

- [ ] **AC1** — Feature matrix uses concrete observable values, not binary dots
- [ ] **AC2** — Tool list includes exactly: Cline Kanban, SpecKit, GSD, Cursor, Windsurf, Kiro, Devin, Jules, Roo Code, Aider, + Native CLIs column
- [ ] **AC3** — Each tool has a short prose entry with "How you work" / "Choose X when" / "Choose Aigon when"
- [ ] **AC4** — "What Aigon does differently" section present (BYO subscriptions, spec lifecycle, competitive eval)
- [ ] **AC5** — "What Aigon doesn't do" section present (no native IDE extension, no browser testing, no quick-edit, no auto model selection)
- [ ] **AC6** — Cline Kanban gets a detailed side-by-side comparison (the closest competitor)
- [ ] **AC7** — Native CLIs (Claude Code, Gemini CLI, Codex) appear as a single column/entry explaining they are engines Aigon orchestrates, not competitors
- [ ] **AC8** — `docs/comparisons-extended.md` is deleted
- [ ] **AC9** — `npm run --prefix site build` succeeds
- [ ] **AC10** — Visual check: render locally and confirm layout

## Validation

```bash
cd site && npm run build && cd ..
! test -f docs/comparisons-extended.md
```

## Technical Approach

1. Rewrite `site/content/comparisons.mdx` from scratch — don't patch the existing file
2. Use a concrete comparison matrix as the centrepiece
3. Group tools by workflow type, not just market category
4. Give Cline Kanban the deep side-by-side treatment
5. Keep the "complementary usage" section (Aigon + Cursor, Aigon + Aider, etc.)
6. Delete `docs/comparisons-extended.md` in the same commit
7. Grep for `comparisons-extended` and update any remaining references

## Dependencies

- None — pure docs/content work

## Out of Scope

- Adding new tools beyond the agreed list
- Restructuring the site layout or navigation
- Building interactive comparison widgets
- Re-researching tools from scratch — use existing research + the 2026-04-16 deep research session findings

## Open Questions

- [ ] Should the Cline Kanban side-by-side be a collapsible `<details>` or a full section?
- [ ] Should we link to the research topics (research-21, research-24, research-25) as "further reading"?

## Related

- `docs/comparisons-extended.md` — to be deleted (old extended version)
- `site/content/comparisons.mdx` — rewrite target
- `research-21-coding-agent-landscape.md` — landscape research
- `research-24-roocode-comparison.md` — Roo Code details
- `research-25-opencode-comparison.md` — OpenCode details (now archived, lower priority)
- 2026-04-16 research session — Cline Kanban deep dive, SpecKit discovery, dimension simplification
