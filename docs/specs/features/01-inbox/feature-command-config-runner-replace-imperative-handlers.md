# Feature: command-config-runner-replace-imperative-handlers

## Summary
Replace the imperative parse-validate-execute pattern repeated 40+ times across feature.js (3,516 lines), setup.js (2,686 lines), and infra.js (1,560 lines) with a declarative command config pattern. Each command becomes a config object `{ name, args, validate, steps[] }` executed by a generic runner in `lib/command-runner.js`. The runner handles arg parsing, validation, error wrapping, and step sequencing — eliminating thousands of lines of duplicated control flow.

## User Stories
- [ ] As a maintainer, I want each command defined as a config object so I can understand its behavior without reading imperative code
- [ ] As a contributor, I want to add a new command by writing a 15-line config object instead of a 60-line handler function
- [ ] As a tester, I want commands defined declaratively so I can validate configs without executing them

## Acceptance Criteria
- [ ] `lib/command-runner.js` exists: generic runner that takes a command config and executes it (<150 lines)
- [ ] Command configs define: name, argSpec (positional + flags), validate(args, ctx), steps[] (each a function(args, ctx))
- [ ] Runner handles: arg parsing, validation errors, step sequencing, error wrapping, dry-run support
- [ ] `lib/commands/feature.js` under 2,000 lines (from 3,516)
- [ ] `lib/commands/setup.js` under 1,500 lines (from 2,686)
- [ ] `lib/commands/infra.js` under 800 lines (from 1,560)
- [ ] All existing `npm test` and syntax checks pass
- [ ] No behavioral changes to any command — pure refactor

## Validation
```bash
wc -l lib/command-runner.js        # expect < 150
wc -l lib/commands/feature.js      # expect < 2000
wc -l lib/commands/setup.js        # expect < 1500
wc -l lib/commands/infra.js        # expect < 800
node --check aigon-cli.js
npm test
```

## Technical Approach
- Identify the repeated pattern: parse args, validate preconditions, execute steps, handle errors, print result
- Extract into `lib/command-runner.js`: `runCommand(config, rawArgs, ctx)` that does the scaffolding
- Convert commands one file at a time (feature.js first — largest win)
- Each command's unique logic stays as step functions; only the boilerplate moves to the runner
- Config objects stay in their respective command files (not a separate config file)

## Dependencies
- None — pure internal refactor

## Out of Scope
- Changing command names or CLI interface
- Adding new commands
- Modifying the ctx pattern or buildCtx()
