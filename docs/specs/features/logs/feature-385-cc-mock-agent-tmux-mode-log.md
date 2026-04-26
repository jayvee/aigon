# Implementation Log: Feature 385 - mock-agent-tmux-mode
Agent: cc

MockAgent gains `useRealWrapper` mode that drives `buildAgentCommand` via real tmux + `MOCK_AGENT_BIN`, so the shell trap + heartbeat sidecar paths are exercised end-to-end by `tests/integration/mock-agent-tmux.test.js`.
