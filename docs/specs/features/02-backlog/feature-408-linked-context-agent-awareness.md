---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T09:46:19.103Z", actor: "cli/feature-prioritise" }
---

# Feature: linked-context-agent-awareness

## Summary

Aigon captures rich context about why a feature exists — research specs, multi-agent findings, sibling feature logs — yet agent prompts barely use it. `feature-do` already injects set-sibling logs, but (a) research context is only a vague prose nudge buried inside the set section, (b) features with `research:` frontmatter but no `set:` tag get nothing at all, and (c) `feature-code-review` and `feature-spec-review` have zero research awareness. This feature wires up the full context graph: every agent that touches a feature — implementer, code reviewer, spec reviewer — gets concrete, path-resolved pointers to the source research spec and all agent findings files whenever the `research:` frontmatter field is present.

## User Stories

- [ ] As an implementer working on a feature tagged `research: 44`, I see a "Research context" block printed before my instructions that lists the exact paths to the R44 spec and all findings files — so I read the source material without hunting for it.
- [ ] As an implementer working on a set feature, the research context appears alongside sibling logs rather than as an afterthought vague note.
- [ ] As a code reviewer, I receive the same research context block so I can evaluate whether the implementation faithfully reflects what the research concluded.
- [ ] As a spec reviewer, I receive research context so I can assess whether the spec is well-grounded in the findings before approving it.
- [ ] As a feature author with `research:` set but no `set:`, I still receive full research context — context injection is not gated on set membership.

## Acceptance Criteria

- [ ] `lib/feature-do.js` exports `buildResearchContextSection(researchIds, repoRoot)` that: accepts a single integer or array of integers; globs `docs/specs/research-topics/{01-inbox,02-backlog,03-in-progress,04-in-evaluation,05-done,06-paused}/research-{ID}-*.md` to find the spec file; globs `docs/specs/research-topics/logs/research-{ID}-*-findings.md` for findings; returns a formatted markdown block (see Technical Approach) or empty string when no IDs are provided.
- [ ] LAUNCH MODE: `buildResearchContextSection` output is injected as `RESEARCH_CONTEXT_SECTION` extra placeholder for all agents, regardless of whether the feature is in a set.
- [ ] INSTRUCTION MODE (CC slash-command path): `printResearchContextInstructions(researchIds, repoRoot)` prints the equivalent block to stdout immediately after the set-siblings block (or instead of it when no set exists).
- [ ] `templates/generic/commands/feature-do.md` includes `{{RESEARCH_CONTEXT_SECTION}}` between the set context and Step 3 (implement). The placeholder resolves to empty string and collapses to no visible section when not present.
- [ ] The vague "3. The research source named in `## Related` (if present)." line inside `buildSetContextSection` is replaced with concrete resolved paths when research IDs are available (uses `buildResearchContextSection` output), or removed entirely when no research is linked.
- [ ] `templates/generic/commands/feature-code-review.md` gains a "Step 1.25: Research context" block. The block reads `research:` from the spec frontmatter using `aigon feature-spec <ID>` output (already available inline), then cats the resolved findings files. The step is conditional: if no `research:` field is found, the agent skips it.
- [ ] `templates/generic/commands/feature-spec-review.md` gains equivalent research context loading after the spec is read. Spec reviewer is instructed to evaluate whether acceptance criteria and technical approach are grounded in the research findings.
- [ ] A unit test in `test/` pins that `buildResearchContextSection` with a known fixture research ID returns a block containing both the spec path and at least one findings path.
- [ ] A unit test pins that `buildResearchContextSection` with no IDs (null / empty array) returns an empty string.

## Validation

```bash
node -c lib/feature-do.js
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

**`buildResearchContextSection(researchIds, repoRoot)` shape:**

```markdown
## Step 2.x: Research context (this feature originated from research)

Before coding, read the source research in order:
1. Research spec: `./docs/specs/research-topics/05-done/research-44-competitive-positioning.md`
2. Agent findings (read all that exist):
   - `./docs/specs/research-topics/logs/research-44-cc-findings.md`
   - `./docs/specs/research-topics/logs/research-44-gg-findings.md`
   - `./docs/specs/research-topics/logs/research-44-op-findings.md`

Focus on: recommended features, scope boundaries, and key tradeoffs identified in the findings. Do not restate what you read — use it to tighten your understanding of why this feature was created and what constraints the research surfaced.
```

**Resolution:** Use `fs.readdirSync` / `glob.sync` (or manual folder scan — same approach as `collectFeaturesForResearch` in F403) to resolve paths without a full filesystem walk. The six stage folders are known constants. Return relative paths (`./ prefix`).

**Template placeholder:** `{{RESEARCH_CONTEXT_SECTION}}` renders to empty string when no research IDs are found; `processTemplate`'s blank-line collapse keeps the document clean.

**`feature-code-review.md` approach:** The spec content is already inlined into the review context by `feature-do` output. Add a bash block that parses `research:` from the inlined spec (simple `grep/sed` for the frontmatter value), then conditionally cats the resolved findings files. If the grep returns empty, the agent skips this step with a one-liner note.

**`feature-spec-review.md` approach:** Same pattern — spec content is already loaded. After the `cat "$SPEC_PATH"` step, add: "If the spec has a `research:` frontmatter field, read the referenced findings before reviewing. Evaluate whether the acceptance criteria and technical approach are grounded in the research conclusions."

**Test fixtures:** Use existing R44 findings files as the fixture set (already on disk). Tests should not create synthetic files; they should use the real paths under `docs/specs/research-topics/`.

## Dependencies

- depends_on: none
- F403 (research-feature-link) must be done — it introduced `research:` frontmatter, `readResearchTag`, and `collectFeaturesForResearch`. It is already in `05-done`.

## Out of Scope

- Dashboard changes (research context is already surfaced there via F403's FEATURES sub-tab).
- `feature-eval` / `feature-review` (deprecated alias): only `feature-code-review` and `feature-spec-review` are in scope.
- Research context for features where `research:` is not set — no inference, only explicit frontmatter.
- Auto-populating `research:` on existing specs that pre-date F403 (backfill is a separate concern).

## Related

- Research: none (internally motivated gap identified during F403 review)
- F403: research-feature-link — introduced the `research:` field this feature consumes
