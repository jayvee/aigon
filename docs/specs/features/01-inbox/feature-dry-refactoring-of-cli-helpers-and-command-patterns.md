# Feature: DRY refactoring of CLI helpers and command patterns

## Summary

Deduplicate repeated patterns across `aigon-cli.js` by extracting shared helpers, unifying command registration, and consolidating boilerplate. This is Phase 2 of the CLI modularization effort, building on Phase 1 (data extraction). The goal is to reduce the main file by ~1,000–1,500 additional lines while making the remaining code easier to understand and maintain. All changes are internal refactors — the CLI's external behavior is unchanged.

## User Stories

- [ ] As a developer, I can add a new command by defining it in one place (handler + metadata together) instead of updating 5 separate data structures
- [ ] As a developer, I can understand the "find spec → parse → modify → write" pattern once in a shared helper, instead of re-reading it in 8 different commands
- [ ] As a developer, I can modify the "next steps" output format in one place instead of hunting down 15+ similar `console.log` chains
- [ ] As a developer, I can set up a worktree environment by calling one function instead of reading 40 lines of repeated setup code

## Acceptance Criteria

### Command registry unification
- [ ] Commands are defined using a single registry pattern that co-locates: handler function, aliases, argument hints, description, and `disableModelInvocation` flag
- [ ] `COMMAND_ALIASES`, `COMMAND_ALIAS_REVERSE`, `COMMAND_ARG_HINTS`, and `COMMANDS_DISABLE_MODEL_INVOCATION` are derived automatically from the registry (not maintained as separate objects)
- [ ] The `help` command text (extracted to file in Phase 1) is still maintained separately (auto-generation from registry is out of scope — that's a future enhancement)

### Spec file workflow helper
- [ ] A shared `modifySpecFile(filePath, modifierFn)` helper handles the read → parseFrontMatter → modify → serialize → write cycle
- [ ] Used by: `feature-prioritise`, `feature-setup`, `feature-done`, `research-prioritise`, `research-setup`, `research-done`, `feedback-triage` (and any other commands that follow this pattern)
- [ ] Eliminates ~150–200 lines of duplicated boilerplate

### Console output helpers
- [ ] A `printNextSteps(items)` helper standardizes the "next step" suggestion blocks that appear in ~15 commands
- [ ] A `printSpecInfo({ type, id, name, specPath, logPath })` helper standardizes the spec-created/spec-moved output that appears in ~10 commands
- [ ] A `printError(type, id, folders)` helper standardizes "Could not find {type}" error messages
- [ ] Eliminates ~200–280 lines of duplicated console.log chains

### Create-family factory
- [ ] `feature-create`, `research-create`, and `feedback-create` share a `createSpecFile({ type, name, templatePath, inboxPath, ... })` factory
- [ ] Each command's unique logic (e.g., feedback uses `slugify()` and `getNextId()`) is passed as options, not duplicated
- [ ] Eliminates ~80–120 lines

### Worktree/environment setup helper
- [ ] A shared `setupWorktreeEnvironment(worktreePath, { port, agents, envVars })` function consolidates the repeated pattern of: create dirs, write `.env.local`, write `.claude/settings.json`, configure agent permissions
- [ ] Used by: `feature-setup`, `research-setup`, and `feature-implement`
- [ ] Eliminates ~90–120 lines

### Tmux session helper
- [ ] A shared `ensureAgentSessions(entityId, agents, worktreeBasePath, commandBuilder)` function consolidates the repeated pattern of: build session name, check if exists, create if not, spawn agent command
- [ ] Used by: `feature-setup`, `research-setup`, `research-open`, `research-conduct`
- [ ] Eliminates ~80–150 lines

### Dev server URL resolution
- [ ] The duplicated URL-resolution logic in `dev-server url` and `dev-server open` subcommands is extracted to a single `resolveDevServerUrl()` function
- [ ] Eliminates ~25 lines of exact copy-paste

### General
- [ ] `node -c aigon-cli.js` passes (syntax check)
- [ ] All existing commands produce identical output and behavior
- [ ] No dead code remains — any functions made redundant by the new helpers are removed

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

### Command registry pattern

Replace the scattered metadata objects with a single registry:

```javascript
const COMMAND_REGISTRY = {
    'feature-create': {
        handler: (args) => { /* ... */ },
        aliases: ['afc'],
        argHints: '<feature-name>',
        disableModelInvocation: false,
    },
    // ...
};

// Derived at startup (replaces hand-maintained objects)
const commands = {};
const COMMAND_ALIASES = {};
const COMMAND_ARG_HINTS = {};
const COMMANDS_DISABLE_MODEL_INVOCATION = new Set();

for (const [name, def] of Object.entries(COMMAND_REGISTRY)) {
    commands[name] = def.handler;
    if (def.argHints) COMMAND_ARG_HINTS[name] = def.argHints;
    if (def.disableModelInvocation) COMMANDS_DISABLE_MODEL_INVOCATION.add(name);
    (def.aliases || []).forEach(alias => {
        COMMAND_ALIASES[alias] = name;
        commands[alias] = def.handler;
    });
}
```

This is backward-compatible — the derived objects have the same shape.

### Spec file workflow helper

```javascript
function modifySpecFile(filePath, modifierFn) {
    const content = fs.readFileSync(filePath, 'utf8');
    const { data, body } = parseFrontMatter(content);
    const result = modifierFn(data, body);
    const newData = result.data || data;
    const newBody = result.body !== undefined ? result.body : body;
    const updated = serializeFrontMatter(newData) + '\n' + newBody;
    fs.writeFileSync(filePath, updated);
    return { data: newData, body: newBody };
}
```

### Console output helpers

```javascript
function printNextSteps(lines) {
    console.log('\n' + lines.map(l => `   ${l}`).join('\n'));
}

function printSpecInfo({ type, id, name, specPath, logPath, nextCommand }) {
    const paddedId = String(id).padStart(2, '0');
    const icon = type === 'feature' ? '📋' : type === 'research' ? '🔬' : '💬';
    console.log(`\n${icon} ${type.charAt(0).toUpperCase() + type.slice(1)} ${paddedId}: ${name}`);
    if (specPath) console.log(`   Spec: ./${specPath}`);
    if (logPath) console.log(`   Log:  ./${logPath}`);
    if (nextCommand) console.log(`\n💡 Next: ${nextCommand}`);
}
```

### Incremental approach

Each helper is introduced independently:
1. Write the helper function
2. Replace ONE call site and verify with `node -c` + manual test
3. Replace remaining call sites
4. Remove any dead code

This minimizes risk — if a helper is wrong, only one command is affected at a time.

## Dependencies

- Phase 1 (Extract inline data) should land first — reduces file size and avoids merge conflicts
- Should ideally land BEFORE feature-46 (command-vocabulary-rename) since the registry pattern makes renames much simpler

## Out of Scope

- Splitting into separate files / `lib/` modules (Phase 3)
- Auto-generating help text from the command registry (future enhancement)
- Adding TypeScript or JSDoc type annotations
- Changing any CLI behavior, command names, or output format
- Refactoring the `conductor` or `dashboard` commands (complex but not duplicated)

## Open Questions

- Should the command registry use a class-based approach or stay with plain objects? (Recommendation: plain objects — simpler, no `this` binding issues, aligns with existing style)
- Should `modifySpecFile` return the parsed data for chaining, or is void sufficient? (Recommendation: return `{ data, body }` for flexibility)

## Related

- Phase 1: "Extract inline data and templates from CLI monolith"
- Phase 3: "Modularize CLI into lib/ modules" (to be created)
- Current file: `aigon-cli.js` (will be ~9,500–10,000 lines after Phase 1)
