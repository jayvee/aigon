# Feature: why-aigon

## Summary

Make the Aigon public-facing documents (landing page, docs site intro, getting-started, README) explicitly answer "why Aigon?" with four concrete, differentiated points. Today the docs describe *what* Aigon does but not *why* someone would choose it over alternatives. The four pillars are:

1. **Bring your own subscriptions** — use your existing Claude Max/Pro, Gemini, or Codex subscriptions. No separate AI billing, no tokens to buy, no markup.
2. **Plain CLI sessions in tmux** — agents run in real terminal sessions you can attach to, read, and take over at any time. No black-box execution.
3. **No vendor lock-in or servers** — pure CLI + git. No hosted platform, no account, no SaaS dependency. Runs entirely on your machine.
4. **Plays well with GitHub PRs and team flows** — push branches, create PRs, get reviews. Aigon gates close on PR state so it fits existing team workflows rather than replacing them.

## User Stories

- [ ] As a developer evaluating Aigon, I want to understand in under 30 seconds why I'd choose it over other AI dev tools, so I can decide whether to try it
- [ ] As a developer reading the docs, I want to see these four points early (landing page, getting-started intro) so the value proposition is clear before I start installing

## Acceptance Criteria

- [ ] Landing page (`site/public/home.html`) includes a "Why Aigon" section with the four points, each with a short explanation (1–2 sentences)
- [ ] Docs site getting-started page (`site/content/getting-started.mdx`) includes a brief "Why Aigon" section near the top, before Prerequisites
- [ ] The four points use concrete language, not marketing fluff — e.g. "plain tmux sessions" not "seamless integration"
- [ ] No existing content is removed — the four points are additive
- [ ] Visual check: Playwright screenshot of landing page and getting-started page after changes

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

- Add a "Why Aigon" section to `site/public/home.html` — likely a 2x2 grid or 4-column row with icons and short descriptions
- Add a short "Why Aigon" paragraph or list to the top of `site/content/getting-started.mdx`
- Use the `frontend-design` skill for the landing page visual work
- Keep copy factual and specific — avoid superlatives and vague claims

## Dependencies

- None

## Out of Scope

- Rewriting the entire landing page or docs site
- Comparison pages (already exist at `site/content/comparisons.mdx`)
- Video or interactive demos

## Open Questions

- Should the README.md in the repo root also get the four points?

## Related

- Feature 255: feature-close-remote-review-gate (enables point 4)
