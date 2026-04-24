# Research Findings: TUI Onboarding Wizard Frameworks (gg)

## Findings

### Node.js TUI/Prompt Libraries Evaluation
The landscape of Node.js prompt libraries in 2025-2026 has shifted heavily toward modularity and high-quality default aesthetics. 

1. **`@clack/prompts`**: The strongest candidate for modern CLI wizards. It provides a beautiful, "block-based" UI that visually groups related questions (ideal for a multi-step wizard). It has a tiny bundle size, excellent TypeScript support, and requires minimal configuration to look professional.
2. **`@inquirer/prompts`**: The modern, modular rewrite of `inquirer`. It tree-shakes well and is very stable, but its default aesthetic is more traditional and less cohesive for a sequential "wizard" flow compared to Clack.
3. **`prompts` / `enquirer`**: Lightweight and fast, but development has slowed. They lack the visual polish and structure of Clack.
4. **`ink` / `blessed`**: Both are overkill for a linear setup wizard. Ink requires React, which adds significant bundle size and startup latency—a major negative for a global `npm install -g` tool.

### Industry Usage in Best-in-Class CLIs
The shift toward `@clack/prompts` is evident across top-tier CLIs:
- **Vercel CLI** recently migrated heavily to `@clack/prompts` for commands like `vercel init`.
- **create-next-app** transitioned from `prompts` to `@clack/prompts` to align with the Vercel ecosystem's visual language.
- **Gemini CLI** uses `@clack/prompts` combined with `picocolors` for its interactive elements.
- **Railway CLI** is written in Go (using `survey`), but its UX heavily inspired the block-based design that Clack implements in Node.js.

### Exemplary Onboarding Wizards
1. **`create-next-app`**: Excellent at providing sensible defaults. It uses rapid, sequential questions with clear visual hierarchy, allowing users to hit `Enter` repeatedly for a standard setup.
2. **Vercel CLI (`vercel login` & `vercel link`)**: Excels at handling state jumps (e.g., opening a browser, waiting for an OAuth callback, and seamlessly resuming the terminal flow with a success message).
3. **Astro CLI (`create-astro`)**: Built the original prototype for what became Clack. It uses a "step" paradigm where completed steps collapse into a summary checklist, keeping the terminal clean.

### Prerequisite Installation Patterns
The "detect → offer → install → verify" loop should follow an atomic pattern:
1. **Detect**: Use `command -v <tool>` or node's `child_process.execSync` to check if the prerequisite exists and meets version requirements.
2. **Offer**: If missing, use a `clack` confirm prompt: "Missing X. Would you like Aigon to install it?". Provide the manual install command in the prompt's description for transparency.
3. **Install & Verify**: Execute the install. If it fails, catch the error gracefully, display the manual instructions, and offer a "Retry" or "Skip" option rather than crashing the wizard.

### Non-Interactive (CI/Headless) Environments
Leading libraries like Clack will throw an error or behave unpredictably if called without a TTY. Best practices dictate:
- Detect CI early using `process.stdout.isTTY` or `process.env.CI`.
- If non-interactive, bypass the TUI entirely.
- Expose flags (e.g., `--yes`, `--agent cc`, `--terminal warp`) to allow automated provisioning. If flags are missing in a headless environment, exit `1` with a clear message rather than hanging on a prompt.

### Scope for Aigon's Wizard
To eliminate the onboarding cliff, Aigon's wizard should handle a specific, linear scope:
1. **Welcome & Prerequisite Check**: Detect Node version and Git. Offer remediations if needed.
2. **Terminal Preference**: Prompt for terminal app (Warp, iTerm, etc.) and save to global config.
3. **Agent Setup**: Detect installed agents. Prompt the user to select which agent(s) to install/configure (cc, gg, cx, cu) and run their respective `install-agent` routines inline.
4. **Project Initialization**: Ask if they want to initialize Aigon in the current directory (if it isn't already).
5. **Handoff**: Provide a clear "Next Steps" summary (e.g., "Run `aigon server start` to open the dashboard"). Do not start the server automatically, as it blocks the terminal and prevents the user from exploring the CLI.

### Resumability and Idempotency
Wizards must be idempotent. If a user aborts at Step 3 and restarts, Step 1 and 2 should be skipped automatically.
- **Pattern**: Read the existing state (`~/.aigon/config.json` or `.aigon/config.json`) *before* prompting.
- If the "Terminal Preference" is already set, display a Clack `note` or `step` saying "Terminal: Warp (configured)" and move on.
- Always provide a `--force` flag to bypass the state checks and re-run all prompts.

## Recommendation
Aigon should use **`@clack/prompts`** for its onboarding wizard. It offers the best balance of visual polish, tiny bundle size, and modern developer experience. 

The wizard should be implemented as a sequential state machine that checks for existing configuration (idempotency) before displaying each prompt block. It must include a strict TTY check at startup to support CI environments via `--yes` or specific config flags.

## Suggested Features
| Feature Name | Description | Priority | Depends On |
| :--- | :--- | :--- | :--- |
| `wizard-tui-framework` | Add `@clack/prompts` and `picocolors` dependencies and a base wrapper | high | none |
| `wizard-core-flow` | Implement the sequential wizard runner with TTY detection and idempotency checks | high | `wizard-tui-framework` |
| `wizard-prereq-step` | Add wizard step to detect and offer inline installation of prerequisites | medium | `wizard-core-flow` |
| `wizard-agent-step` | Add wizard step to select and install agent CLIs | high | `wizard-core-flow` |
| `wizard-project-init-step` | Add wizard step to initialize the current workspace | high | `wizard-core-flow` |
