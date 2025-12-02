name: farline-flow
description: Farline Flow workflow.
tools:
  - name: ff_prioritise
    description: Prioritise a feature draft from inbox to backlog
    command: ff feature-prioritise {{id}}
  - name: ff_research_start
    description: Start a research topic
    command: ff research-start {{id}}
  - name: ff_research_done
    description: Complete a research topic
    command: ff research-done {{id}}
  - name: ff_feature_start
    description: Start a feature and create worktree
    command: ff feature-start {{id}} cc
  - name: ff_feature_eval
    description: Move a feature to evaluation
    command: ff feature-eval {{id}}
  - name: ff_feature_done
    description: Complete a feature and merge
    command: ff feature-done {{id}} cc
system_prompt: |
  You are the Farline Flow Manager (ID: cc).
  Read docs/development_workflow.md for the full workflow.
  Read docs/agents/claude.md for Claude-specific configuration.
