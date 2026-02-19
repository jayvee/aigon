# Implementation Log: Feature 14 - feedback-triage-workflow
Agent: cx

## Plan
- Add feedback CLI commands in `aigon-cli.js`: `feedback-create`, `feedback-list`, `feedback-triage`.
- Add front matter + metadata helpers for feedback docs (parse, normalize, write).
- Add triage support helpers (duplicate suggestions, recommendation hints, status-folder mapping).
- Add agent prompt templates and agent config wiring so install-agent ships feedback commands.
- Validate command behavior in a temp repo (`init` -> create -> list -> triage preview/apply).

## Progress
- Added feedback lifecycle constants and helpers in `aigon-cli.js`:
  - status/folder/action maps
  - CLI option parsing
  - YAML front matter parsing/serialization for feedback schema
  - metadata normalization and feedback collection utilities
  - duplicate candidate scoring (title + summary token similarity)
- Implemented `feedback-create`:
  - creates inbox feedback docs from shared template
  - assigns next numeric ID and slug-based filename
  - prints next triage step
- Implemented `feedback-list`:
  - supports status flags: `--inbox`, `--triaged`, `--actionable`, `--done`, `--wont-fix`, `--duplicate`, `--all`
  - supports metadata filters: `--type`, `--severity`, `--tag`/`--tags`
  - prints readable per-item output with status/type/severity/tags/path
- Implemented `feedback-triage`:
  - preview-first triage flow by default
  - applies updates only with explicit `--apply --yes`
  - updates front matter fields (`type`, `severity`, `tags`, `status`, `duplicate_of`)
  - moves files to lifecycle folder matching status
  - surfaces duplicate candidates and next-action recommendation
- Added new generic command templates:
  - `templates/generic/commands/feedback-create.md`
  - `templates/generic/commands/feedback-list.md`
  - `templates/generic/commands/feedback-triage.md`
- Updated agent command plumbing:
  - added feedback commands to `templates/agents/{cc,cx,gg,cu}.json`
  - updated `COMMAND_ARG_HINTS` in `aigon-cli.js`
  - updated CLI help text and generic help command template
  - updated agent docs template + codex agent doc to include feedback commands
- Validation:
  - `node --check aigon-cli.js`
  - temp repo flow:
    - `init`
    - `feedback-create`
    - `feedback-list --all`
    - `feedback-triage` preview
    - `feedback-triage ... --apply --yes` (front matter + folder move verified)
  - duplicate flow tested with second feedback item and `--status duplicate` (auto duplicate candidate + move verified)
  - install-agent generation tested (`install-agent cc`) to confirm command templates compile and install.

## Decisions
- Used a non-interactive triage safety model: default preview, explicit apply via `--apply --yes`. This satisfies the “human confirmation before applying changes” requirement without adding fragile TTY prompts.
- Kept feedback doc parsing/writing local to `aigon-cli.js` (no new dependencies) to match existing single-file CLI architecture.
- Implemented lightweight duplicate scoring with token-based similarity over title + summary (MVP-appropriate; deterministic and fast).
- Defaulted `feedback-list` (no status flags) to active lanes (`inbox`, `triaged`, `actionable`) and preserved `--all` for full lifecycle visibility.
