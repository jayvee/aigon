# Implementation Log: Feature 523 - settings-change-regenerates-agent-instructions
Agent: cc

Added `lib/agent-instructions-regen.js` (helper that spawns `install-agent --all` + commits via spawnSync) and wired it into PUT /api/settings and `aigon config set`; schema flag `affectsInstalledCommands` on `profile`/`devServer.enabled`, with a CLI-only key set covering `instructions.*`. Toast surfaced via existing `updateDashboardSetting` helper.
