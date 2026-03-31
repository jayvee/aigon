# Feature: data-driven-terminal-detection

## Summary
worktree.js (1,852 lines) has ~500 lines of terminal detection and dispatch as nested if/else chains covering iTerm2, Warp, tmux, cmux, and Linux terminals. Replace with a terminal capability table in `lib/terminal-adapters.js`: each terminal is a config object `{ name, detect(), launch(), split(), focus() }`. The detection/dispatch code in worktree.js becomes a 30-line loop that finds the first matching adapter and calls its methods.

## User Stories
- [ ] As a maintainer, I want to add support for a new terminal by writing a 15-line adapter object
- [ ] As a contributor, I want terminal logic isolated so I can test iTerm2 detection without loading worktree code
- [ ] As a user on Linux, I want terminal detection to work reliably because each terminal's logic is self-contained

## Acceptance Criteria
- [ ] `lib/terminal-adapters.js` exists: adapter table + adapter objects (<200 lines)
- [ ] Each adapter is a plain object: `{ name, detect(env), launch(cmd, opts), split(cmd, opts) }`
- [ ] `lib/worktree.js` under 1,200 lines (from 1,852)
- [ ] Adapter selection in worktree.js is a loop: `adapters.find(a => a.detect(env))` (<30 lines)
- [ ] All terminal launch paths produce identical behavior — pure refactor
- [ ] tmux session management stays in worktree.js (it's worktree logic, not terminal logic)

## Validation
```bash
wc -l lib/terminal-adapters.js     # expect < 200
wc -l lib/worktree.js              # expect < 1200
node --check lib/terminal-adapters.js
node --check lib/worktree.js
npm test
```

## Technical Approach
- Catalog every terminal detection branch in worktree.js (grep for `TERM_PROGRAM`, `WARP`, `iTerm`, `tmux`)
- Define adapter interface: detect(env) returns bool, launch(cmd, opts) opens terminal, split(cmd, opts) splits pane
- Extract each terminal's if/else block into an adapter object
- Order adapters by specificity (Warp before generic, tmux before plain terminal)
- Replace worktree.js detection code with `const adapter = adapters.find(a => a.detect(process.env))`

## Dependencies
- None — pure internal refactor

## Out of Scope
- Adding new terminal support (that's the payoff, not this feature)
- Changing tmux session naming or worktree layout
- Modifying the shell trap signal infrastructure
