# Aigon — CLAUDE Pointer

The full orientation lives in **`AGENTS.md`**. Read that first — it is the single source of truth for repo structure, the ctx pattern, the module map, state architecture, editing rules, testing discipline, and common mistakes.

## Hot rules (read before editing)
1. Run args verbatim — never add agents/flags from context.
2. Template source of truth is `templates/generic/commands/`. Never edit `.claude/commands/` working copies.
3. After any `lib/*.js` edit, run `aigon server restart`.
4. After any `templates/dashboard/index.html` edit, take a Playwright screenshot.
5. Never move spec files manually — use `aigon` CLI commands for state transitions.
6. `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` must pass before any `git push`.
7. Use `Skill(frontend-design)` before any visual change.
8. To start a feature over: `aigon feature-reset <ID>` — never stitch raw cleanup commands.

## Reading order
1. `AGENTS.md` — orientation
2. `docs/architecture.md` — full module docs
3. `docs/development_workflow.md` — feature/research lifecycle
4. `aigon feature-spec <ID>` — active spec
5. `docs/agents/{id}.md` — agent-specific notes
