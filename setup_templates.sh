#!/bin/bash

# Create directories
mkdir -p templates/cc
mkdir -p templates/gg
mkdir -p templates/cx

# --- CLAUDE TEMPLATES ---

cat > templates/cc/SKILL.md << 'EOF'
name: farline-manager
description: Manage the Farline Flow workflow, encompassing Research, Feature Specs, and Git Worktrees.
tools:
  - name: ff_research_start
    description: Start a research topic (moves from backlog to in-progress)
    command: ff research-start {{id}}
  - name: ff_research_done
    description: Complete a research topic (moves to done)
    command: ff research-done {{id}}
  - name: ff_feature_start
    description: Start a feature and create an isolated git worktree for implementation
    command: ff feature-start {{id}} cc
  - name: ff_feature_eval
    description: Move a feature to evaluation (Bake-off phase)
    command: ff feature-eval {{id}}
  - name: ff_feature_done
    description: Complete a feature, merge the branch, and cleanup worktrees
    command: ff feature-done-won {{id}} cc
system_prompt: |
  You are the Farline Flow Manager (Agent ID: cc).
  Your goal is to strictly enforce Spec-Driven Development.

  ## CRITICAL RULES
  1. **Context:** The `specs/` folder is the Single Source of Truth.
  2. **Worktrees:** When implementing code (running `ff_feature_start`), you MUST switch to the created directory (e.g., `../feature-NN-cc`). Do not write code in the main repo.
  3. **Logging:** - Write research notes to: `specs/research-topics/analysis/research-NN-cc-notes.md`
     - Write implementation logs to: `specs/features/analysis/feature-NN-cc-log.md`
  4. **Commit Protocol:** When committing code in a worktree, use Conventional Commits (feat:, fix:, chore:) and sign off.
EOF

cat > templates/cc/commands.md << 'EOF'
---
description: Shortcuts for Farline Flow actions
---

# Farline Flow Shortcuts

- `/ff-research <id>`: Start a research topic. -> `ff research-start <id>`
- `/ff-start <id>`: Start a feature (creates worktree). -> `ff feature-start <id> cc`
- `/ff-eval <id>`: Submit feature for evaluation. -> `ff feature-eval <id>`
- `/ff-done <id>`: Merge and finish feature. -> `ff feature-done-won <id> cc`
- `/ff-help`: List all farline commands. -> `ff`
EOF

# --- GEMINI TEMPLATES ---

cat > templates/gg/feature-start.toml << 'EOF'
name = "feature-start"
description = "Start a feature and create worktree"
prompt = "I will start feature {{args}}. Command: !{ff feature-start {{args}} gg}"
EOF

cat > templates/gg/feature-eval.toml << 'EOF'
name = "feature-eval"
description = "Move feature to evaluation phase"
prompt = "I will submit feature {{args}} for evaluation. Command: !{ff feature-eval {{args}}}"
EOF

cat > templates/gg/feature-done.toml << 'EOF'
name = "feature-done"
description = "Merge and complete feature (I won)"
prompt = "I will complete feature {{args}} as the winner. Command: !{ff feature-done-won {{args}} gg}"
EOF

cat > templates/gg/research-start.toml << 'EOF'
name = "research-start"
description = "Start a research topic"
prompt = "I will start research {{args}}. Command: !{ff research-start {{args}}}"
EOF

cat > templates/gg/research-done.toml << 'EOF'
name = "research-done"
description = "Complete a research topic"
prompt = "I will complete research {{args}}. Command: !{ff research-done {{args}}}"
EOF

# --- CODEX TEMPLATES ---

cat > templates/cx/FARLINE_FLOW.md << 'EOF'
# Agent Identity: Codex (ID: cx)

## Workflow Constitution
1. **Spec-Driven:** Never write code without a corresponding file in `specs/features/in-progress/`.
2. **Isolation:** If a worktree exists (e.g., `../feature-NN-cx`), ALL file edits must happen there.
3. **Naming:** - Branches: `feature-NN-cx-description`
   - Logs: `specs/features/analysis/feature-NN-cx.md`

## Commands
- Start: `ff feature-start NN cx`
- Submit: `ff feature-eval NN`
- Finish: `ff feature-done-won NN cx`
EOF

echo "✅ All templates created in ./templates/"
