# Codex Config Audit — `~/.codex/config.toml`

**Date:** 2026-04-21  
**Feature:** #288 token-reduction-2-telemetry-and-audits  
**Conclusion:** `~/.codex/config.toml` is read by the local CLI **only** — its contents are NOT serialised verbatim into the model prompt. The `project_doc` / `project_docs` entries add per-project instructions that ARE injected as a system/instructions prefix, but only if explicitly listed. The global config is **not** a wholesale context dump.

---

## Method

1. **Local inspection** of the Codex CLI session JSONL files (`~/.codex/sessions/`): The first JSONL line contains a `session_meta` event with a `base_instructions` field. That field is the literal text sent to the model as the system prompt.

2. **Structure analysis** of the 2069-line `~/.codex/config.toml`: The file consists almost entirely of `[project_trust]` table entries — one entry per trusted project path. Each entry looks like:

   ```toml
   [project_trust."<path>"]
   allowed_commands = ["read", "write", "shell"]
   trust_level = "full"
   ```

3. **Cross-reference with upstream Codex source** (codex-cli): The CLI reads `project_trust` to decide whether to run tool calls without human approval. It does **not** stringify the TOML and send it to the model.

## Findings

| Item | Observation |
|------|-------------|
| `base_instructions` in session JSONL | Contains the agent's task prompt, cwd, and any `project_doc` content — **not** the raw TOML |
| 679 `[project_trust.*]` entries | Purely local permission data; never reaches the model API |
| `~/.codex/config.toml` size | 2069 lines; growing with every new project `aigon install-agent cx` is run in |

## Conclusion

The 2069-line file is **safe to prune**. Its contents do NOT inflate model context or affect token costs. Each `[project_trust]` entry is a local CLI permission grant only.

## Recommendation for `install-agent cx`

Aigon's `install-agent cx` currently appends a new `[project_trust]` entry to `~/.codex/config.toml` on every install. This is correct behavior — Codex requires a trust entry before it will run without prompting. However:

- Old entries for deleted or renamed worktrees accumulate indefinitely.
- There is no downside to pruning stale entries (they have no effect once the path no longer exists).

**Recommended follow-up (out of scope for #288):** Add a `aigon doctor` check or a dedicated `aigon codex-gc` command that removes `[project_trust]` entries for paths that no longer exist on disk.
