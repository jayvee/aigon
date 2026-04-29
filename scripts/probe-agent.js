#!/usr/bin/env node
'use strict';

/**
 * Agent/model health probe.
 *
 * Sends a trivial one-shot prompt to each agent's CLI and reports PASS/FAIL.
 * Use this to verify a model is reachable and responding before assigning it work.
 *
 * Usage:
 *   node scripts/probe-agent.js [agent]              # probe default model for one agent
 *   node scripts/probe-agent.js [agent] --all        # probe all non-quarantined models
 *   node scripts/probe-agent.js --all-agents         # probe default model for all agents
 *   node scripts/probe-agent.js [agent] --model <id> # probe a specific model value
 *
 * Also registered as: aigon agent-probe [agent] [flags]
 *
 * Agents without a headless CLI (cu) are skipped automatically.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const AGENTS_DIR = path.join(__dirname, '..', 'templates', 'agents');
const TIMEOUT_MS = 45_000;
const PROBE_PROMPT = 'Reply with exactly the word PONG and nothing else. No explanation, no punctuation, no markdown.';

// Agents that support headless invocation and how to call them.
// Returns [binary, args] or null if the agent can't be probed headlessly.
function buildCmd(agentConfig, modelValue) {
    const id = agentConfig.id;
    const modelFlag = agentConfig.cli && agentConfig.cli.modelFlag;
    const modelArgs = modelValue && modelFlag ? [modelFlag, modelValue] : [];

    switch (id) {
        case 'cc':
            return ['claude', ['-p', PROBE_PROMPT, ...modelArgs]];
        case 'op':
            // opencode uses -m not --model
            return modelValue
                ? ['opencode', ['run', '-m', modelValue, PROBE_PROMPT]]
                : ['opencode', ['run', PROBE_PROMPT]];
        case 'gg':
            return ['gemini', ['-p', PROBE_PROMPT, ...modelArgs]];
        case 'cx':
            // codex uses -m not --model for exec
            return modelValue
                ? ['codex', ['exec', '-m', modelValue, PROBE_PROMPT]]
                : ['codex', ['exec', PROBE_PROMPT]];
        default:
            return null; // cu and others — no headless mode
    }
}

function loadAgent(id) {
    const file = path.join(AGENTS_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function listAllAgentIds() {
    return fs.readdirSync(AGENTS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, f), 'utf8')).id; } catch { return null; }
        })
        .filter(Boolean);
}

function getModelOptions(agentConfig) {
    return Array.isArray(agentConfig.cli && agentConfig.cli.modelOptions)
        ? agentConfig.cli.modelOptions
        : [];
}

function isQuarantined(opt) {
    return Boolean(opt && (opt.quarantined || opt.archived));
}

function runProbe(agentConfig, modelValue, modelLabel) {
    const cmd = buildCmd(agentConfig, modelValue);
    if (!cmd) {
        return { skipped: true, reason: 'no headless CLI' };
    }

    const [bin, args] = cmd;
    const start = Date.now();
    const result = spawnSync(bin, args, {
        timeout: TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
    });
    const elapsed = Date.now() - start;

    if (result.error) {
        const isTimeout = result.error.code === 'ETIMEDOUT' || result.error.killed;
        return { ok: false, elapsed, error: isTimeout ? `TIMEOUT (>${Math.round(TIMEOUT_MS / 1000)}s)` : result.error.message };
    }
    if (result.status !== 0) {
        const stderr = (result.stderr || '').trim().split('\n')[0]; // first line only
        return { ok: false, elapsed, error: stderr || `exit ${result.status}` };
    }
    const stdout = (result.stdout || '').trim();
    if (!stdout) {
        return { ok: false, elapsed, error: 'empty response' };
    }
    return { ok: true, elapsed, output: stdout.slice(0, 100) };
}

function fmtMs(ms) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtResult(status, result) {
    const tag = status === 'PASS' ? '\x1b[32mPASS\x1b[0m'
        : status === 'SKIP' ? '\x1b[33mSKIP\x1b[0m'
        : '\x1b[31mFAIL\x1b[0m';
    const detail = result.ok
        ? `${fmtMs(result.elapsed)}  ${result.output}`
        : result.skipped
        ? result.reason
        : `${result.error}${result.elapsed ? `  (${fmtMs(result.elapsed)})` : ''}`;
    return `${tag}  ${detail}`;
}

// ── argument parsing ─────────────────────────────────────────────────────────

function resolveTargets(config, { explicitModel = null, allModels = false } = {}) {
    const allOpts = getModelOptions(config);
    if (explicitModel) return [{ value: explicitModel, label: explicitModel }];
    if (allModels) {
        const targets = allOpts.filter(o => !isQuarantined(o));
        return targets.length === 0 ? [{ value: null, label: '(agent default)' }] : targets;
    }
    const first = allOpts.find(o => !isQuarantined(o) && o.value !== null);
    return [first || { value: null, label: '(agent default)' }];
}

function main(argv = process.argv.slice(2)) {
    const allAgentsFlag = argv.includes('--all-agents');
    const allModelsFlag = argv.includes('--all') || argv.includes('--all-models');
    const modelArgIdx = argv.indexOf('--model');
    const explicitModel = modelArgIdx >= 0 ? argv[modelArgIdx + 1] : null;
    const positional = argv.find(a => !a.startsWith('-') && argv[argv.indexOf(a) - 1] !== '--model');
    const targetAgentId = positional || null;
    const agentIds = allAgentsFlag
        ? listAllAgentIds()
        : targetAgentId
        ? [targetAgentId]
        : ['cc', 'op', 'gg', 'cx']; // default: all probeable agents

    const rows = [];
    const colW = { agent: 4, model: 44 };

    for (const agentId of agentIds) {
        const config = loadAgent(agentId);
        if (!config) {
            console.error(`Unknown agent: ${agentId}`);
            return 1;
        }

        for (const target of resolveTargets(config, { explicitModel, allModels: allModelsFlag })) {
            const label = target.label || target.value || '(agent default)';
            process.stdout.write(`  ${agentId.padEnd(4)}  ${label.slice(0, colW.model).padEnd(colW.model)}  `);
            const result = runProbe(config, target.value, label);
            const status = result.skipped ? 'SKIP' : result.ok ? 'PASS' : 'FAIL';
            console.log(fmtResult(status, result));
            rows.push({ agentId, model: target.value, label, status, result });
        }
    }

    const failed = rows.filter(r => r.status === 'FAIL');
    const passed = rows.filter(r => r.status === 'PASS');
    const skipped = rows.filter(r => r.status === 'SKIP');

    console.log(`\n${passed.length} passed  ${failed.length} failed  ${skipped.length} skipped`);
    return failed.length > 0 ? 1 : 0;
}

module.exports = {
    buildCmd,
    loadAgent,
    listAllAgentIds,
    getModelOptions,
    isQuarantined,
    runProbe,
    resolveTargets,
    fmtMs,
    main,
};

if (require.main === module) {
    process.exit(main());
}
