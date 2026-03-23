# Feature: unified-pipeline-stages

## Summary

Unify the feature and research pipelines so they share identical stages, commands, and dashboard UI. Currently features have a clear `in-progress → in-evaluation → done` pipeline while research jams synthesis into `in-progress` as an invisible sub-state, uses `--complete` flags for dual-behavior commands, and has no formal place for feature creation from research findings. After this change, both pipelines use the same stages and the same command patterns — the only differences are what agents produce (code vs findings) and what eval produces (winner merge vs feature creation).

## The unified pipeline

```
FEATURES                              RESEARCH
────────────────────                  ────────────────────
backlog                               backlog
    │                                     │
feature-start [agents]                research-start [agents]
    │                                     │
in-progress                           in-progress
  agents implement                      agents research
  agents submit                         agents submit
    │                                     │
feature-eval                          research-eval
    │                                     │
in-evaluation                         in-evaluation
  eval agent compares                   eval agent synthesizes
  picks winner                          recommends features
  writes report                         user creates features
    │                                     │
feature-close                         research-close
    │                                     │
done                                  done
```

### Command mapping (1:1, no flags, each does one thing)

| Features | Research | Transition |
|----------|----------|------------|
| `feature-start <ID> [agents]` | `research-start <ID> [agents]` | backlog → in-progress |
| `feature-submit` | `research-submit` | agent signals done (in-state action) |
| `feature-eval <ID>` | `research-eval <ID>` | in-progress → in-evaluation |
| `feature-close <ID>` | `research-close <ID>` | in-evaluation → done |

### What changes for research

| Before | After |
|--------|-------|
| `research-synthesize` (in-state action in in-progress) | `research-eval` (state transition to in-evaluation) |
| `research-close --complete` (dual-behavior with flag) | `research-close` (always closes, no flags) |
| `research-close` without flag shows summary, blocks | Removed — `research-close` always closes |
| No in-synthesis/in-evaluation stage | in-evaluation stage (same as features) |
| Synthesis invisible to dashboard | Eval session visible on card with View button |
| Feature creation is ad hoc | Feature creation happens during eval, with backlinks |

## User Stories

- [ ] As a user, I use the same mental model for features and research — start, agents work, eval, close
- [ ] As a user, I run `research-eval 01` and it transitions to in-evaluation and launches a synthesis agent, just like `feature-eval` launches an eval agent
- [ ] As a user, I see the research eval session on the dashboard card with a View button
- [ ] As a user, the eval agent recommends features and I pick which ones to create during the eval conversation
- [ ] As a user, `research-close` always closes — no flags, no conditional behavior
- [ ] As a user, features created from research have a backlink to the research ID

## Acceptance Criteria

- [ ] `research-synthesize` is renamed to `research-eval` (command, template, shortcuts)
- [ ] Research state machine has: backlog → in-progress → in-evaluation → done (matching features)
- [ ] Research spec folders are: `01-inbox`, `02-backlog`, `03-in-progress`, `04-in-evaluation`, `05-done`, `06-paused` (matching features)
- [ ] `research-close` has no `--complete` flag — it always transitions in-evaluation → done
- [ ] `research-close` from in-progress (skipping eval) shows a warning but proceeds
- [ ] Dashboard shows research in-evaluation cards with the eval agent and View button
- [ ] Dashboard pipeline kanban has same columns for both features and research tabs
- [ ] Research eval template (renamed from synthesize) includes feature creation step with `aigon feature-create`
- [ ] Created features include `research_origin: <ID>` in spec frontmatter or body
- [ ] All existing research in `04-done` folders is migrated to `05-done`
- [ ] `aigon doctor` detects and fixes stale research folder numbering

## Validation

```bash
node -c lib/state-machine.js
node -c lib/commands/research.js
node -c lib/commands/infra.js
node -c lib/dashboard-server.js
```

## Technical Approach

### 1. State machine (`lib/state-machine.js`)

Update `RESEARCH_TRANSITIONS` to mirror `FEATURE_TRANSITIONS`:
- Add `research-eval` transition: in-progress → in-evaluation (guard: all agents submitted)
- Change `research-close` transition: from `in-progress` to from `in-evaluation` (also allow from in-progress with warning)
- Remove the `--complete` logic entirely

Update `RESEARCH_ACTIONS`:
- Remove `research-synthesize` action
- Add eval-related actions matching feature pattern (eval session attach, etc.)

### 2. Research folder structure

Rename research stage folders to match features:
```
01-inbox        (same)
02-backlog      (same)
03-in-progress  (same)
04-in-evaluation (NEW — currently 04-done)
05-done         (was 04-done)
06-paused       (NEW)
```

One-off migration: `aigon doctor --fix` moves specs from old `04-done` to new `05-done`.

### 3. Commands (`lib/commands/research.js`)

- Rename `research-synthesize` handler to `research-eval`
- Simplify `research-close` — remove `--complete` flag and summary-display path
- Add warning when closing from in-progress: "Eval hasn't run — closing anyway"

### 4. Templates

- Rename `templates/generic/commands/research-synthesize.md` → `research-eval.md`
- Update content: same synthesis workflow but framed as "eval"
- Add feature creation step: present recommended features, user picks, agent runs `feature-create`
- Update all shortcut templates (arsy → are or similar)
- Update `research-close.md` — remove `--complete` references

### 5. Dashboard (`lib/dashboard-server.js`)

- Research status polling: detect in-evaluation stage, show eval agent session
- Pipeline kanban: same columns for features and research (inbox, backlog, in-progress, evaluation, done)
- Remove synthesis-specific session detection (replaced by standard eval pattern)

### 6. Template for feature-create backlinks

When research-eval creates features, the template instructs the agent to include:
```markdown
## Related
- Research: #01 beer-filtering-ux
```

### 7. Migration

- `aigon doctor --fix`: moves research specs from `04-done/` to `05-done/`, creates `04-in-evaluation/` and `06-paused/` if missing
- Runs automatically on first use after upgrade, or manually via `aigon doctor`

## Dependencies

- `lib/state-machine.js` — transition and action definitions
- `lib/commands/research.js` — all research command handlers
- `lib/dashboard-server.js` — status polling and pipeline data
- `templates/generic/commands/` — research templates and shortcuts
- `templates/dashboard/js/pipeline.js` — kanban rendering
- `lib/commands/setup.js` — seed-reset manifest rebuilding (folder names change)

## Out of Scope

- Changing how features work (they're already correct)
- Adding new research stages beyond what features have
- Feedback pipeline alignment (separate concern)
- Dashboard Insights/Reports changes

## Open Questions

- Should the shortcut for research-eval be `are` (mirroring `afe` for feature-eval)?
- Should `research-close` from in-progress require confirmation or just warn and proceed?

## Related

- Current session discoveries (Mar 23 2026): research flow confusion, --complete flag, invisible synthesis
- Feature: seed-reset-rewrite (folder structure changes affect seed repos)
