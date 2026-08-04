---
aigon_id: R67
complexity: high
# agent: cc    # optional — id of the agent that owns this research spec;
#              #   see feature-template.md for precedence rules.
# origin: customer-feedback   # optional — set when input came from user/customer voice (vs agent discovery)
# reporter:                   # optional — who reported it (when origin is customer-feedback)
#   name: ""
#   identifier: ""
# source:                     # optional — where the input came from
#   channel: ""
#   reference: ""
#   # url: "https://example.com/ticket/123"
# feedback_refs:              # optional — stable refs to migrated legacy feedback (idempotency)
#   - feedback:12
#   - docs/specs/feedback/01-inbox/feedback-12-example.md
---

# Research: software-factory-positioning-and-herdr-comparison

<!-- Authoring AI: set `complexity:` using the same rubric as features —
     low/medium/high/very-high — based on breadth of investigation and judgment
     required. Model/effort defaults at start come from each agent's
     `cli.complexityDefaults[<complexity>]` (not from this spec). -->

## Context

Aigon is currently described as a "spec-driven multi-agent harness." That is
accurate, but it describes the mechanism more clearly than the product outcome.
The proposed alternative is to rename or reframe Aigon as a **software
factory**: a system that turns scoped intent into reviewed, merge-ready software
through repeatable stages, multiple coding agents, Git isolation, explicit
state, and human-controlled gates.

Initial market scanning suggests that "software factory" is legible and timely,
but already used by products that claim a broader, end-to-end SDLC control
plane. The framing could therefore clarify Aigon's value, overstate its present
scope, or place it in direct comparison with larger enterprise platforms. This
research should determine which of those is true before documentation, product
naming, or landing-page copy changes.

Herdr is a required comparison because it also helps operators manage multiple
terminal-based coding agents. The research must distinguish session/runtime
management from software-delivery workflow ownership, identify genuine overlap,
and decide whether Herdr is a competitor, an adjacent tool, a potential session
host, or some combination of those.

The decision this research must inform is: **Should Aigon adopt "software
factory" as its primary category, use it only as a supporting metaphor or
tagline, or reject it in favour of a narrower category?** The result should be
specific enough to drive a coherent documentation update without making claims
the product cannot substantiate.

## Questions to Answer

### Category and naming

- [ ] What does "software factory" mean in current AI-development marketing,
  product documentation, and practitioner usage? Which capabilities do buyers
  reasonably expect from a product using the term?
- [ ] Which parts of that category does Aigon demonstrably support today, which
  are only partial, and which are absent? Use shipped behaviour and public
  documentation as evidence.
- [ ] Would adopting the category make Aigon easier to understand for its target
  users, or create misleading expectations around requirements intake, CI/CD,
  deployment, operations, governance, or full-SDLC autonomy?
- [ ] Should "software factory" become the product category, a qualified
  descriptor (for example, local/open/source-controlled), a campaign metaphor,
  or not be used? What evidence would falsify the recommendation?
- [ ] Does this require renaming the Aigon product, changing only its descriptor
  and narrative, or retaining both name and current category? Assess brand
  continuity, discoverability, collision, and migration costs.

### Competitive landscape

- [ ] If Aigon is framed as a software factory, what is the correct competitive
  set? Separate direct competitors, adjacent multi-agent control surfaces,
  single-vendor agent managers, hosted autonomous coding agents, and general
  agent frameworks.
- [ ] Compare Aigon with at least Factory.ai, Agentic Software Factory
  (softwarefabrik.io), GitHub Agent HQ, the Codex app, Cursor's parallel-agent
  surfaces, Paperclip, and the strongest current open-source worktree
  orchestrators. Which comparisons are useful and which are category errors?
- [ ] On which defensible axes does Aigon win or lose: unit of work, source of
  truth, lifecycle ownership, agent/vendor independence, isolation, review and
  evaluation, autonomy, runtime/session management, deployment model,
  governance, remote access, and pricing?
- [ ] Is Aigon's most durable wedge the "factory" outcome, its cross-vendor
  orchestration, its spec-and-Git control plane, its local/BYO-subscription
  model, or a combination? Rank the candidate wedges and test each against
  current competitors.

### Herdr comparison

- [ ] What does Herdr own as a terminal-native agent multiplexer: persistent
  PTYs, agent state, remote/SSH access, direct attach, restoration, and
  agent-driven CLI/socket automation?
- [ ] What does Aigon own that Herdr does not: feature and research objects,
  spec lifecycle, Git branches/worktrees, dependency-aware feature sets,
  implementation/review/evaluation stages, merge/close semantics, audit state,
  and dashboard actions?
- [ ] Where do they overlap in agent launching, status detection, persistence,
  operator intervention, and multi-agent supervision, and which product is
  stronger on each overlapping job?
- [ ] For which user or workflow should someone choose Aigon, Herdr, both
  together, or neither?
- [ ] Could Herdr serve as an Aigon `AgentSessionHost` alongside or instead of
  tmux? Assess strategic fit only; do not design or implement the integration.

### Documentation and positioning output

- [ ] Produce evidence-backed candidate descriptors at one-line,
  one-paragraph, and landing-page lengths for the recommended framing.
- [ ] Define a claims ledger: claims Aigon can make now, claims requiring
  qualification, and claims it must not make.
- [ ] Identify every public documentation surface that should change if the
  recommendation is adopted, including README, site landing page, comparison
  page, repository description, conceptual docs, and reusable agent-facing
  descriptors.
- [ ] Identify and correct stale competitive-documentation assumptions,
  including references to internal comparison artifacts that no longer exist.

## Scope

### In Scope

- Current category language and buyer expectations around AI software
  factories, coding-agent orchestration, and multi-agent development control
  planes.
- Evidence from official product sites, documentation, repositories, release
  notes, and Aigon's shipped implementation and public docs.
- A current competitor map with an explicit Herdr deep comparison.
- Honest capability gaps and conditions under which the software-factory framing
  should be rejected.
- Naming and descriptor options, but only far enough to choose a positioning
  direction.
- A documentation change map and reusable draft positioning copy.

### Out of Scope

- Implementing documentation or website changes.
- Changing the package, repository, CLI command, domain, or product name.
- Building new capabilities to make the software-factory claim true.
- Designing or implementing a Herdr integration.
- Marketing-channel strategy, paid acquisition, visual identity, logos, or
  trademark/legal clearance.
- Treating general-purpose agent frameworks as direct competitors without
  evidence that they target software-delivery workflow ownership.

## Inspiration and Starting References

- Existing Aigon research R44, `competitive-positioning-and-landscape`.
- Current Aigon README and `site/content/index.mdx`.
- Current Aigon comparison page, `site/content/compare.mdx`.
- Herdr product, comparison, agents, integrations, and agent-automation docs.
- Factory.ai's "Build Your Software Factory" product page.
- softwarefabrik.io's "Agentic Software Factory" product and architecture pages.
- Official GitHub Agent HQ and OpenAI Codex multi-agent product announcements.

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->

- [ ] Feature: update Aigon's canonical positioning and reusable descriptors.
- [ ] Feature: revise the landing page, README, and conceptual documentation to
  match the chosen framing.
- [ ] Feature: rebuild the competitive comparison around the current category
  map, including Herdr and honest limitations.
- [ ] Feature: address any positioning-blocking product gaps only after the
  category recommendation is approved.
