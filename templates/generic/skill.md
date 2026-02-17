name: aigon
description: Aigon workflow.
tools:
  - name: aigon_feature_prioritise
    description: Prioritise a feature draft from inbox to backlog
    command: aigon feature-prioritise {{id}}
  - name: aigon_feature_setup_solo
    description: Setup for solo mode - Create branch for feature
    command: aigon feature-setup {{id}}
  - name: aigon_feature_setup_arena
    description: Setup for arena mode - Create worktrees for multiple agents
    command: aigon feature-setup {{id}} {{agents}}
  - name: aigon_feature_implement
    description: Implement feature in current branch/worktree
    command: aigon feature-implement {{id}}
  - name: aigon_feature_eval
    description: Move feature to evaluation and create template (code review or comparison)
    command: aigon feature-eval {{id}}
  - name: aigon_feature_done_solo
    description: Complete and merge feature (solo mode)
    command: aigon feature-done {{id}}
  - name: aigon_feature_done_arena
    description: Complete and merge feature (arena mode - specify winning agent)
    command: aigon feature-done {{id}} {{AGENT_ID}}
  - name: aigon_feature_cleanup
    description: Clean up arena worktrees and branches
    command: aigon feature-cleanup {{id}}
  - name: aigon_research_prioritise
    description: Prioritise a research topic from inbox to backlog
    command: aigon research-prioritise {{id}}
  - name: aigon_research_setup_solo
    description: Setup for solo research
    command: aigon research-setup {{id}}
  - name: aigon_research_setup_arena
    description: Setup for arena research with multiple agents
    command: aigon research-setup {{id}} {{agents}}
  - name: aigon_research_conduct
    description: Conduct research (write findings)
    command: aigon research-conduct {{id}}
  - name: aigon_research_done
    description: Complete a research topic
    command: aigon research-done {{id}}
  - name: aigon_dev_server_start
    description: Start the dev server - allocates port, registers with proxy, waits for healthy
    command: aigon dev-server start
  - name: aigon_dev_server_stop
    description: Stop the dev server and deregister from proxy
    command: aigon dev-server stop
  - name: aigon_dev_server_logs
    description: Show dev server logs
    command: aigon dev-server logs
  - name: aigon_dev_server_list
    description: List all running dev servers
    command: aigon dev-server list
system_prompt: |
  You are the Aigon Manager (ID: {{AGENT_ID}}).
  Read docs/development_workflow.md for the full workflow.
  Read docs/agents/{{AGENT_FILE}}.md for {{AGENT_NAME}}-specific configuration.
