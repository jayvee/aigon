'use strict';

const fs = require('fs');
const path = require('path');

function conditionPath(repoPath) {
    return path.join(repoPath || process.cwd(), '.aigon', 'state', 'red-main.json');
}

function readRedMainCondition(repoPath) {
    const file = conditionPath(repoPath);
    if (!fs.existsSync(file)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed && parsed.active ? parsed : null;
    } catch (_) {
        return null;
    }
}

function writeJsonAtomic(file, payload) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, file);
}

function recordRedMainFailure(repoPath, payload) {
    const previous = readRedMainCondition(repoPath);
    const at = payload.at || new Date().toISOString();
    const next = {
        active: true,
        gateCommand: payload.gateCommand || (previous && previous.gateCommand) || null,
        firstSeenFeatureId: previous && previous.firstSeenFeatureId
            ? previous.firstSeenFeatureId
            : String(payload.featureId || ''),
        firstSeenAt: previous && previous.firstSeenAt ? previous.firstSeenAt : at,
        latestFeatureId: String(payload.featureId || ''),
        latestSeenAt: at,
        mergedCommitSha: payload.mergedCommitSha || null,
        gateLogPath: payload.logPath || null,
        exitCode: payload.exitCode != null ? payload.exitCode : 1,
    };
    writeJsonAtomic(conditionPath(repoPath), next);
    return next;
}

function clearRedMainCondition(repoPath, payload = {}) {
    const previous = readRedMainCondition(repoPath);
    if (!previous) return null;
    const cleared = {
        ...previous,
        active: false,
        clearedAt: payload.at || new Date().toISOString(),
        clearedByFeatureId: payload.featureId ? String(payload.featureId) : null,
        clearedCommitSha: payload.mergedCommitSha || null,
    };
    writeJsonAtomic(conditionPath(repoPath), cleared);
    return cleared;
}

module.exports = {
    conditionPath,
    readRedMainCondition,
    recordRedMainFailure,
    clearRedMainCondition,
};
