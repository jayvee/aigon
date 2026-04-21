# Feature: why-aigon

## Summary

Make the Aigon public-facing documents (landing page, docs site intro, getting-started, README) explicitly answer "why Aigon?" with concrete, differentiated points. Today the docs describe *what* Aigon does but not *why* someone would choose it over alternatives.

The value proposition is organized into **six pillars** (copy on the site can group or shorten for scanability, but the substance should cover all of these):

1. **Bring your own subscriptions** — Use the AI products you already pay for (Claude, Codex, Gemini, etc.). No separate Aigon AI billing, no token packs, no markup. You choose which provider handles which stage.

2. **Stay in the flow when a subscription lapses** — If a sub runs out mid-session, you are not stuck on one vendor's meter—you can switch agents or accounts and keep going instead of losing momentum.

3. **Spec-driven development you control** — Features and research use specs that can be built, shipped, reset, and rebuilt. That gives you repeatable structure: clear handoffs, clean retries, and less "tribal knowledge" in chat history alone.

4. **Autonomous and multi-agent workflows** — Kick off long runs (e.g. overnight) and walk away. Configure who does what—e.g. draft or refine a spec with one model, implement with another, review with others—then follow a pre-built lifecycle through push/merge, instead of manually orchestrating every step.

5. **Context that compounds** — Specs and implementation summaries feed forward into what agents see next, so work accrues as durable project context rather than disappearing when a session ends.

6. **Transparent, local, team-aligned** — Agents run in plain CLI sessions (e.g. tmux) you can attach to, read, and take over. The tool is CLI + git on your machine—no required hosted platform. It fits GitHub PRs and team review: push branches, open PRs, and optional close gates so remote review is not bypassed by accident.

## User Stories

- [ ] As a developer evaluating Aigon, I want to understand in under 30 seconds why I'd choose it over other AI dev tools, so I can decide whether to try it
- [ ] As a developer reading the docs, I want to see these pillars early (landing page, getting-started intro) so the value proposition is clear before I start installing — grouped or shortened on the page if needed, without dropping the substance above

## Acceptance Criteria

- [ ] Landing page (`site/public/home.html`) includes a "Why Aigon" section with a **2×3 card grid** — six cards, one per pillar, each card showing the pillar heading and 1–2 sentence body; all six cards visible without interaction (no accordion/expand)
- [ ] Docs site getting-started page (`site/content/getting-started.mdx`) includes a brief "Why Aigon" section before the Prerequisites heading — a 6-item bullet list with one sentence per pillar is sufficient
- [ ] `README.md` (repo root) includes a "Why Aigon" `##` section immediately after the project description paragraph — one sentence per pillar
- [ ] Copy uses concrete language, not marketing fluff — e.g. "plain tmux sessions" not "seamless integration"; name real workflows (spec → implement → review → push) without hard-coding model version numbers that go stale
- [ ] No existing content is removed — new "why" material is additive
- [ ] Visual check: Playwright screenshot of landing page and getting-started page after changes confirms the "Why Aigon" section renders correctly

## Validation

This feature edits only doc/site files — no CLI syntax validation applies. Verify with:

```bash
# Confirm only additive changes (no deletions of existing content)
git diff HEAD -- site/public/home.html site/content/getting-started.mdx README.md
# Playwright screenshot (see Acceptance Criteria)
```

## Technical Approach

- Add a "Why Aigon" section to `site/public/home.html` — use a **2×3 card grid**: six cards, one per pillar, each with a short heading and 1–2 sentence body; all cards visible without interaction
- Add a "Why Aigon" section to `site/content/getting-started.mdx` before the Prerequisites heading — a tight 6-item bullet list (one sentence per pillar) is sufficient; no need to match the landing page layout
- Add a "Why Aigon" `##` section to `README.md` immediately after the project description paragraph — one sentence per pillar
- Use the `frontend-design` skill before any CSS or layout changes on the landing page
- Keep copy factual and specific — avoid superlatives and vague claims; prefer "configure agents per stage" over naming specific model versions in permanent copy

## Dependencies

- None

## Out of Scope

- Rewriting the entire landing page or docs site
- Comparison pages (already exist at `site/content/comparisons.mdx`)
- Video or interactive demos

## Related

- Feature 255: feature-close-remote-review-gate (supports pillar 6: PR-aware close / team workflows)
