# Implementation Log: Feature 110 - rationalise-readme-guide
Agent: cc

## Approach

Treated the live CLI help output and command handlers as source of truth. Systematically verified each mismatch identified in the spec against the actual code before editing.

## Changes Made

### README.md (627 → 579 lines, net -48)
- Removed `feature-eval` from Drive mode example, replaced with `feature-review`
- Clarified workflow overview table: feature-eval is Fleet-only
- Fixed `aigon init` quick start: init does NOT run install-agent; merged steps 2+3
- Fixed Codex permission default: interactive, not `--full-auto`
- Clarified multi-agent evaluation section as Fleet-only
- Updated dashboard link to remove VS Code sidebar/menubar references

### GUIDE.md (1433 → 1320 lines, net -113)
- Removed `feature-eval` from Drive mode lifecycle (kept in Fleet)
- Rewrote Agent Status Tracking section: `.aigon/state/*.json` files, not YAML front matter
- Removed nonexistent dashboard subcommands: `install`, `uninstall`, `vscode-install`, `menubar-install`
- Removed VS Code sidebar section and macOS menubar section (not implemented)
- Removed `feedback-promote` reference, replaced with actual workflow
- Fixed Codex `implementFlag` default in config example (empty string, not `--full-auto`)
- Compressed "Big Picture" section into concise "Traceability" section (links to README for full lifecycle overview)
- Consolidated duplicated install-agent/context-delivery section in Contributing to link to README
- Added missing CLI commands to reference tables: feature-autopilot, feature-validate, feature-submit, research-submit, research-autopilot, conduct, deploy, sessions-close, dev-server open, proxy subcommands, next, help
- Updated Table of Contents to reflect section renames

## Decisions
- Kept `feature-eval` references in Fleet mode contexts — they are accurate there
- Feedback YAML front matter references left intact — feedback items correctly use YAML front matter (only agent status tracking was wrong)
- Kept full install-agent ownership tables in README as the canonical source; GUIDE Contributing section now links there
- Added "(Fleet only)" annotation to feature-eval in command surfaces table and CLI reference
