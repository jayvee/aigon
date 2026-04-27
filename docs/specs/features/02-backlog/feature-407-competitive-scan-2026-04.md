---
recurring_slug: competitive-refresh
recurring_month: 2026-04
recurring_template: competitive-refresh.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T03:13:17.077Z", actor: "recurring/feature-prioritise" }
---

# Competitive Scan 2026-04

## Summary
Perform a monthly scan of the competitive landscape in agent-orchestration, spec-driven, and multi-agent harness spaces. This involves scanning GitHub releases, vendor blogs, Hacker News, and Reddit for key movements. The output will be a draft patch under `docs/competitive/scans/2026-04.md` summarizing findings and proposing cell flips on `docs/competitive/matrix.md`.

## Agent Instructions

### Step 1: Identify Tracked Tools and Sources
1.  List all `.md` files in the `docs/competitive/entries/` directory.
2.  For each file, extract the following information:
    *   **Slug**: From the "Slug" frontmatter or the first heading.
    *   **GitHub Repo URL**: From the "Repo" field (e.g., `[Aider-AI/aider](https://github.com/Aider-AI/aider)` -> `https://github.com/Aider-AI/aider`).
    *   **Other Source URLs**: From the "Sources" section.

### Step 2: Perform Competitive Intelligence Scan

For each identified tool:
1.  **GitHub Releases**: Use `WebFetch` to read the GitHub releases page for the extracted GitHub Repo URL. Look for recent updates, new features, or significant changes since the last scan ({{LAST_SCAN_MONTH}} if available, otherwise assume no previous scan).
2.  **Vendor Blogs/Changelogs**: Use `WebFetch` to read each "Other Source URL". Look for announcements, new features, or strategic shifts.
3.  **Hacker News**: Use `GoogleWebSearch` with the tool's slug and keywords like "agent", "coding", "claude code", "codex", "multi-agent", "worktree", "spec-driven" (e.g., "Aider Hacker News agent coding"). Filter for top monthly results. Summarize relevant discussions.
4.  **Reddit**: Use `GoogleWebSearch` on `r/LocalLLaMA` and `r/ChatGPTCoding` with the tool's slug (e.g., "Aider Reddit LocalLLaMA"). Filter for top monthly results. Summarize relevant discussions.

### Step 3: Analyze Findings and Propose Matrix Changes

1.  Consolidate all findings for each tool.
2.  Identify "New Tools" (if a new entry file was added since {{LAST_SCAN_MONTH}}), "Changed Tools" (significant updates, feature additions, strategic shifts), and "Stale Tools" (no updates in a configurable period, e.g., 3-6 months).
3.  Identify "Benchmark Updates" if any relevant benchmarks are mentioned.
4.  Based on the findings, propose "cell flips" for `docs/competitive/matrix.md`. These should be minimal and only reflect significant changes in competitive positioning (e.g., tier changes, new capabilities). Each proposed cell flip should include an inline note "consider feature `<slug>` to respond" if it changes Aigon's competitive positioning.

### Step 4: Generate Output File `docs/competitive/scans/2026-04.md`

1.  Create a new markdown file at `docs/competitive/scans/2026-04.md`.
2.  Structure the file with the following sections:
    *   `# Competitive Scan 2026-04`
    *   `## Summary` (Brief overview of key movements)
    *   `## New Tools` (List newly identified tools and a brief description)
    *   `## Changed Tools` (List tools with significant updates, with summaries)
    *   `## Stale Tools` (List tools with no recent activity)
    *   `## Benchmark Updates` (Any relevant changes in benchmarks)
    *   `## Proposed Matrix Patch` (Markdown diff format for `docs/competitive/matrix.md` changes)
3.  Ensure the total output content is capped at 2,000 words. Summarize aggressively.

### Step 5: Handle Idempotency and Feature Closure

1.  After generating `docs/competitive/scans/2026-04.md`, compare its content (especially the "Proposed Matrix Patch") with the previous month's scan (if available).
2.  If no material changes are detected in the landscape (e.g., no significant "New Tools", "Changed Tools", "Benchmark Updates", and an empty "Proposed Matrix Patch"), then:
    *   Write "no material changes; matrix unchanged" into the summary section of `docs/competitive/scans/2026-04.md`.
    *   Immediately close this feature.
3.  If material changes are detected, keep the feature open for human review.

### Step 6: Commit Changes

1.  Commit the newly created `docs/competitive/scans/2026-04.md` file.
2.  If the feature was immediately closed due to no material changes, ensure the commit message reflects this (e.g., "chore: Competitive Scan 2026-04 - no material changes").
