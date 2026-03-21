# Feature: website-modes-structure-and-communication-refresh

## Summary
Refresh the `aigon-site` website structure and messaging to match Aigon's current mode model: **Drive, Fleet, Autopilot, Swarm**. Reorganize homepage communication around these four modes, add a dedicated modes section with terminal examples, and replace outdated terms (solo, arena, Ralph) in all user-facing website content and demos. For context, this new terminology was developed in the feature feature-37-modes-and-terminology in the ~/src/aigon repository. All information can be found in the feature file and implementation log:
- /Users/jviner/src/aigon/docs/specs/features/05-done/feature-37-modes-and-terminology.md
- /Users/jviner/src/aigon/docs/specs/features/logs/selected/feature-37-modes-and-terminology-log.md

## User Stories
- [ ] As a first-time visitor, I can understand Aigon's four modes in under 30 seconds and choose the right mode for my workflow.
- [ ] As a developer evaluating Aigon, I can see realistic terminal examples that map directly to each mode.
- [ ] As an existing user, I see consistent terminology across homepage copy, docs pages, and interactive terminal demos.
- [ ] As a contributor, I can maintain site messaging because each section has a clear purpose and mode-aligned examples.

## Acceptance Criteria

### Information Architecture and Narrative
- [ ] Homepage structure is updated to follow this flow:
  1. Problem framing
  2. Aigon value proposition
  3. **Mode grid section (Drive/Fleet/Autopilot/Swarm)**
  4. Terminal examples section organized by mode
  5. Workflow/lifecycle section
  6. CTA and docs links
- [ ] The mode grid is visually explicit (2x2 model):
  - Hands-on + One Agent = Drive
  - Hands-on + Multi-Agent = Fleet
  - Hands-off + One Agent = Autopilot
  - Hands-off + Multi-Agent = Swarm
- [ ] Hero and section copy references the four modes consistently and does not use legacy mode names as primary labels.

### Dedicated Modes Section
- [ ] A dedicated website section exists titled equivalent to "Modes" or "Choose Your Mode".
- [ ] Each mode has:
  - one-sentence purpose
  - when-to-use guidance
  - one canonical terminal example
  - expected outcome summary
- [ ] Mode examples use current commands and flags only, including `--autonomous` where relevant.

### Terminal Demo and Example Alignment
- [ ] All homepage terminal examples are grouped and labeled by mode.
- [ ] Existing demo tabs/scripts are renamed and reframed around mode terminology.
- [ ] Any text or code examples using old terms are updated:
  - "solo mode" -> "Drive mode"
  - "arena mode" -> "Fleet mode"
  - "Ralph mode" / "Ralph loop" -> "Autopilot mode" / "autonomous loop"
  - `--ralph` -> `--autonomous`
- [ ] Command examples for each mode are valid and consistent with current CLI behavior.

### Website Docs and Agent Pages in aigon-site
- [ ] `docs/development_workflow.md` uses Drive/Fleet/Autopilot/Swarm terminology.
- [ ] `docs/agents/*.md` pages use updated terminology and command names.
- [ ] Any user-facing docs in `aigon-site` that present workflow examples use new mode terms.

### Content Quality and Consistency
- [ ] No mixed terminology on the same page (old and new mode labels together as active labels).
- [ ] Legacy terminology is allowed only in historical context blocks explicitly labeled as history.
- [ ] Mode naming, capitalization, and command snippets are consistent across homepage, docs, and demos.

## Validation
```bash
# Legacy terms removed from active site pages/docs (excluding specs/history)
! rg -n -i 'solo mode|arena mode|ralph mode|ralph loop|--ralph' \
  index.html docs/agents docs/development_workflow.md

# New terms present on homepage
rg -q 'Drive|Fleet|Autopilot|Swarm' index.html

# Modes section exists and includes examples
rg -n -i 'choose your mode|modes|drive|fleet|autopilot|swarm' index.html

# Agent docs updated to new terminology
rg -n -i 'Drive mode|Fleet mode|Autopilot mode|Swarm mode|--autonomous' docs/agents/*.md
```

## Technical Approach
- Start with a content architecture pass (section order and purpose) before editing copy.
- Update homepage source (`index.html`) to create a dedicated modes block plus mode-based terminal example block.
- Refactor terminal demo scripts/templates to map one demo per mode and align commands.
- Sweep `docs/development_workflow.md` and `docs/agents/*.md` for terminology and command updates.
- Add light content constraints (copy checklist) to prevent drift back to legacy terms.

## Dependencies
- Aigon CLI terminology rollout complete in core repo (Drive/Fleet/Autopilot/Swarm and `--autonomous`).
- Feature #38 docs sweep in `aigon` complete as reference baseline.

## Out of Scope
- New product capabilities beyond messaging and documentation alignment.
- Rebuilding the site tech stack/framework.
- Full redesign unrelated to mode communication clarity.
- Historical specs/logs terminology rewrite.

## Open Questions
- Should website demos keep "Ralph" only as a historical mention in one dedicated note, or remove the term entirely from visitor-facing flows?
- Should mode demos prioritize slash-command examples, CLI examples, or show both side-by-side?
- Should Swarm mode be presented as advanced/experimental on the site, or as a first-class default option?

## Related
- `aigon` feature #37: modes-and-terminology (CLI)
- `aigon` feature #38: modes-docs-sweep (repo docs)
- `aigon-site` feature-05-deploy-demo-update (existing demo update baseline)
