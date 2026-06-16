'use strict';

const { createDetachedTmuxSession, tmuxSessionExists, openTerminalAppWithCommand, shellQuote } = require('../worktree');

function ensureTmuxSession(sessionName, cwd, buildCmd, meta) {
    if (!tmuxSessionExists(sessionName)) {
        createDetachedTmuxSession(sessionName, cwd, buildCmd(), meta);
    }
    openTerminalAppWithCommand(cwd, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
}

module.exports = {
    ensureTmuxSession,
};
