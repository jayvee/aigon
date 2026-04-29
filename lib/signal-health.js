'use strict';

const fs = require('fs');
const path = require('path');

const EVENT_KINDS = new Set([
    'signal-emitted',
    'signal-missed',
    'signal-recovered-via-nudge',
    'signal-recovered-via-user',
    'signal-abandoned',
    'signal-out-of-order',
]);

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_SLA = {
    implementing: 600,
    reviewing: 600,
    revising: 600,
    'spec-reviewing': 600,
    waiting: 600,
    'awaiting-input': 600,
};

function telemetryDir(repoPath = process.cwd()) {
    return path.join(repoPath, '.aigon', 'telemetry', 'signal-health');
}

function canonicalEntityId(id) {
    const raw = String(id);
    if (/^\d+$/.test(raw)) return String(parseInt(raw, 10)).padStart(2, '0');
    return raw;
}

function nudgeRecoveryPendingPath(repoPath, prefix, id, agent) {
    return path.join(repoPath, '.aigon', 'state', `nudge-recovery-pending-${prefix}-${canonicalEntityId(id)}-${agent}.json`);
}

/**
 * Remember that a nudge was sent while the agent was stuck in `stuckStatus`, so the
 * next advancing status write can emit `signal-recovered-via-nudge` (see tryConsumeNudgeRecovery).
 */
function writeNudgeRecoveryPending(repoPath, input = {}) {
    try {
        const prefix = input.entityType === 'research' ? 'research' : 'feature';
        const stuckStatus = String(input.stuckStatus || '').trim();
        if (!stuckStatus || !input.agent || input.entityId == null) return null;
        const file = nudgeRecoveryPendingPath(repoPath, prefix, input.entityId, input.agent);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const payload = {
            stuckStatus,
            nudgedAt: new Date().toISOString(),
            sessionName: input.sessionName || null,
        };
        const tmp = `${file}.tmp.${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
        fs.renameSync(tmp, file);
        return payload;
    } catch (error) {
        try {
            process.stderr.write(`⚠️  signal-health nudge pending write failed: ${error.message}\n`);
        } catch (_) {}
        return null;
    }
}

/**
 * If a nudge was recorded while stuck in `previousStatus`, emit recovered telemetry when status advances.
 */
function tryConsumeNudgeRecovery(repoPath, prefix, id, agent, previousStatus, nextStatus) {
    try {
        const prev = previousStatus == null ? '' : String(previousStatus).trim();
        const next = nextStatus == null ? '' : String(nextStatus).trim();
        if (!prev || prev === next) return null;
        const file = nudgeRecoveryPendingPath(repoPath, prefix, id, agent);
        if (!fs.existsSync(file)) return null;
        let pending;
        try {
            pending = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (_) {
            try { fs.unlinkSync(file); } catch (_) {}
            return null;
        }
        if (!pending || String(pending.stuckStatus).trim() !== prev) {
            try { fs.unlinkSync(file); } catch (_) {}
            return null;
        }
        const event = recordSignalEvent({
            repoPath,
            kind: 'signal-recovered-via-nudge',
            agent,
            entityType: prefix === 'research' ? 'research' : 'feature',
            entityId: id,
            sessionName: pending.sessionName || null,
            source: 'nudge-then-status-advance',
        });
        try { fs.unlinkSync(file); } catch (_) {}
        return event;
    } catch (error) {
        try {
            process.stderr.write(`⚠️  signal-health nudge recovery consume failed: ${error.message}\n`);
        } catch (_) {}
        return null;
    }
}

function dayKey(date) {
    return date.toISOString().slice(0, 10);
}

function eventPath(repoPath, date) {
    return path.join(telemetryDir(repoPath), `${dayKey(date)}.jsonl`);
}

function normalizeSince(since) {
    if (since instanceof Date && !Number.isNaN(since.getTime())) return since;
    if (since) {
        const parsed = new Date(since);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(Date.now() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000);
}

function normalizeEntityType(entityType) {
    return entityType === 'research' ? 'research' : 'feature';
}

function recordSignalEvent(input = {}) {
    const repoPath = input.repoPath || process.cwd();
    try {
        const kind = String(input.kind || '').trim();
        if (!EVENT_KINDS.has(kind)) throw new Error(`unknown signal event kind: ${kind}`);
        const now = input.t ? new Date(input.t) : new Date();
        if (Number.isNaN(now.getTime())) throw new Error(`invalid event timestamp: ${input.t}`);
        const event = {
            t: now.toISOString(),
            agent: input.agent == null ? null : String(input.agent),
            entityType: normalizeEntityType(input.entityType),
            entityId: input.entityId == null ? null : String(input.entityId),
            kind,
        };
        [
            'status', 'expected', 'lastStatus', 'lastStatusAt', 'elapsedSec',
            'sessionName', 'role', 'source', 'reason', 'runtimeAgentId',
        ].forEach(key => {
            if (input[key] !== undefined && input[key] !== null) event[key] = input[key];
        });

        const file = eventPath(repoPath, now);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
        fs.writeFileSync(tmp, existing + JSON.stringify(event) + '\n');
        fs.renameSync(tmp, file);
        return event;
    } catch (error) {
        try {
            process.stderr.write(`⚠️  signal-health telemetry write failed: ${error.message}\n`);
        } catch (_) {}
        return null;
    }
}

function readSignalEvents(options = {}) {
    const repoPath = options.repoPath || process.cwd();
    const since = normalizeSince(options.since);
    const agent = options.agent ? String(options.agent) : null;
    const kind = options.kind ? String(options.kind) : null;
    const entityType = options.entityType ? normalizeEntityType(options.entityType) : null;
    const dir = telemetryDir(repoPath);
    if (!fs.existsSync(dir)) return [];

    const events = [];
    let files = [];
    try {
        files = fs.readdirSync(dir).filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort();
    } catch (_) {
        return [];
    }

    files.forEach(file => {
        if (file.slice(0, 10) < dayKey(since)) return;
        const fullPath = path.join(dir, file);
        let raw = '';
        try { raw = fs.readFileSync(fullPath, 'utf8'); } catch (_) { return; }
        raw.split('\n').forEach(line => {
            if (!line.trim()) return;
            let event;
            try { event = JSON.parse(line); } catch (_) { return; }
            const time = new Date(event.t || 0).getTime();
            if (!Number.isFinite(time) || time < since.getTime()) return;
            if (agent && event.agent !== agent) return;
            if (kind && event.kind !== kind) return;
            if (entityType && event.entityType !== entityType) return;
            events.push(event);
        });
    });
    return events.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
}

function summarizeSignalEvents(events) {
    const byAgent = new Map();
    events.forEach(event => {
        const agent = event.agent || 'unknown';
        if (!byAgent.has(agent)) {
            byAgent.set(agent, {
                agent,
                total: 0,
                emitted: 0,
                missed: 0,
                recoveredViaNudge: 0,
                recoveredViaUser: 0,
                abandoned: 0,
                outOfOrder: 0,
                reliability: 100,
            });
        }
        const row = byAgent.get(agent);
        if (event.kind === 'signal-emitted') row.emitted += 1;
        else if (event.kind === 'signal-missed') row.missed += 1;
        else if (event.kind === 'signal-recovered-via-nudge') row.recoveredViaNudge += 1;
        else if (event.kind === 'signal-recovered-via-user') row.recoveredViaUser += 1;
        else if (event.kind === 'signal-abandoned') row.abandoned += 1;
        else if (event.kind === 'signal-out-of-order') row.outOfOrder += 1;
        row.total += 1;
    });

    return Array.from(byAgent.values())
        .map(row => {
            const denominator = row.emitted + row.missed + row.abandoned + row.outOfOrder;
            const successful = row.emitted + row.recoveredViaNudge + row.recoveredViaUser;
            return {
                ...row,
                reliability: denominator > 0 ? Math.round((successful / denominator) * 1000) / 10 : 100,
            };
        })
        .sort((left, right) => left.agent.localeCompare(right.agent));
}

function getRetentionDays(repoPath = process.cwd()) {
    try {
        const { loadProjectConfig } = require('./config');
        const config = loadProjectConfig(repoPath) || {};
        const raw = config.signalHealthRetentionDays
            || (config.signalHealth && config.signalHealth.retentionDays);
        const parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
    } catch (_) {
        return DEFAULT_RETENTION_DAYS;
    }
}

function gcSignalHealth(repoPath = process.cwd(), options = {}) {
    const retentionDays = options.retentionDays || getRetentionDays(repoPath);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffKey = dayKey(cutoff);
    const dir = telemetryDir(repoPath);
    if (!fs.existsSync(dir)) return { removed: 0, retentionDays };
    let removed = 0;
    fs.readdirSync(dir).forEach(file => {
        if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)) return;
        if (file.slice(0, 10) >= cutoffKey) return;
        try {
            fs.unlinkSync(path.join(dir, file));
            removed += 1;
        } catch (_) {}
    });
    return { removed, retentionDays };
}

function getSignalSlaConfig(repoPath = process.cwd()) {
    try {
        const { loadProjectConfig } = require('./config');
        const config = loadProjectConfig(repoPath) || {};
        return {
            ...DEFAULT_SLA,
            ...(config.signalHealth && config.signalHealth.slaSec ? config.signalHealth.slaSec : {}),
        };
    } catch (_) {
        return { ...DEFAULT_SLA };
    }
}

function recordMissedSignalIfDue(input = {}) {
    const repoPath = input.repoPath || process.cwd();
    const status = String(input.lastStatus || input.status || '').trim();
    const updatedAt = input.lastStatusAt || input.updatedAt;
    if (!status || !updatedAt) return null;
    const slaSec = Number(input.slaSec || getSignalSlaConfig(repoPath)[status] || 0);
    if (!Number.isFinite(slaSec) || slaSec <= 0) return null;
    const lastTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(lastTime)) return null;
    const elapsedSec = Math.floor((Date.now() - lastTime) / 1000);
    if (elapsedSec < slaSec) return null;
    const expected = input.expected || `advance-from-${status}`;
    const existing = readSignalEvents({
        repoPath,
        since: new Date(lastTime - 1000).toISOString(),
        agent: input.agent,
        kind: 'signal-missed',
        entityType: input.entityType,
    }).some(event => (
        String(event.entityId) === String(input.entityId)
        && event.expected === expected
        && event.lastStatusAt === updatedAt
        && event.sessionName === (input.sessionName || null)
    ));
    if (existing) return null;
    return recordSignalEvent({
        repoPath,
        kind: 'signal-missed',
        agent: input.agent,
        entityType: input.entityType,
        entityId: input.entityId,
        expected,
        lastStatus: status,
        lastStatusAt: updatedAt,
        elapsedSec,
        sessionName: input.sessionName,
        source: input.source || 'dashboard-status-collector',
    });
}

module.exports = {
    EVENT_KINDS,
    DEFAULT_RETENTION_DAYS,
    recordSignalEvent,
    readSignalEvents,
    summarizeSignalEvents,
    gcSignalHealth,
    getRetentionDays,
    getSignalSlaConfig,
    recordMissedSignalIfDue,
    writeNudgeRecoveryPending,
    tryConsumeNudgeRecovery,
};
