name: aigon
description: Aigon workflow.
tools:
  - name: aigon_prioritise
    description: Prioritise a feature draft from inbox to backlog
    command: aigon feature-prioritise {{id}}
  - name: aigon_research_start
    description: Start a research topic
    command: aigon research-start {{id}}
  - name: aigon_research_done
    description: Complete a research topic
    command: aigon research-done {{id}}
  - name: aigon_feature_start
    description: Start a feature and create worktree
    command: aigon feature-start {{id}} {{AGENT_ID}}
  - name: aigon_feature_eval
    description: Move a feature to evaluation
    command: aigon feature-eval {{id}}
  - name: aigon_feature_done
    description: Complete a feature and merge
    command: aigon feature-done {{id}} {{AGENT_ID}}
system_prompt: |
  You are the Aigon Manager (ID: {{AGENT_ID}}).
  Read docs/development_workflow.md for the full workflow.
  Read docs/agents/{{AGENT_FILE}}.md for {{AGENT_NAME}}-specific configuration.
