---
complexity: low
---

# Feature: onboard-agent-<id>

<!-- Replace <id> throughout with the 2-char agent ID (e.g. "xz") -->

## Summary

Add `<Name>` (`<id>`) as a supported agent in aigon. Binary: `<cli-binary>`. Install: `<install-url-or-command>`.

## Agent Identity

- **Agent ID**: `<id>` (2 chars, lowercase, unique)
- **Display name**: `<Name>`
- **CLI binary**: `<binary>` (what `which <binary>` returns)
- **Provider family**: `<anthropic | google | openai | varies | other>`
- **Install**: `<url or brew/npm command>`

## Decision Tree Answers

Work through `docs/adding-agents.md` Q1–Q5 and fill in:

- **Q1 — Prompt delivery**: does the CLI accept a prompt as a command-line argument?
  - [ ] YES → go to Q2
  - [ ] NO → **TUI-inject** (`cli.injectPromptViaTmux: true`, `capabilities.resolvesSlashCommands: false`)
- **Q2 — Slash-command support**: does the CLI understand `/slash` syntax natively?
  - [ ] YES → **Slash-command** (`capabilities.resolvesSlashCommands: true`)
  - [ ] NO → **File-prompt** (`capabilities.resolvesSlashCommands: false`, prompt via `$(< file)`)
- **Q3 — Model flag**: does `--model <id>` work?
  - [ ] YES → `capabilities.supportsModelFlag: true`
  - [ ] NO → `capabilities.supportsModelFlag: false`
- **Q4 — Interactive**: does the agent stay at its own prompt after finishing?
  - [ ] YES (normal) → no special exit handling needed
  - [ ] NO (batch/exits) → note in `signals` section; `shellTrap` becomes primary signal path
- **Q5 — Transcript telemetry**: can aigon read the agent's session file?
  - [ ] YES → `capabilities.transcriptTelemetry: true`; set `runtime.sessionStrategy`
  - [ ] NO → `capabilities.transcriptTelemetry: false`

**Determined launch type**: `<Slash-command | File-prompt | TUI-inject>`

## `templates/agents/<id>.json` Field Checklist

Create `templates/agents/<id>.json`. Every field below must be set; derive values from Q1–Q5 above.

```jsonc
{
  "id": "<id>",                          // 2-char unique ID
  "name": "<Name>",
  "aliases": ["<full-name>", "<id>"],
  "displayName": "<Name>",
  "shortName": "<ID>",                   // uppercase
  "providerFamily": "<family>",          // from Q identity
  "portOffset": <number>,                // unique integer, check existing agents
  "terminalColor": "<color>",            // tmux color name
  "bannerColor": "<#hex>",
  "defaultFleetAgent": false,            // true only for well-tested Fleet agents
  "installHint": "<url or command>",
  "installCommand": null,                // or "brew install ..." if automatable

  "trust": { ... },                      // see existing agents for type options:
                                         //   claude-json, vscode-settings-bool,
                                         //   json-kv, toml-project

  "worktreeEnv": {},                     // agent-specific env vars for worktrees

  "git": {
    "hasEmailAttribution": true          // false if agent doesn't commit with email
  },

  "capabilities": {
    "supportsModelFlag": <bool>,         // Q3
    "transcriptTelemetry": <bool>,       // Q5
    "resolvesSlashCommands": <bool>      // Q2
  },

  "runtime": {
    "sessionStrategy": null,             // Q5: "claude-jsonl" | "gemini-chats" | null
    "telemetryStrategy": null,
    "trustInstallScope": "worktree-base",
    "resume": null
  },

  "legacy": { "rootFile": null, "promptFile": null },

  "cli": {
    "command": "<binary>",               // the CLI binary name
    "implementFlag": "<flags>",          // Q1/Q2: e.g. "--force" for interactive agents,
                                         //   "" for TUI-inject, "" for file-prompt
    "injectPromptViaTmux": <bool>,       // Q1: true for TUI-inject only; omit if false
    "promptFlag": null,                  // set if agent needs "--prompt <text>" form (op)
    "implementPrompt": "/aigon-feature-do {featureId}",
    //  Slash-command agents: "/aigon-feature-do {featureId}"
    //  File-prompt / TUI-inject agents: "feature-do"  (skill name, aigon inlines the body)
    "evalPrompt": "...",
    "reviewPrompt": "...",
    "reviewCheckPrompt": "...",
    "models": {},
    "modelOptions": [],
    "effortOptions": [],
    "complexityDefaults": {
      "low":       { "model": null, "effort": null },
      "medium":    { "model": null, "effort": null },
      "high":      { "model": null, "effort": null },
      "very-high": { "model": null, "effort": null }
    },
    "modelFlag": null,                   // Q3: "--model" if supportsModelFlag, else null
    "effortFlag": null,
    "effortEnv": null,
    "submitKey": "Enter"
  },

  "placeholders": {
    "AGENT_ID": "<id>",
    "AGENT_NAME": "<Name>",
    "AGENT_TITLE": "<Name> Configuration",
    "ARG_SYNTAX": "<args>",
    "ARG1_SYNTAX": "<name>",
    "CMD_PREFIX": "/aigon-"              // or "aigon " for non-slash agents
  },

  "output": {
    "format": "markdown",
    "commandDir": ".claude/commands/aigon",
    "commandFilePrefix": "aigon-",
    "commandFileExtension": ".md"
  },

  "signals": {
    "shellTrap": true,
    "heartbeatSidecar": true
  }
}
```

## `.aigon/docs/agents/<id>.md` Checklist

- [ ] Copy structure from an existing agent doc (e.g. `.aigon/docs/agents/claude.md`)
- [ ] Fill in agent-specific commands table
- [ ] Document any non-standard flags or trust setup
- [ ] Note the launch type at the top (Slash-command / File-prompt / TUI-inject)

## Test Contract

Add an assertion block to `tests/integration/worktree-state-reconcile.test.js` matching the agent's launch type. Copy the closest existing block and adjust:

- **Slash-command**: verify prompt appears as a quoted CLI arg; `--model` present when `supportsModelFlag: true`
- **File-prompt**: verify prompt is passed as `$(< /path/to/file)` shell expansion; model flag present
- **TUI-inject**: verify bare CLI launch with no prompt arg; `tmux load-buffer` + `paste-buffer` + `send-keys Enter` injection block present; `--model` absent if `supportsModelFlag: false`

## Acceptance Criteria

- [ ] `templates/agents/<id>.json` exists and `node -e "require('./lib/agent-registry').getAgent('<id>')"` exits 0
- [ ] `.aigon/docs/agents/<id>.md` exists
- [ ] `aigon install-agent <id>` completes without error in a test repo
- [ ] Assertion block added to `worktree-state-reconcile.test.js` and `npm test` passes
