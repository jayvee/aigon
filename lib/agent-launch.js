'use strict';

/**
 * Central "how does an agent get its {model, effort} at launch" module.
 *
 * Every spawn path (feature-start, autoconductor run-loop, dashboard
 * restart, feature-open, autopilot iterate retry) must route through
 * `resolveLaunchTriplet` so the per-feature override captured on
 * `feature.started` is honoured end-to-end. Bypassing this helper is what
 * caused the silent-revert bug that motivated feature 291 — if a new spawn
 * site reads `cliConfig.models[...]` directly, it will miss the override.
 *
 * See `tests/unit/agent-launch-helper.test.js` for the round-trip
 * contract.
 */

const agentRegistry = require('./agent-registry');

/**
 * Resolve the {model, effort} triplet that a spawn should use for a
 * specific agent on a specific feature.
 *
 * Precedence (highest wins):
 *   1. event-log override (from snapshot.agents[id].modelOverride/effortOverride)
 *   2. caller-supplied default for the stage (e.g. cliConfig.models[taskType])
 *   3. null (caller decides whether to pass no flag or use a hard default)
 *
 * @param {object} params
 * @param {string} params.agentId
 * @param {object|null} params.snapshot - engine snapshot (may be null for pre-engine spawns)
 * @param {string|null} [params.stageDefaultModel] - the cliConfig-resolved model for the current task type
 * @returns {{ model: string|null, effort: string|null, modelSource: string, effortSource: string }}
 */
function resolveLaunchTriplet({ agentId, snapshot, stageDefaultModel }) {
    const agent = snapshot && snapshot.agents && snapshot.agents[agentId];
    const modelOverride = agent && agent.modelOverride != null ? agent.modelOverride : null;
    const effortOverride = agent && agent.effortOverride != null ? agent.effortOverride : null;

    let model = null;
    let modelSource = 'none';
    if (modelOverride) {
        model = modelOverride;
        modelSource = 'event';
    } else if (stageDefaultModel) {
        model = stageDefaultModel;
        modelSource = 'config';
    }

    let effort = null;
    let effortSource = 'none';
    if (effortOverride) {
        effort = effortOverride;
        effortSource = 'event';
    }

    return { model, effort, modelSource, effortSource };
}

function _shellQuote(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/^[A-Za-z0-9_./:=-]+$/.test(s)) return s;
    return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the CLI-flag fragments and env exports that inject the resolved
 * triplet into an agent's launch command. Callers stitch these into their
 * own command string (or env export block) according to their transport.
 *
 * Returns:
 *   - args: string[] — CLI flag tokens to append, already shell-safe
 *   - envExports: string[] — `KEY=value` pairs (callers join with ` ` or `&&`)
 *   - envPairs: Record<string,string> — same, for programmatic spawn
 *
 * If the agent cannot inject (e.g. cu has no modelFlag), the corresponding
 * fragment is omitted silently. The override is still recorded on the
 * event log and surfaced on the dashboard — "intended" triplet is useful
 * for attribution even when the CLI can't honour it.
 */
function buildAgentLaunchInvocation({ agentId, snapshot, stageDefaultModel }) {
    const { model, effort, modelSource, effortSource } = resolveLaunchTriplet({
        agentId,
        snapshot,
        stageDefaultModel: stageDefaultModel || null,
    });

    const modelFlag = agentRegistry.getModelFlag(agentId);
    const effortFlag = agentRegistry.getEffortFlag(agentId);
    const effortEnv = agentRegistry.getEffortEnv(agentId);

    const args = [];
    const envPairs = {};

    if (model && modelFlag) {
        args.push(`${modelFlag} ${_shellQuote(model)}`);
    }

    if (effort && effortFlag) {
        // effortFlag may end with `=` (e.g. codex's `-c model_reasoning_effort=`)
        // or be a space-separated flag (e.g. `--effort`). Detect by the
        // trailing `=` and fuse, otherwise use a space.
        if (effortFlag.endsWith('=')) {
            args.push(`${effortFlag}${_shellQuote(effort)}`);
        } else {
            args.push(`${effortFlag} ${_shellQuote(effort)}`);
        }
    }

    if (effort && !effortFlag && effortEnv) {
        envPairs[effortEnv] = effort;
    }

    const envExports = Object.entries(envPairs).map(([key, value]) => `${key}=${_shellQuote(value)}`);

    return {
        args,
        envPairs,
        envExports,
        resolved: { model, effort, modelSource, effortSource },
    };
}

module.exports = {
    resolveLaunchTriplet,
    buildAgentLaunchInvocation,
};
