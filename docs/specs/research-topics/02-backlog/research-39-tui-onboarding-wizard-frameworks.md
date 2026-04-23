---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T23:37:38.025Z", actor: "cli/research-prioritise" }
---

# Research: tui-onboarding-wizard-frameworks

## Context

Aigon is now distributed as a global npm package (`npm install -g @aigon/cli`). The current first-run setup (`aigon global-setup`) only captures a single preference (terminal app) and does not guide users through installing prerequisites, agent CLIs, or initialising a project. This creates a steep onboarding cliff: users must read documentation and run a sequence of manual commands.

The goal is to replace this with a **guided onboarding wizard** — a step-by-step interactive TUI that runs automatically on first install and walks the user through: prerequisite detection and remediation, agent CLI selection and install, project init, and server start. Tools like Gemini CLI, `create-react-app`, Laravel Installer, and Vercel CLI demonstrate that a well-crafted wizard dramatically reduces time-to-first-success.

Because Aigon is a Node.js CLI shipping as an npm package, any framework chosen must work within that constraint with no additional runtime dependencies beyond what can be bundled.

## Questions to Answer

- [ ] Which Node.js TUI/prompt libraries are the strongest candidates? (e.g. `clack`, `@inquirer/prompts`, `enquirer`, `prompts`, `blessed`, `ink`) — compare on: feature set, bundle size, maintenance health, ease of building multi-step wizards, and visual quality.
- [ ] Which of these is used in high-quality, widely-adopted CLI tools right now (2025–2026)? Who uses what — Vercel CLI, Gemini CLI, Railway CLI, `create-next-app`, etc.?
- [ ] What does an exemplary onboarding wizard look like in practice? Identify 3–5 best-in-class examples and describe specifically what makes them good (step flow, visual design, error handling, skip/resume logic).
- [ ] How should the wizard handle the case where a prerequisite is missing but can be automatically installed? What patterns exist for "detect → offer to install → install inline → verify → continue"?
- [ ] How do the leading libraries handle non-interactive (CI/headless) environments gracefully — auto-skip prompts, apply defaults, exit cleanly?
- [ ] What is the right scope for Aigon's wizard? Should it cover: (a) prerequisite detection only, (b) agent CLI selection and install, (c) terminal app preference, (d) project init, (e) server start — or all of the above in sequence? What do comparable tools include?
- [ ] Are there bundle size or startup latency concerns with the leading libraries that would affect the `npm install -g` experience?
- [ ] What is the recommended pattern for resumable/idempotent wizards — if the user has already completed step 2, do they re-run from step 1 or jump forward?

## Scope

### In Scope
- Node.js TUI/prompt library evaluation (feature set, DX, bundle size, maintenance status)
- Survey of best-in-class CLI onboarding wizards and what makes them effective
- Library recommendation with rationale for Aigon's use case
- Inline install patterns (detect missing → offer to install → run → verify)
- Non-interactive/CI fallback patterns
- Scope recommendation: which steps belong in Aigon's wizard and in what order

### Out of Scope
- Implementing the wizard (that is the follow-on feature)
- Windows-specific TUI concerns (Aigon targets macOS and Linux)
- Full visual design/branding (follows implementation)

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
