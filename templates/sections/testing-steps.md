## Step 4: Test your changes
The **dev server** runs the project's own local development server (whatever command the project uses), so you can verify your changes work correctly.
**IMPORTANT:** `aigon dev-server start` starts the **project's** dev server with managed port allocation. Do not confuse it with `aigon server`, which starts the Aigon dashboard.
### Drive Mode (branch)
- Start the dev server: `aigon dev-server start`
- Use the URL printed by the command to access the app
- Run the project's own tests / checks (if any) and verify they pass
- Ask the user to verify
### Worktree Mode (Drive worktree or Fleet)
