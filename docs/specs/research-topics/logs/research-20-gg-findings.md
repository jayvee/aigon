# Research Findings: feature dependencies

**Agent:** Gemini (gg)
**Research ID:** 20
**Date:** 2026-03-23

---

## Key Findings

**Declaration Location & Format:**
Dependencies are best declared in the **spec frontmatter** (e.g., as a YAML array `depends_on: [121, 122]`). 
- **Pros:** Machine-readable, colocated with the feature definition, avoids a centralized single-point-of-failure dependency map.
- **Cons:** Requires adding frontmatter parsing to tools that don't already do it. 
- Parsing the existing Markdown `## Dependencies` section is too brittle as it contains free-text instructions (e.g., "How to install dependencies...").

**Enforcement (`feature-start`):**
Enforcement should be **soft (warn but allow override)**. 
- In real-world development, a developer might want to start scaffolding a dependent feature before the prerequisite is 100% "done" (e.g. while it's in review or testing).
- `feature-start` should check the manifest of the referenced IDs. If any dependency is not in the `05-done` (or equivalent) stage, it should output a warning and require confirmation (or a `--force` flag) to proceed.

**Referencing Format:**
Dependencies should be referenced by **Feature ID** rather than name. IDs are stable, canonical (`manifest.js` canonicalizes them), and less prone to typos than kebab-case feature names.

**Dashboard Visualisation:**
Visualising dependencies adds significant value. A simple "Blocked by #121" label or badge on Kanban cards is sufficient and keeps the UI clean without needing complex graph rendering.

**Validation and Circular Dependencies:**
- `feature-prioritise` should validate that the referenced feature IDs actually exist in the project backlog/in-progress/done folders.
- A basic Depth-First Search (DFS) or topological sort during `feature-prioritise` can detect and warn about circular dependencies early on.

**External Inspiration:**
- *STM (Simple Task Master)*: Uses `dependencies: [ID]` in Markdown YAML frontmatter.
- *Taskwarrior*: Uses explicit ID mapping (`depends:<ID>`).
Both demonstrate that explicit ID references in metadata are the standard for lightweight CLI tools.

## Sources

- [Simple Task Master (STM) GitHub Repository](https://github.com/) - Example of Markdown/YAML frontmatter task dependency tracking.
- [Taskwarrior Documentation](https://taskwarrior.org/docs/) - Example of lightweight CLI dependency modeling.

## Recommendation

Implement explicit dependencies using a `depends_on: [ID]` field in the YAML frontmatter of feature specs. 

1. Update the feature template to include a YAML frontmatter block if it doesn't already use one, or instruct users to add it.
2. In `feature-start`, parse the frontmatter to find `depends_on`. For each ID, read its manifest using `readManifest(id)`.
3. If any dependent manifest is not complete, display a warning and ask for confirmation to proceed.
4. Update the dashboard to display "Blocked by #ID" badges based on the parsed frontmatter.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| feature-dependency-frontmatter | Parse `depends_on: [ID]` array from spec frontmatter | high | none |
| feature-start-dependency-check | Warn in `feature-start` if declared dependencies are not complete | high | feature-dependency-frontmatter |
| dashboard-dependency-badges | Display "Blocked by #ID" badges on dashboard cards | medium | feature-dependency-frontmatter |
| circular-dependency-detection | Detect and warn about circular dependencies during `feature-prioritise` | low | feature-dependency-frontmatter |