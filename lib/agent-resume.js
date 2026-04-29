'use strict';

/**
 * F446: Resume an agent session after mid-run quota pause.
 */

const fs = require('fs');
const path = require('path');

const agentStatusLib = require('./agent-status');
const quotaProbe = require('./quota-probe');
const wf = require('./workflow-core');
const {
    buildAgentCommand,
    buildTmuxSessionName,
    createDetachedTmuxSession,
    assertTmuxAvailable,
    toUnpaddedId,
} = require('./worktree');

function resolveMainRepo(cwd = process.cwd()) {
    let mainRepo = cwd;
    const worktreeJsonPath = path.join(cwd, '.aigon', 'worktree.json');
    if (fs.existsSync(worktreeJsonPath)) {
        try {
            const wj = JSON.parse(fs.readFileSync(worktreeJsonPath, 'utf8'));
            if (wj.mainRepo) mainRepo = path.resolve(wj.mainRepo);
        } catch (_) { /* keep cwd */ }
    } else if (process.env.AIGON_PROJECT_PATH) {
        mainRepo = path.resolve(process.env.AIGON_PROJECT_PATH);
    }
    return mainRepo;
}

function getSnapshot(repoPath, entityType, paddedId) {
    const snapPath = path.join(repoPath, '.aigon', 'workflows',
        entityType === 'research' ? 'research' : 'features', paddedId, 'snapshot.json');
    if (!fs.existsSync(snapPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function specDescFromSnapshot(snap, entityType, paddedId) {
    const sp = snap && snap.specPath;
    if (sp && fs.existsSync(sp)) {
        const base = path.basename(sp);
        if (entityType === 'research') {
            const m = base.match(/^research-\d+-(.+)\.md$/);
            return m ? m[1] : paddedId;
        }
        const m = base.match(/^feature-\d+-(.+)\.md$/);
        return m ? m[1] : paddedId;
    }
    return paddedId;
}

function findMatchingSidecar(repoPath, entityLetter, entityUnpadded, agentId, preferredSessionName) {
    const dir = path.join(repoPath, '.aigon', 'sessions');
    if (!fs.existsSync(dir)) return null;
    let best = null;
    let bestMt = -1;
    const wantId = String(toUnpaddedId(String(entityUnpadded)));
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        } catch (_) {
            continue;
        }
        if (!raw || raw.entityType !== entityLetter) continue;
        if (String(toUnpaddedId(String(raw.entityId || ''))) !== wantId) continue;
        if (raw.agent !== agentId) continue;
        const sn = raw.sessionName || path.basename(f, '.json');
        const mt = fs.statSync(path.join(dir, f)).mtimeMs;
        if (preferredSessionName && sn === preferredSessionName) {
            return { record: raw, sessionName: sn };
        }
        if (mt > bestMt) {
            bestMt = mt;
            best = { record: raw, sessionName: sn };
        }
    }
    return best;
}

/**
 * @returns {Promise<void>}
 */
async function runAgentResume(args, options = {}) {
    const positionals = Array.isArray(args) ? args : [];
    const entityIdRaw = String(positionals[0] || '').trim();
    const agentId = String(positionals[1] || '').trim();
    if (!entityIdRaw || !agentId) {
        const err = new Error('Usage: aigon agent-resume <feature-id|research-id> <agent>');
        err.code = 'USAGE';
        throw err;
    }

    const cwd = options.cwd || process.cwd();
    const mainRepo = resolveMainRepo(cwd);
    const paddedId = String(parseInt(entityIdRaw, 10)).padStart(2, '0');

    const featureSnapPath = path.join(mainRepo, '.aigon', 'workflows', 'features', paddedId, 'snapshot.json');
    const researchSnapPath = path.join(mainRepo, '.aigon', 'workflows', 'research', paddedId, 'snapshot.json');
    let entityType = null;
    if (fs.existsSync(researchSnapPath)) entityType = 'research';
    else if (fs.existsSync(featureSnapPath)) entityType = 'feature';
    if (!entityType) {
        const err = new Error(`❌ No workflow engine state for ${paddedId}. Run \`aigon doctor --fix\` if this repo is missing snapshots.`);
        err.code = 'NO_ENGINE';
        throw err;
    }

    const prefix = entityType === 'research' ? 'research' : 'feature';
    const record = agentStatusLib.readAgentStatus(paddedId, agentId, prefix, { mainRepoPath: mainRepo });
    if (!record || String(record.status) !== 'quota-paused') {
        const err = new Error(`❌ Agent status is not quota-paused (got ${record && record.status || 'missing'}).`);
        err.code = 'BAD_STATUS';
        throw err;
    }

    const snap = getSnapshot(mainRepo, entityType, paddedId);
    const mo = snap && snap.agents && snap.agents[agentId] && snap.agents[agentId].modelOverride;
    const modelValue = mo && mo.model ? String(mo.model) : null;
    const depleted = quotaProbe.isPairDepleted(mainRepo, agentId, modelValue);
    if (depleted) {
        const resetMs = depleted.resetAt ? new Date(depleted.resetAt).getTime() : NaN;
        const resetPassed = Number.isFinite(resetMs) && resetMs <= Date.now();
        if (!resetPassed) {
            const entry = depleted;
            const nextProbeHint = entry.lastProbedAt
                ? `Last probed ${entry.lastProbedAt}`
                : 'quota state unknown';
            const err = new Error([
                `❌ (agent, model) is still depleted in quota.json.`,
                `   ${nextProbeHint}`,
                `   Probe now: aigon agent-probe --quota ${agentId}${modelValue ? ` --model ${modelValue}` : ''}`,
            ].join('\n'));
            err.code = 'QUOTA_DEPLETED';
            throw err;
        }
    }

    const desc = specDescFromSnapshot(snap, entityType, paddedId);
    const entityLetter = entityType === 'research' ? 'r' : 'f';
    const meta = record.quotaPauseMeta || {};
    const prefSession = meta.sessionName ? String(meta.sessionName) : null;
    const found = findMatchingSidecar(mainRepo, entityLetter, entityIdRaw, agentId, prefSession);
    const worktreePath = found && found.record.worktreePath
        ? path.resolve(found.record.worktreePath)
        : mainRepo;

    try {
        assertTmuxAvailable();
    } catch (e) {
        const err = new Error(`${e.message || String(e)}\n   agent-resume requires tmux.`);
        err.code = 'NO_TMUX';
        throw err;
    }

    const repoBase = path.basename(mainRepo);
    const role = String(meta.role || 'do').trim() || 'do';
    const sessionName = buildTmuxSessionName(paddedId, agentId, {
        repo: repoBase,
        desc,
        entityType: entityLetter,
        role,
    });

    const cmd = buildAgentCommand({
        agent: agentId,
        featureId: paddedId,
        path: worktreePath,
        desc,
        repoPath: mainRepo,
        entityType,
    }, role === 'review' ? 'review' : 'do');

    createDetachedTmuxSession(sessionName, worktreePath, cmd, {
        repoPath: mainRepo,
        entityType: entityLetter,
        entityId: paddedId,
        agent: agentId,
        role,
        worktreePath,
    });

    const prior = record.priorQuotaStatus || meta.priorQuotaStatus || 'implementing';

    agentStatusLib.writeAgentStatus(paddedId, agentId, {
        status: prior,
        priorQuotaStatus: undefined,
        quotaPausedAt: undefined,
        quotaPauseMeta: undefined,
    }, prefix, { mainRepoPath: mainRepo });

    const atISO = new Date().toISOString();
    await wf.persistEntityEvents(mainRepo, entityType, paddedId, [{
        type: entityType === 'research' ? 'research.agent_quota_resumed' : 'feature.agent_quota_resumed',
        agentId,
        role,
        sessionName,
        at: atISO,
    }]);
}

module.exports = { runAgentResume, resolveMainRepo };
