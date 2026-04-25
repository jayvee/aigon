---
complexity: high
---

# Research: session-transcript-capture-and-storage

## Context

Aigon orchestrates multiple agents (cc, gg, cx, cu) across worktrees via tmux/iTerm. Today, the only durable artifacts of an agent run are the diff and the run-log entry — the *reasoning path* that produced them is invisible. That blind spot blocks several things Aigon already wants to do well: comparing agents on more than diff quality, calibrating spec→outcome quality (does `afsr` review actually shorten runs?), detecting stuck/looping agents, and producing audit evidence when a model misbehaves (cf. quarantine workflow, F358).

Two capture surfaces exist already: native agent transcripts (Claude Code writes structured JSONL to `~/.claude/projects/`; Codex/Cursor/Gemini each have their own format or none) and the tmux session itself (uniform but raw ANSI, can be tapped via `pipe-pane`). The question is whether Aigon should systematically capture, key, and store these — and what user-facing features justify the storage and privacy cost.

Storage location must be separate from engine state (`.aigon/state/`) and must outlive the worktree, since worktrees are deleted on feature-close. Long-term retention likely belongs in object storage (S3/GCS/R2) on an opt-in basis, since transcripts contain secrets and verbatim file contents.

## Questions to Answer

- [ ] What's the right capture strategy: native-only, tmux-only, or hybrid (native primary + tmux as universal floor)? Which agents have usable native logs today, which don't, and what's the format heterogeneity cost?
- [ ] Where should transcripts live across the lifecycle? Hot tier (local, e.g. `~/.aigon/transcripts/<project>/...` outside the worktree so they survive feature-close), cold tier (S3/GCS/R2 with async upload), and how do we keep them strictly separate from `.aigon/state/`?
- [ ] What's the keying scheme? Proposed: `<project>/<entity-type>/<entity-id>/<agent>/<session-uuid>.jsonl` plus a `.meta.json` sibling for queryable fields (model, ts, tokens, exit, commits, source). Should keys use entity-id (survives slug renames via `migrateEntityWorkflowIdSync`) or slug? One file per agent invocation or per feature run?
- [ ] What metadata schema does the dashboard need to answer the headline questions (per-agent failure modes by problem class, spec-quality→outcome correlation, stuck-detection)? What can be derived from native logs vs. what needs to be inferred from the tmux stream?
- [ ] How is `tmux pipe-pane` wired in? Where in the spawn path does the hook attach so capture starts at session creation (not retroactively)? What's the format (raw ANSI vs. sanitised) and how is rotation/size handled for long sessions?
- [ ] What's the privacy/secrets posture? Opt-in defaults, redaction for known patterns (env files, `.env.local`, API keys), what's never uploaded, how users delete a transcript after the fact, and how this interacts with the existing read-only dashboard rule.
- [ ] What user-facing features unlock once transcripts exist, and which one justifies shipping first? Candidates: timeline view from the feature card, side-by-side agent reasoning compare, stuck-detection flags on the dashboard, spec-quality dashboard, replay for debugging shipped-broken features, quarantine evidence trail.
- [ ] Cost model: storage size per session (typical and p99), upload bandwidth, lifecycle policy (e.g. auto-archive after feature close + N days, delete after M months), and whether there's a meaningful "lite" capture mode (metadata-only, no body).

## Scope

### In Scope
- Capture mechanisms: native transcripts per agent, `tmux pipe-pane`, hybrid layering.
- Storage layout, keying, metadata schema, retention.
- Privacy/redaction posture and opt-in flow.
- Headline user-facing features and which ranks first.
- Integration points with existing surfaces: dashboard, eval, quarantine, run logs.

### Out of Scope
- Implementation. This is a brief; building a feature comes after `are` synthesis.
- Cross-machine sync / multi-user collaboration on transcripts.
- ML-driven analysis of transcripts (loop detection beyond simple repeated-tool-call heuristics).
- Replacing or restructuring `.aigon/state/` — transcripts are additive.

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
