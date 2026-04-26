---
complexity: high
---

# Research: agent-phase-effectiveness-from-telemetry

## Context

Aigon users select agents and models for each phase (implement, review, draft, spec-review) based on
external benchmarks and pricing. But there is no feedback loop from real usage back into the matrix.
A user might choose a cheaper review model, find the reviews unhelpful, and have no systematic way
to confirm or quantify that suspicion.

The hypothesis is that all the data needed to evaluate phase effectiveness retrospectively is either
already captured or will be once session-log telemetry is fully implemented:

- **Agent session transcripts** — the full text of what the agent wrote during each phase
- **Commit history** — ground truth for what actually landed after review/implementation
- **Feature outcomes** — close status, winner selection (fleet), adopt/revert decisions
- **`afrv` revision outcomes** — accept/revert/modify decisions after a code review
- **Stats pipeline** — cost, tokens, model, role already recorded per triplet in `stats.json`

With these inputs, an LLM evaluator (or structured heuristics) could retrospectively score:
- Did the reviewer flag issues that were confirmed by the final diff?
- Did the implementer produce code that required minimal revision cycles?
- Which (agent × model × phase) combinations produce the best outcomes per dollar?

This research should determine what data is available today, what gaps exist, what the right rubric
is for each phase, and what a concrete scoring pipeline would look like.

## Questions to Answer

- [ ] What session telemetry is currently captured and in what format? What is the gap to full coverage?
- [ ] Does the commit history contain enough signal to evaluate review quality retrospectively (e.g. can we correlate reviewer-flagged issues with changes in the final commit)?
- [ ] What is the right rubric for **review** quality? Candidate signals: comment adoption rate, false-positive rate, revision round-trips, fleet winner prediction accuracy.
- [ ] What is the right rubric for **implementation** quality? Candidate signals: TypeScript/lint clean on first pass, revision cycles needed, spec acceptance-criteria coverage, adoption in fleet.
- [ ] Can an LLM evaluator reliably score a review transcript + diff pair without human labelling? What prompt structure works best?
- [ ] How should scores derived from real usage override or blend with external benchmark scores in the matrix? (Bayesian update? Separate "observed" column?)
- [ ] What is the minimum viable telemetry footprint — what must be captured per session to make retrospective scoring possible?
- [ ] Are there privacy or data-volume concerns with storing full session transcripts locally?

## Scope

### In Scope
- Review and implement phase effectiveness
- Local telemetry only (session logs, commit history, stats.json already on disk)
- LLM-based retrospective evaluation as the scoring mechanism
- How derived scores feed back into the agent matrix

### Out of Scope
- Real-time scoring during an active session
- Cloud telemetry or any data leaving the local machine
- Draft and spec-review phases (lower priority — implement and review first)
- Automated model switching based on scores (that is a separate feature)

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
- [ ] Feature: session-log telemetry capture (if gaps found)
- [ ] Feature: retrospective phase-effectiveness scorer
- [ ] Feature: observed-score column in agent matrix
