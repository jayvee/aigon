# Feature: Fix Use AI button in spec drawer to open native terminal instead of running agent synchronously

## Summary

The "Use AI" button in the spec drawer (`launchAiSession`) currently calls `/api/session/run` which runs the agent command synchronously and waits for it to exit. Interactive agents (claude, gemini, codex) run indefinitely, so this hangs the browser until the server times out. The fix is to use `/api/session/ask` instead — open a native terminal window running the agent command, and show "Session opened in your terminal" in the panel, matching how all other terminal-mode actions work post-feature-70.

Additionally, the agent should be **pre-prompted with the spec file** so it's immediately ready to discuss and refine the document — the user shouldn't have to explain what they want to work on. The prompt wording should vary by spec type (feature, research, feedback) since each has a different refinement goal.

## User Stories

- [ ] As a user, I click "Use AI" on a spec in the drawer and a native terminal window opens with the agent already running, so I can interact with it directly
- [ ] As a user, the dashboard panel shows "Session opened in your terminal" immediately after clicking "Use AI", without hanging waiting for the agent to exit
- [ ] As a user, the agent already knows which spec I want to work on and is ready to help me refine it — I don't need to paste a file path or explain the context

## Acceptance Criteria

- [ ] Clicking "Use AI" in the spec drawer calls `POST /api/session/ask` with `repoPath`, `agentId`, and the new `prompt` field containing the spec-aware initial prompt
- [ ] A native terminal window opens (Terminal.app / iTerm2 per user config) with the agent command running
- [ ] The agent receives an initial prompt that includes the spec file path and a type-appropriate instruction
- [ ] The terminal panel overlay shows "Session opened in your terminal" immediately (no spinner, no hang)
- [ ] No call to `/api/session/run` or `/api/session/start` is made from `launchAiSession`
- [ ] `node -c` passes on all JS files

### Initial prompt wording by spec type

The prompt should instruct the agent to read the spec and collaborate on refining it — **not** to implement anything.

- **Feature**: `"Read the feature spec at {specPath} and let's discuss and refine it together. Help me improve the summary, acceptance criteria, and technical approach. Don't implement anything."`
- **Research**: `"Read the research topic at {specPath} and let's discuss and refine it together. Help me sharpen the research questions and scope. Don't write any code."`
- **Feedback**: `"Read the feedback item at {specPath} and let's discuss it together. Help me clarify the problem, assess severity, and decide on next steps."`

## Validation

```bash
node -c lib/utils.js && node -c lib/commands/shared.js && node -c templates/dashboard/index.html 2>/dev/null || echo "HTML not node-checkable (ok)"
npm test
```

## Technical Approach

### Client side (dashboard HTML)

In `templates/dashboard/index.html`, the `launchAiSession` function:

**Current (broken):**
```js
const res = await fetch('/api/session/run', { ... body: { command, cwd } });
const data = await res.json();
const output = (data.stdout || '') + ...;
openTerminalPanel(label, command, null, output || 'Session launched.', specCtx);
```

**New:**
```js
// Build the type-aware initial prompt
const specType = specCtx.type; // 'feature', 'research', or 'feedback'
const prompts = {
    feature: `Read the feature spec at ${specCtx.filePath} and let's discuss and refine it together. Help me improve the summary, acceptance criteria, and technical approach. Don't implement anything.`,
    research: `Read the research topic at ${specCtx.filePath} and let's discuss and refine it together. Help me sharpen the research questions and scope. Don't write any code.`,
    feedback: `Read the feedback item at ${specCtx.filePath} and let's discuss it together. Help me clarify the problem, assess severity, and decide on next steps.`,
};
const prompt = prompts[specType] || prompts.feature;

const res = await fetch('/api/session/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, agentId, prompt })
});
if (!res.ok) { showToast('Failed to open terminal: ' + (await res.json()).error); return; }
openTerminalPanel(label, command, null, null, specCtx);
// panel shows "Session opened in your terminal"
```

### Server side (dashboard-server.js)

The `/api/session/ask` endpoint (line ~1145) needs a small change: accept an optional `prompt` field from the payload and pass it as the initial prompt argument to the agent command. Currently the endpoint just launches a bare agent — it should append the prompt like:

```js
const prompt = String(payload.prompt || '').trim();
// ... existing session logic ...
const agentCmd = prompt
    ? `${agentBin} ${flags} "${prompt}"`
    : (flags ? `${agentBin} ${flags}` : agentBin);
```

The spec drawer already knows the spec type and file path from `specCtx`, so no new data lookups are needed on the client side.

## Dependencies

- Feature 70 (dashboard infrastructure rebuild) — must be merged first, as `/api/session/ask` and `openTerminalAppWithCommand` were introduced there

## Out of Scope

- Changing how agent picker works or which agents are offered
- Tracking the agent session or showing output in the panel
- Implementation-mode prompting (that's what `feature-do` / `feature-open` is for)

## Open Questions

-

## Related

- Feature 70: Dashboard Infrastructure Rebuild (introduced `/api/session/ask` and `/api/open-terminal`)
