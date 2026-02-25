<!-- description: Kill all agent sessions for a feature/research ID and close Warp tab -->
# aigon-sessions-close

Kill all running agent processes for a given feature or research ID, and close the Warp arena tab.

## Usage

```bash
{{CMD_PREFIX}}sessions-close <ID>
```

- `{{CMD_PREFIX}}sessions-close 05` — close all agent sessions for research/feature #05
- `{{CMD_PREFIX}}sessions-close 55` — close all agent sessions for feature #55

## When to Use

Use this after agents have **submitted** their work (research findings or feature implementation) and you want to tear down the arena quickly without typing `exit` in each pane.

## What It Does

1. Kills all running agent processes whose command line contains the ID (feature-implement, feature-review, research-conduct)
2. Attempts to close the Warp arena tab/window via AppleScript (best-effort)
3. Reports what was killed

Works for both **feature** arenas (`arena-feature-55`) and **research** arenas (`arena-research-05`).

## Example

After agents have submitted:
```bash
aigon sessions-close 55
```

Output:
```
Closing all agent sessions for #55...

   ✓ Killed: aigon:feature-implement 55
   ✓ Killed: aigon:feature-implement 55

✅ Warp arena tab closed.
```

## Notes

- If no processes are running (agents already exited), it prints a notice and still tries to close the Warp tab
- Warp tab close is best-effort — if AppleScript can't find the window, you'll see a reminder to close it manually
- Works for any mix of agents (cc, gg, cx, cu)

## Step 1: Run the CLI command

```bash
aigon sessions-close {{ARG_SYNTAX}}
```

## Step 2: Confirm to user

Tell the user:
- Which sessions were closed
- Whether the Warp tab was closed automatically

ARGUMENTS: {{ARG_SYNTAX}}
