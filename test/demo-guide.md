# Aigon Dashboard Demo Guide

Sample features and step-by-step flows for demos and screen recordings.
Uses the brewboard fixture repo (`~/src/brewboard`).

**Before each demo:** reseed fixtures with `node test/setup-fixture.js`

---

## Demo Feature: Beer Search Filter

A small, visually obvious feature for demonstrating the full lifecycle.

**Name:** `beer search filter`

**Description (paste or type into the create modal):**
> Filter beers by typing a name or brewery into a search box above the grid. Cards filter in real-time as you type.

**Why it works for demos:**
- Typing → cards disappear/reappear (great on screen)
- Single file edit (~15 lines in `src/app/page.tsx`)
- 2-3 minutes to implement
- Clear before/after visual

---

## Flow 1: Fleet Mode (2 agents compete)

```
1. Dashboard: click "+ Create" on brewboard
   Name: beer search filter
   Description: (paste from above)
   Agent: cc → Create

2. Agent refines the spec in a Claude terminal

3. Dashboard: drag spec from INBOX → BACKLOG (or click Prioritise)
   → Assigns ID (e.g. #06)

4. Dashboard: click "Start feature" on #06
   → Agent picker: select cc + gg → Setup
   → Both worktrees open in terminals

5. Wait for both agents to submit (dashboard shows ✓ Submitted)

6. Dashboard: click "Evaluate" on #06
   → Agent picker: select cc → Run Evaluation
   → Eval agent compares implementations

7. Dashboard: click "Close & Merge cc" (or winner)
   → Optionally adopt from gg
   → Feature moves to DONE
```

## Flow 2: Drive Worktree Mode (single agent)

```
1. Dashboard: drag a backlog feature to IN-PROGRESS
   → Agent picker: select cc → Setup (single agent = drive worktree)

2. Dashboard: click "Start" on the feature card
   → Opens worktree in terminal with Claude

3. Wait for agent to submit

4. Dashboard: click "Run Review"
   → Agent picker: select gg → Run Review
   → Different agent reviews the code

5. Dashboard: click "Close & Merge"
   → Feature moves to DONE
```

## Flow 3: Drive Branch Mode (CLI-only, no worktree)

```
1. cd ~/src/brewboard

2. aigon feature-start 01
   → Creates branch feature-01-dark-mode (no worktree)
   → You stay in the main repo on the feature branch

3. /aigon:feature-do 01
   → Agent implements the feature on the branch

4. aigon feature-close 01
   → Auto-commits, switches to main, merges --no-ff
   → Spec moves to done, branch deleted
```

## Flow 4: Create Feature from Dashboard

```
1. Dashboard: click "+ Create"
2. Enter name and description
3. Pick agent (cc/gg/cx) or None
4. Click Create
   → Spec file created in inbox with description pre-filled
   → If agent selected: terminal opens with agent refining the spec
   → If None: spec created silently, edit manually
```

---

## Pre-seeded Backlog Features (brewboard)

After `node test/setup-fixture.js`, brewboard has these in backlog:

| ID  | Name           | Good for testing          |
|-----|----------------|---------------------------|
| #01 | dark mode      | Fleet (cc vs gg)          |
| #02 | rating system  | Drive worktree            |
| #03 | export to CSV  | Drive branch              |
| #04 | sort by rating | Quick single-agent test   |

And 2 features in inbox (beer style filters, social sharing) for create/prioritise demos.
