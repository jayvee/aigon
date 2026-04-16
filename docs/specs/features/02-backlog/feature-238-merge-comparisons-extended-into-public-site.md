# Feature: rewrite comparisons page

## Summary

Rewrite `site/content/comparisons.mdx` from scratch with a simplified dimension model, a curated tool list, and an honest "what Aigon doesn't do" section. Delete `docs/comparisons-extended.md` afterward — single source of truth.

The current page has 9 tools with an 8-dimension binary matrix (dots). The new page uses ~5 philosophy-style dimensions (every cell is a word/phrase, not a dot), covers 10 tools + a native CLIs column, and leads with what makes Aigon different rather than a feature checklist.

## Design decisions (from research session 2026-04-16)

### Dimensions — philosophy, not checkboxes

Replace the 8-column dot matrix with dimensions that capture *style*:

| Dimension | What it captures |
|---|---|
| **Agent model** | Single / parallel fleet / sequential multi / wave-based / fully hosted |
| **How you work** | Spec lifecycle / task cards / ad-hoc prompting / pair programming / task delegation |
| **Autonomy** | Iterate loops / dependency chains / autonomous hooks / fully autonomous / interactive |
| **Work isolation** | Git worktrees / cloud sandbox / working directory / branches |
| **Cost model** | BYO subscriptions / platform fee / free / usage-based |
| **Open source** | Yes / No / Partial |

Dropped from old matrix: vendor independence (overlaps with agent model), IDE integration (moved to "doesn't do"), research workflows / feedback loop / structured evaluation (all absorbed into agent model — they're aspects of multi-agent orchestration).

### Tool list (10 + native CLIs)

**Closest competitors:**
- **Cline Kanban** — #1 comparison. Worktree-per-task kanban, parallel agents, dependency chains. Closest to Aigon but task-card-based, not spec-driven. No evaluation step.
- **SpecKit** (GitHub) — 88k stars, spec-driven development toolkit. Structures upstream thinking (constitution → spec → plan → tasks) but single-agent, no fleet/eval.
- **GSD** — Wave-based parallel execution with milestone specs. Nearest OSS competitor on multi-agent + spec.

**Commercial agents:**
- **Cursor** — Dominant IDE agent. Polar opposite philosophy (all-in-one IDE). Also an Aigon engine via `cu`.
- **Windsurf** — Second IDE agent, enough mindshare to matter.
- **Kiro** (AWS) — Closest spec-driven commercial competitor. EARS notation, autonomous hooks.
- **Devin** — Highest-profile autonomous agent. Cloud-only, opaque. Clean philosophical contrast.
- **Jules** (Google) — Google's autonomous agent, same tier as Devin.

**OSS tools:**
- **Roo Code** — OSS multi-agent IDE extension, 30k+ stars. Sequential multi-agent with custom modes.
- **Aider** — Gold standard CLI pair programmer. 42k stars.

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
- Competitive evaluation — agents compete, a fresh agent picks the winner

### What Aigon doesn't do

- No IDE integration (CLI + slash commands only)
- No embedded browser testing or visual diffs
- No single-file quick-edit workflow (designed for features, not one-liners)
- No automatic model selection — you always choose which agent/model runs

### Cline Kanban deep comparison

Cline Kanban is the closest competitor and deserves a detailed side-by-side (similar to the current OpenCode treatment). Key differentiators:

- Cline Kanban is a **task runner with a board** — ad-hoc cards, dependency chains, auto-commit
- Aigon is a **feature lifecycle manager** — specs define work, agents compete, evaluation picks the best
- Cline has better review UX (inline diffs with PR-style comments on the board)
- Aigon has deeper lifecycle (spec stages, research workflows, analytics, event-sourced state)
- Both use worktrees; Cline symlinks node_modules (nice touch)
- The question for users: "Do I need spec-driven lifecycle management, or do I just need to run agents in parallel?"

## Acceptance Criteria

- [ ] **AC1** — Feature matrix uses philosophy-style values (words/phrases), not binary dots
- [ ] **AC2** — Tool list includes exactly: Cline Kanban, SpecKit, GSD, Cursor, Windsurf, Kiro, Devin, Jules, Roo Code, Aider, + Native CLIs column
- [ ] **AC3** — Each tool has a short prose entry with "How you work" / "Choose X when" / "Choose Aigon when"
- [ ] **AC4** — "What Aigon does differently" section present (BYO subscriptions, spec lifecycle, competitive eval)
- [ ] **AC5** — "What Aigon doesn't do" section present (no IDE, no browser testing, no quick-edit, no auto model selection)
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
2. Use the philosophy-style matrix as the centrepiece
3. Group tools by category (closest competitors, commercial, OSS, engines)
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
