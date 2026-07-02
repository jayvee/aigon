'use strict';

const path = require('path');
const stateMachine = require('./state-queries');
const featureSpecResolver = require('./feature-spec-resolver');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { CLI_ENTRY_PATH } = require('./config');
const { shellQuote } = require('./worktree');

function tokenizeDashboardCommand(command) {
    const input = String(command || '').trim();
    if (!input) return [];
    const tokens = [];
    const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
    let match;
    while ((match = re.exec(input))) {
        tokens.push((match[1] || match[2] || match[3] || '').replace(/\\(["'])/g, '$1'));
    }
    return tokens;
}

function resolveDashboardSessionCommand(command) {
    const tokens = tokenizeDashboardCommand(command);
    if (tokens.length === 0) {
        throw new Error('command is required');
    }

    if (tokens[0] === '/afe' && tokens.length === 2) {
        return { bin: CLI_ENTRY_PATH, args: ['feature-eval', tokens[1]] };
    }
    if (tokens[0] === '/are' && tokens.length === 2) {
        return { bin: CLI_ENTRY_PATH, args: ['research-eval', tokens[1]] };
    }
    if (tokens[0] === 'aigon') {
        return { bin: CLI_ENTRY_PATH, args: tokens.slice(1) };
    }

    throw new Error(`Unsupported dashboard command: ${tokens[0]}`);
}

const DASHBOARD_INTERACTIVE_ACTIONS = new Set([
    'apply',
    'feature-create',
    'feature-prioritise',
    'feature-unprioritise',
    'feature-start',
    'feature-do',
    'feature-open',
    'feature-code-review',
    'feature-code-revise',
    'feature-review',
    'research-review',
    'feature-eval',
    'feature-push',
    'feature-rebase',
    'feature-close',
    'feature-delete',
    'feature-reset',
    'feature-cancel-spec-review',
    'feature-cancel-spec-revision',
    'feature-cancel-code-review',
    'research-delete',
    'research-reset',
    'research-cancel-spec-review',
    'research-cancel-spec-revision',
    'research-cancel-code-review',
    'feature-autonomous-start',
    'feature-autonomous-resume',
    'feature-autonomous-stop',
    'feature-stop',
    'dev-server',
    'agent-resume',
    'drop-agent',
    'research-prioritise',
    'research-unprioritise',
    'research-stop',
    'research-start',
    'research-eval',
    'research-close',
    'feedback-triage',
    'feedback-promote',
    'set-prioritise',
    'feature-set-spec-review',
    'feature-set-spec-revise',
    'set-autonomous-start',
    'set-autonomous-stop',
    'set-autonomous-resume',
    'set-autonomous-reset',
    'storage',
]);

const SM_INVOCABLE_ACTIONS = (() => {
    const s = new Set();
    const allDefs = [
        stateMachine.ENTITY_DEFINITIONS.feedback,
        { transitions: stateMachine.FEATURE_TRANSITIONS, actions: stateMachine.FEATURE_ACTIONS },
        { transitions: stateMachine.RESEARCH_TRANSITIONS, actions: stateMachine.RESEARCH_ACTIONS },
    ];
    allDefs.forEach(def => {
        if (!def) return;
        (def.transitions || []).forEach(t => s.add(t.action));
        (def.actions || []).filter(a => a.mode !== 'terminal').forEach(a => s.add(a.action));
    });
    return s;
})();

function resolveDashboardActionRepoPath(requestedRepoPath, registeredRepos, defaultRepoPath = process.cwd()) {
    const repos = (Array.isArray(registeredRepos) ? registeredRepos : []).map(repo => path.resolve(String(repo)));
    const defaultRepo = defaultRepoPath ? path.resolve(String(defaultRepoPath)) : '';
    const requested = requestedRepoPath ? path.resolve(String(requestedRepoPath)) : '';

    if (requested) {
        if (repos.length > 0 && !repos.includes(requested)) {
            return { ok: false, status: 403, error: 'repoPath is not registered with dashboard' };
        }
        return { ok: true, repoPath: requested };
    }

    if (repos.length === 1) {
        return { ok: true, repoPath: repos[0] };
    }

    if (repos.length > 1) {
        if (defaultRepo && repos.includes(defaultRepo)) {
            return { ok: true, repoPath: defaultRepo };
        }
        return { ok: false, status: 400, error: 'repoPath is required when multiple repos are registered' };
    }

    return { ok: true, repoPath: defaultRepo || process.cwd() };
}

function parseDashboardActionRequest(payload, options = {}) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const action = String(data.action || '').trim();
    if (!action) {
        return { ok: false, status: 400, error: 'action is required' };
    }
    if (!DASHBOARD_INTERACTIVE_ACTIONS.has(action) && !SM_INVOCABLE_ACTIONS.has(action)) {
        return { ok: false, status: 400, error: `Unsupported action: ${action}` };
    }

    const argsRaw = data.args === undefined ? [] : data.args;
    if (!Array.isArray(argsRaw)) {
        return { ok: false, status: 400, error: 'args must be an array of strings' };
    }

    const args = [];
    for (const value of argsRaw) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            args.push(String(value));
            continue;
        }
        return { ok: false, status: 400, error: 'args must contain only strings, numbers, or booleans' };
    }

    const repoResolution = resolveDashboardActionRepoPath(
        data.repoPath,
        options.registeredRepos || [],
        options.defaultRepoPath || process.cwd()
    );
    if (!repoResolution.ok) return repoResolution;

    return {
        ok: true,
        action,
        args,
        repoPath: repoResolution.repoPath
    };
}

function buildDashboardActionCommandArgs(action, args) {
    const actionName = String(action || '').trim();
    const actionArgs = Array.isArray(args) ? args.map(value => String(value)) : [];
    return [CLI_ENTRY_PATH, actionName, ...actionArgs];
}

function verifyFeatureStartRegistration(repoPath, featureId, expectedAgents) {
    const fs = require('fs');
    const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, featureId);
    if (snapshot && snapshot.agents) {
        const registeredAgents = Object.keys(snapshot.agents);
        const missing = expectedAgents.filter(agent => !registeredAgents.includes(agent));
        if (missing.length > 0) {
            return { ok: false, error: `Agents not registered in workflow snapshot: ${missing.join(', ')}` };
        }
        return { ok: true };
    }

    const manifestPath = path.join(repoPath, '.aigon', 'state', `feature-${featureId}.json`);
    if (!fs.existsSync(manifestPath)) {
        return { ok: false, error: `feature-start completed without creating workflow snapshot or manifest for feature ${featureId}` };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const registeredAgents = Array.isArray(manifest.agents) ? manifest.agents : [];
    const missing = expectedAgents.filter(agent => !registeredAgents.includes(agent));
    if (missing.length > 0) {
        return { ok: false, error: `Agents not registered in manifest: ${missing.join(', ')}` };
    }
    return { ok: true };
}

function resolveFeatureSpecForReconcile(repoPath, entityType, entityId) {
    return entityType === 'research'
        ? featureSpecResolver.resolveResearchSpec(repoPath, entityId)
        : featureSpecResolver.resolveFeatureSpec(repoPath, entityId);
}

module.exports = {
    DASHBOARD_INTERACTIVE_ACTIONS,
    resolveDashboardActionRepoPath,
    parseDashboardActionRequest,
    buildDashboardActionCommandArgs,
    resolveDashboardSessionCommand,
    verifyFeatureStartRegistration,
    resolveFeatureSpecForReconcile,
    shellQuote,
};
