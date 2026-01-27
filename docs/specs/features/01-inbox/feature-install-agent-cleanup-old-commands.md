# Feature: install-agent-cleanup-old-commands

## Summary

When running `aigon install-agent`, automatically detect and remove command files that are no longer in the agent's command list. Currently, if a command is renamed or removed from the templates, the old file remains in the project's command directory, causing stale/duplicate commands to appear in the agent's slash command menu.

## User Stories

- [ ] As a user, when I update aigon and run `install-agent`, I want old/renamed commands to be removed automatically so I don't see duplicates
- [ ] As a user, I want to be informed which files were removed so I understand what changed

## Acceptance Criteria

- [ ] `install-agent` detects existing command files in the agent's command directory
- [ ] Compares existing files against the current command list from the agent config
- [ ] Removes files that match the aigon naming pattern but are not in the current command list
- [ ] Only removes files with the agent's command prefix (e.g., `aigon-*.md` for Claude)
- [ ] Prints which files were removed
- [ ] Works for all agents (cc, gg, cx)

## Technical Approach

1. After installing commands, scan the command directory for files matching the agent's pattern
2. Build list of expected files from `config.commands`
3. Compare and identify orphaned files (exist on disk but not in command list)
4. Remove orphaned files and log the removal

Example logic:
```javascript
// After installing commands
const existingFiles = fs.readdirSync(cmdDir).filter(f =>
  f.startsWith(config.output.commandFilePrefix) &&
  f.endsWith(config.output.commandFileExtension)
);

const expectedFiles = config.commands.map(cmd =>
  `${config.output.commandFilePrefix}${cmd}${config.output.commandFileExtension}`
);

const orphanedFiles = existingFiles.filter(f => !expectedFiles.includes(f));

orphanedFiles.forEach(f => {
  fs.unlinkSync(path.join(cmdDir, f));
  console.log(`   🗑️  Removed obsolete: ${f}`);
});
```

## Dependencies

- Agent config system (`templates/agents/*.json`)
- `install-agent` command

## Out of Scope

- Cleaning up files outside the command directory
- Cleaning up non-aigon files (user's custom commands)
- Interactive confirmation before deletion

## Open Questions

- Should there be a `--no-cleanup` flag to skip removal?
- Should removed files be listed at the end as a summary, or inline during install?

## Related

- `install-agent` command in `aigon-cli.js`
- Agent configs: `templates/agents/*.json`
