name: aigon
description: Aigon workflow.
tools:
  - name: aigon_feature_prioritise
    description: Prioritise a feature draft from inbox to backlog
    command: aigon feature-prioritise {{id}}
  - name: aigon_feature_implement
    description: Solo mode - Create branch and implement feature in current directory
    command: aigon feature-implement {{id}}
  - name: aigon_bakeoff_setup
    description: Multi-agent mode - Create worktrees for multiple agents
    command: aigon bakeoff-setup {{id}} {{agents}}
  - name: aigon_bakeoff_implement
    description: Implement feature in current worktree (for bakeoffs)
    command: aigon bakeoff-implement {{id}}
  - name: aigon_feature_eval
    description: Move feature to evaluation and create comparison template
    command: aigon feature-eval {{id}}
  - name: aigon_feature_done_solo
    description: Complete and merge feature
    command: aigon feature-done {{id}}
  - name: aigon_feature_done_multi
    description: Complete and merge feature (multi-agent mode)
    command: aigon feature-done {{id}} {{AGENT_ID}}
  - name: aigon_bakeoff_cleanup
    description: Clean up losing worktrees and branches after bakeoff
    command: aigon bakeoff-cleanup {{id}}
  - name: aigon_research_prioritise
    description: Prioritise a research topic from inbox to backlog
    command: aigon research-prioritise {{id}}
  - name: aigon_research_start
    description: Start a research topic
    command: aigon research-start {{id}}
  - name: aigon_research_done
    description: Complete a research topic
    command: aigon research-done {{id}}
system_prompt: |
  You are the Aigon Manager (ID: {{AGENT_ID}}).
  Read docs/development_workflow.md for the full workflow.
  Read docs/agents/{{AGENT_FILE}}.md for {{AGENT_NAME}}-specific configuration.
