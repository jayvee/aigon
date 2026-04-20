# Findings: Feature Sets & Set-Level Autonomy (Gemini)

## Concept Design
- **Simplest viable abstraction:** A lightweight `set: <name>` tag in the feature spec frontmatter. This avoids introducing a heavy "Epic" entity with its own lifecycle, state machine, and folder structure.
- **Description/goal:** Not strictly necessary for the set itself. The shared context can be inferred from the member features or the originating research topic.
- **Lifecycle:** Derived entirely from member features. A set is "in-progress" if any member is in-progress, and "done" when all members are closed. There is no explicit set lifecycle state machine.
- **Relation to dependencies:** Feature sets complement the existing `depends_on` system. A set groups features visually and logically, while `depends_on` dictates the strict execution order. The SetConductor can automatically infer sequential execution based on these dependencies.

## Creation & Workflow
- **`research-eval`:** When evaluation outputs multiple features, it should automatically assign them a shared `set: <research-topic-name>` tag.
- **`feature-create`:** Should accept a `--set <name>` flag to easily group new features upon creation.
- **Manual modification:** Users can simply edit the Markdown spec frontmatter to add or change the `set` tag.
- **Board/Dashboard:** Display feature sets as collapsible groups (swimlanes) on the board, allowing users to see overall progress at a glance.

## Autonomy & Autopilot (SetConductor)
- **Process/loop:** A new, lightweight `SetConductor` (a wrapper script or single tmux session) that queries features by set, sorts them by their dependency graph, and sequentially invokes `feature-autonomous-start` for each. It doesn't need a heavy state machine; it observes existing feature states.
- **Autopilot command:** A `feature-set-autopilot <set-name>` command delegates to the existing single-feature AutoConductor.
- **Safe to start:** The SetConductor should wait for the previous feature to be fully `merged` (feature-close completes) before branching the next one. This minimizes merge conflicts and cascading failures.
- **Concurrency:** Sequential execution is the safest default. Parallel execution could be an opt-in flag (`--parallel`) if the dependency graph allows it, though it increases the risk of worktree contention.
- **Solo vs Fleet:** The set should inherit the mode specified when invoking the set autopilot, passing it down to each feature.
- **Failure handling:** If a feature fails review or execution, the SetConductor pauses the entire set and surfaces a notification/badge. Human intervention is required to unblock (e.g., fix the feature, close it, and resume the set).
- **Restart survival:** The SetConductor can be stateless or use a minimal `set-state.json`. Because it orchestrates based on feature states, it can resume by querying which features in the set are not yet "done" and picking up the next valid one.
- **Branch bases:** Subsequent features branch off `main` after the preceding feature is merged. This is the cleanest approach and avoids complex rebasing chains across feature branches.
- **User visibility:** A set-level dashboard card showing overall progress (e.g., "Feature Set: Auth (2/4 merged)"), with drill-down into the currently active feature.
- **Stop/Pause:** `aigon sessions-close --set <set-name>` would find the active feature(s) in the set and close their sessions, effectively pausing the set conductor.
- **Cost/Telemetry:** Roll up per-set totals dynamically on read. No need for a separate set-level stats file.

## External Patterns & Prior Art
- **Spec-driven tools (Cursor/Aider):** Often rely on a master "plan" markdown file that checks off completed steps, rather than rigid entities.
- **Project trackers (Linear):** Cycles/Projects provide a simple container with derived progress (burn-up charts) without heavy overhead.
- **Autonomous agents (Devin):** Maintain an internal "plan" or scratchpad where they break down a large goal into sequential steps and execute them iteratively.
- **CI/CD (GitHub Actions):** Use job dependencies (`needs: [job1]`) to sequence execution. Aigon's SetConductor would act similarly to a CI runner orchestrating jobs.

## Complexity & Trade-offs
- **Risk of mini-projects:** High if a new entity lifecycle is introduced. Keeping it as a frontmatter tag mitigates this risk entirely.
- **Tag-only approach:** Achieves the vast majority of the value. A `set:` tag plus a SetConductor script is the sweet spot of functionality and simplicity.
- **Core vs Pro:** Set grouping and sequential execution should be in Core as it's a fundamental workflow enhancement. Advanced set-level analytics or multi-repo coordination could be Pro features.