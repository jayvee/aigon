# Gemini Findings: Single Source of Truth for Feature State

## Analysis of Options

The core issue stems from maintaining dual state representations: the event-sourced workflow engine (authoritative) and the filesystem folder structure (projected). When these desync, the system behaves unpredictably. Based on Aigon's architecture and the existence of robust read-paths (`aigon board` and the dashboard), we can re-evaluate the necessity of the folder structure.

**Option A: Stop moving files entirely (Flat Structure)**
This is the most robust architectural choice. By keeping all specs in a single directory (e.g., `docs/specs/features/`), we eliminate the possibility of file-location desyncs. The workflow engine becomes the unambiguous sole source of truth. 
*Pros:* 
- Completely eliminates the class of bugs related to file movement and desync.
- Simplifies `lib/feature-spec-resolver.js` (no more globbing across lifecycle folders).
- Simplifies the workflow engine effects (no more `git mv` side effects or git index wrangling).
- Cleaner git history without constant file rename churn.
*Cons:*
- Users can no longer use `ls` or GitHub's UI to see what is in the "backlog". However, Aigon already provides `aigon board` and a web dashboard, which are superior interfaces for this exact purpose.

**Option B: Engine is sole authority, folders are a derived projection**
While this aligns with the current intent (post-feature 171), it retains the complexity of managing file moves as side effects. File moves in git are not atomic with internal engine state, making this inherently fragile against manual user actions or overzealous `git add` commands.

**Option C & E:**
Option C is a band-aid that doesn't fix the root cause. Option E introduces symlinks, which create cross-platform issues (Windows) and poor UX on GitHub, making it a non-starter.

**Option D:**
Reversing the authority to the filesystem destroys the value of the event-sourced XState machine, abandoning the ability to enforce strict lifecycle transitions.

## Recommendation

**I recommend Option A (Flat Structure).**

The folder structure is a legacy crutch from before the workflow engine, dashboard, and CLI board existed. Now that Aigon has dedicated UI and CLI tools for visualizing state, the folder structure is redundant and actively harmful to system integrity.

### Implementation Path (Option A)
1. **Migration:** Move all existing specs from `01-inbox`, `02-backlog`, etc., into a flat `docs/specs/features/` directory.
2. **Workflow Engine:** Remove the `git mv` side effects from state transitions in `lib/workflow-core/`.
3. **Spec Resolver:** Update `lib/feature-spec-resolver.js` to look in the single flat directory.
4. **Read Paths:** Ensure `aigon board` and dashboard queries solely rely on the workflow engine snapshots (`.aigon/workflows/features/{id}/snapshot.json`).
5. **Research & Feedback:** Apply the same flat-structure pattern to research and feedback entities for consistency.

This approach minimizes moving parts and centralizes the lifecycle authority permanently.
