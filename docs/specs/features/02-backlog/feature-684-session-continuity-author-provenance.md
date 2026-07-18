---
aigon_id: F684
complexity: very-high
agent: cx
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
# set: my-slug  # optional — ONLY when creating 2+ inbox peers to ship together.
#              #   Run `aigon set list` / `aigon set show <slug>` first. NEVER tag into
#              #   a completed set (all members done). Follow-up work: standalone + depends_on.
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-18T01:03:55.764Z", actor: "cli/feature-prioritise" }
---

# Feature: session-continuity-author-provenance

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary

When an agent creates a feature or research spec directly from a conversational
session, Aigon must record the original author and, where the provider supports
it, a resumable reference to that conversation.  Aigon must capture a concise,
structured author handoff while that context is available, then make the
resume-versus-fresh-session decision centrally and deterministically for spec
revision and implementation.

The operator must not need to estimate token headroom or decide whether an old
conversation will help.  The durable spec and handoff are authoritative; native
provider-session continuation is an optional, automatically-selected
optimization with a safe fresh-session fallback.

## User Stories
- [ ] As an operator whose agent creates a spec from a direct conversation, I
  can see the actual author on the feature/research card and Aigon selects that
  author for a spec-revision cycle when no explicit replacement is chosen.
- [ ] As an operator, I can launch spec revision or implementation without
  deciding whether the originating conversation should be resumed; Aigon shows
  the strategy it selected and why.
- [ ] As an implementation or revision agent, I receive the relevant product
  decisions, constraints, non-goals, and unresolved questions even when the
  original provider session cannot be resumed.
- [ ] As an operator using a provider with a resumable original session, Aigon
  preserves useful author context when it is healthy, but automatically starts
  a fresh task with the handoff when that is safer.

## Acceptance Criteria
### Author and origin provenance

- [ ] `feature-create` and `research-create` resolve the original author in
  this order: explicit `--agent`, `AIGON_AGENT_ID`, then
  `detectActiveAgentSession().agentId`.  An unknown/non-agent shell remains
  authorless; Aigon must not guess a provider from a filename or git identity.
- [ ] The resolved identity is written to the existing immutable `specAuthor`
  and `authorAgentId` bootstrap fields.  A later spec revision must not replace
  either original-author field.
- [ ] Creation establishes an entity-owned origin-session record with source
  (`direct-agent-session` or `aigon-launched`), author agent/provider,
  capture-start time, and a stable Aigon session reference.  Native provider
  session ID/path capture reuses the existing adapter/session-sidecar boundary
  (`findNewAgentSession` / `spawnCaptureProcess`, F357).
- [ ] For `direct-agent-session` source — where Aigon did not launch the agent
  and no capture watcher is running — native session-ID capture is best-effort
  and must be attributable, not a most-recent-file guess.  When it cannot bind a
  provider session ID to the creating conversation with confidence, the record
  stores `direct-agent-session` source with unavailable native provenance rather
  than a speculative ID.  (See Open Questions on direct-session attribution.)
- [ ] Missing, expired, or unobservable native session IDs are represented as
  unavailable provenance, not fabricated values and not an error that blocks
  creating, reviewing, or implementing a spec.

### Durable author handoff

- [ ] Add an Aigon-owned, versioned author-handoff artifact for features and
  research.  It records decisions and rationale, constraints, non-goals,
  unresolved questions, implementation notes, and references to the current
  spec sections that carry durable decisions.  It does not copy a full provider
  transcript into the target repository or require a credential.
- [ ] Add `aigon feature-context record <ID>` and
  `aigon research-context record <ID>` (plus a read-only `show` form) to
  validate and persist the handoff.  Invalid/partial input produces a clear
  repair message and never corrupts the previous valid artifact.
- [ ] Creation prompts instruct an agent that drafted a spec to record the
  handoff after it has promoted the relevant decisions into the spec.  The
  command/templates must derive `AIGON_AGENT_ID` through `aigon agent-context`
  when needed.
- [ ] The dashboard detail payload exposes author provenance, origin-session
  capture state, the latest strategy decision, and the author handoff.  It never
  exposes raw transcript contents or provider-local paths — there is no gated
  "reveal" path; these are omitted from the payload entirely, not hidden behind a
  default.

### Deterministic continuity selection

- [ ] Implement one server/CLI-owned continuity-policy resolver used by both
  command launches and dashboard launches for feature spec revision and
  implementation.  Browser code only renders its returned strategy/reasons.
- [ ] The resolver returns a structured decision containing strategy
  (`attach-live-origin`, `resume-origin`, or `fresh-with-handoff`), confidence,
  reasons, selected agent, parent origin-session reference where applicable,
  and a defined fallback.
- [ ] A live matching origin session wins and is attached rather than spawning
  a duplicate provider process — but `attach-live-origin` is eligible only for
  origin sessions Aigon owns and can address (an Aigon-launched tmux/iTerm
  session it can deliver into), never a `direct-agent-session` running in a
  terminal Aigon does not control.  An unaddressable live origin degrades to
  `resume-origin` or `fresh-with-handoff`, not a dead-end strategy.  Otherwise,
  native resume is eligible only when the adapter explicitly supports
  resume-by-ID, the captured ID is valid, and the selected agent is the origin
  author.
- [ ] The resolver uses deterministic, inspectable facts: phase, adapter
  capability, session availability/known failure, author match, handoff
  validity/completeness, capture age, and known compaction/health signals.  It
  must not require an exact provider context-window percentage, invoke a
  separate judge agent, or silently choose a different provider.
- [ ] Policy is phase-aware: a viable original author session is preferred for
  `spec-revise`; implementation may resume it when the handoff reports
  unresolved implementation-relevant decisions and health signals support it.
  A valid fresh handoff is the normal alternative, not an error path.
- [ ] Every selected decision is persisted as an event/read-model fact so a
  later dashboard refresh, CLI invocation, and audit use the same explanation.

### Launch and recovery behavior

- [ ] A resumed launch creates a new Aigon session record for its current role
  (`spec-revise` or implementation) linked to, but not overwriting, the
  immutable `spec-draft` origin record.  Resumed-session chains remain
  traceable.
- [ ] Provider resume and initial-task delivery are declared and tested per
  agent adapter.  An adapter that cannot reliably both resume an ID and receive
  the phase task must select `fresh-with-handoff`; do not assume identical CLI
  semantics across providers.
- [ ] The resumed task explicitly states the current role, current checkout or
  worktree, current spec, and review findings.  It treats current files and git
  state as authoritative over paths remembered from the original conversation.
- [ ] A resumed agent has a machine-readable `ready` / `fallback` checkpoint
  delivered over the existing agent signal surface (`aigon agent-status` /
  `agent-context`), not a new bespoke transport.  The spec must name the exact
  signal payload and how Aigon observes it.  On a context-missing,
  context-conflict, or delivery-failure signal, Aigon records the failed
  continuation and automatically launches a fresh session with the validated
  handoff.  It must not ask the operator to diagnose token context.
- [ ] Existing `feature-do --resume` semantics for recovering the latest
  implementation session remain intact.  Origin-session continuation uses an
  unambiguous internal/source selector and must not accidentally choose the
  most recent unrelated session for the entity.

### Compatibility, gallery, and validation

- [ ] Existing specs/snapshots/sidecars without author or origin provenance
  remain readable.  They select `fresh-with-handoff` with an explicit
  `origin-unavailable` reason; no migration invents historic author identity.
- [ ] Feature and research interaction contracts, gallery facts/scenarios, and
  dashboard action eligibility cover both continuation and fresh-handoff
  outcomes, including unavailable origin and checkpoint fallback.  Session
  inspection continues to use the canonical session DTO and does not duplicate
  stage-owned sessions.
- [ ] Unit/integration coverage proves author detection precedence, immutable
  authorship, handoff validation, policy decisions/fallbacks, session-chain
  persistence, provider capability refusal, and direct CLI/dashboard parity.
- [ ] `node tests/integration/spec-author-provenance.test.js`, relevant
  session/policy tests, `node tests/unit/dashboard-card-gallery.test.js`, and
  `npm run test:gallery` pass.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
node tests/integration/spec-author-provenance.test.js
node tests/integration/feature-do-resume.test.js
node tests/unit/dashboard-card-gallery.test.js
npm run test:gallery
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach

### Data model and persistence

Keep original authorship separate from continuation provenance:

```text
specAuthor       immutable: agentId, model, effort, authoredAt
originSession    entity-owned: Aigon session ID, provider, provider session ID,
                 capture state, source, createdAt
authorHandoff    versioned artifact: decisions, constraints, non-goals,
                 questions, implementation notes, spec references
continuityDecision per-launch event: strategy, confidence, reasons, fallback,
                 parent/origin session reference
```

Extend the existing agent-session model with the `spec-draft` role and a
parent/origin reference rather than introducing a new workflow lifecycle state.
Session provenance is local operational metadata; the spec and handoff remain
the durable cross-machine/cross-provider handoff.  Do not store credentials,
raw conversation transcripts, or provider-local paths in spec frontmatter.

Add a focused `lib/session-continuity-policy.js` as a pure resolver with
injected clock/session/adapter facts.  It returns a structured selection and
never launches processes itself.  A shared launch helper consumes that result;
`feature-do`, entity spec-revise commands, and corresponding dashboard actions
all delegate through it.

### Creation and handoff flow

1. `entityCreate` detects and persists the author before workflow bootstrap.
2. It creates a `spec-draft` origin-session record and starts the existing
   best-effort provider-ID capture path for direct and Aigon-launched sessions.
3. The creation prompt directs the original agent to promote user decisions to
   the spec, then invoke the new context-record command with the compact,
   validated handoff.
4. The artifact is atomically written under Aigon state and its version/status
   is projected into the entity read model.

### Continuation flow

At spec-revise or implementation launch, resolve a decision from facts rather
than an LLM judge.  Live origin attachment wins.  Otherwise, resume only when
the selected author/provider has a verified resume capability and a usable
native ID; score phase affinity, valid handoff/open decisions, session age, and
known health/compaction facts.  Context-window percentages are optional weak
adapter signals and never a hard gate.

Resume creates a role-specific child session and delivers the current task via
an adapter-declared, confirmed mechanism.  If an adapter lacks reliable task
delivery after resume, choose fresh-with-handoff.  The resumed agent receives a
short checkpoint instruction.  A structured fallback signal records the reason
and causes one fresh-with-handoff retry, preventing a loop.

### Prompt/template changes

Update the generic feature/research creation instructions to establish
`AIGON_AGENT_ID`, record the author handoff, and avoid manually copying session
IDs.  Update implementation and spec-revision prompts so they consume the
server-selected continuity context; agents do not choose the strategy.  Their
only responsibility is the explicit post-launch ready/fallback checkpoint.

Use agent-registry runtime configuration for provider-specific resume and
initial-task-delivery capability.  Claude/Codex support must be verified by
adapter tests; other agents remain fresh-with-handoff until their own resume
semantics are verified.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- Existing workflow-core author provenance and session-sidecar capture (F357,
  F584) are foundations, not dependencies on a separate unfinished feature.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Capturing, syncing, or replaying full provider transcripts across machines.
- Treating a provider session ID as required workflow state or as a credential.
- A generic LLM "judge" call before each launch.
- New lifecycle/currentSpecState values solely for continuity selection.
- Changing the existing meaning of `feature-do --resume` recovery for an
  implementation session.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- **[Blocking — resolve before start]** How reliably can a `direct-agent-session`
  (one Aigon did not launch, with no capture watcher running) be attributed to a
  provider session ID and author at all?  The headline user story depends on it,
  but F357 capture assumes an Aigon-launched session.  Quantify the expected
  success rate and confirm the authorless / origin-unavailable fallback is the
  common case, not the exception — otherwise the continuity half of this feature
  rarely fires and should be deferred.
- **[Blocking — resolve before start]** How do handoff artifacts participate in
  Pro/git-branch storage sync while preserving the rule that raw transcripts and
  local paths are not portable?  The handoff is the durable fallback; if it is
  not portable across machines/branches the "durable cross-provider handoff"
  guarantee is undermined.
- Which adapter-specific post-resume task-delivery mechanisms are verified for
  each currently launchable agent?
- What is the exact `ready` / `fallback` checkpoint signal payload on the
  `agent-status` surface, and how does Aigon observe and time it out?
- Should implementation's initial policy threshold be operator-configurable in
  a later feature, after default behavior has real-world telemetry?
- **Split recommendation (reviewer):** scope spans two separable initiatives —
  **(A)** author + origin provenance + durable handoff artifact (low-risk,
  independently shippable and testable), and **(B)** the continuity-policy
  resolver + resumed-launch / attach / checkpoint machinery (where the provider
  dependency and the blocking unknowns above live).  Consider shipping (A) first
  and gating (B) on the two blocking answers.

## Related
<!-- Links to research topics, other features, or external docs -->
- Prior work: F357 — provider native session ID capture and implementation
  resume; F584 — immutable spec author provenance.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
