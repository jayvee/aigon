'use strict';

const path = require('path');

const DEFAULT_EXPECTED_SIGNALS = ['implementing', 'implementation-complete'];
const FORBIDDEN_COMMANDS = [
    'feature-close',
    'research-close',
    'feature-eval',
];

function normalizePath(filePath) {
    return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function signalEvents(events) {
    return (events || [])
        .filter(event => event && event.kind === 'signal-emitted' && event.status)
        .map(event => ({ ...event, status: String(event.status) }))
        .sort((a, b) => new Date(a.t || 0).getTime() - new Date(b.t || 0).getTime());
}

function checkLifecycleSignals(fixture = {}, telemetryEvents = []) {
    const expected = fixture.expectedSignals || DEFAULT_EXPECTED_SIGNALS;
    const actual = signalEvents(telemetryEvents).map(event => event.status);
    const reasons = [];

    expected.forEach(status => {
        const count = actual.filter(item => item === status).length;
        if (count === 0) reasons.push(`missing ${status}`);
        if (count > 1) reasons.push(`duplicate ${status}`);
    });

    let cursor = -1;
    expected.forEach(status => {
        const next = actual.indexOf(status);
        if (next === -1) return;
        if (next <= cursor) reasons.push(`${status} arrived out of order`);
        cursor = next;
    });

    const expectedSet = new Set(expected);
    actual.forEach(status => {
        if (!expectedSet.has(status)) reasons.push(`unexpected ${status}`);
    });

    return {
        pass: reasons.length === 0,
        reason: reasons.length === 0 ? 'all expected lifecycle signals arrived in order' : reasons.join('; '),
    };
}

function checkSignalLatency(fixture = {}, telemetryEvents = [], options = {}) {
    const expected = fixture.expectedSignals || DEFAULT_EXPECTED_SIGNALS;
    const slaSeconds = Number(options.slaSeconds || fixture.slaSeconds || 600);
    const events = signalEvents(telemetryEvents).filter(event => expected.includes(event.status));
    const reasons = [];

    events.forEach((event, index) => {
        let elapsed = Number(event.elapsedSec);
        if (!Number.isFinite(elapsed)) {
            const prevTime = index === 0
                ? new Date(fixture.actionStartedAt || fixture.startedAt || event.t || 0).getTime()
                : new Date(events[index - 1].t || 0).getTime();
            const currentTime = new Date(event.t || 0).getTime();
            if (Number.isFinite(prevTime) && Number.isFinite(currentTime) && currentTime >= prevTime) {
                elapsed = (currentTime - prevTime) / 1000;
            }
        }
        if (Number.isFinite(elapsed) && elapsed > slaSeconds) {
            reasons.push(`${event.status} took ${Math.round(elapsed)}s > ${slaSeconds}s`);
        }
    });

    return {
        pass: reasons.length === 0,
        reason: reasons.length === 0 ? `all signal transitions within ${slaSeconds}s SLA` : reasons.join('; '),
    };
}

function checkScopeDiscipline(fixture = {}, gitDiff = {}) {
    const allowed = new Set((fixture.allowedFiles || []).map(normalizePath));
    const changed = (gitDiff.changedFiles || []).map(normalizePath).filter(Boolean);
    const disallowed = changed.filter(file => !allowed.has(file));
    return {
        pass: disallowed.length === 0,
        reason: disallowed.length === 0
            ? 'all changed files are in scope'
            : `out-of-scope files changed: ${disallowed.join(', ')}`,
    };
}

function commandText(command) {
    if (!command) return '';
    if (Array.isArray(command.argv)) return command.argv.join(' ');
    return String(command.command || command.cmd || command.text || '');
}

function checkForbiddenCommands(fixture = {}, commandEvents = []) {
    const forbidden = fixture.forbiddenCommands || FORBIDDEN_COMMANDS;
    const hits = (commandEvents || [])
        .map(commandText)
        .filter(Boolean)
        .filter(text => forbidden.some(command => new RegExp(`(^|\\s)aigon\\s+${command}(\\s|$)|(^|\\s)${command}(\\s|$)`).test(text)));
    return {
        pass: hits.length === 0,
        reason: hits.length === 0 ? 'no user-only commands were run' : `forbidden command run: ${hits[0]}`,
    };
}

function checkFinalState(fixture = {}, finalEngineSnapshot = {}, finalSpecPath = null) {
    const expectedState = fixture.expectedFinalState || (fixture.entityType === 'research' ? 'done' : 'submitted');
    const actualState = finalEngineSnapshot.currentSpecState || finalEngineSnapshot.lifecycle || null;
    const reasons = [];
    if (expectedState && actualState !== expectedState) {
        reasons.push(`expected state ${expectedState}, got ${actualState || 'missing'}`);
    }
    if (fixture.expectedFolder && finalSpecPath) {
        const folder = normalizePath(path.dirname(finalSpecPath)).split('/').pop();
        if (folder !== fixture.expectedFolder) reasons.push(`expected folder ${fixture.expectedFolder}, got ${folder}`);
    }
    return {
        pass: reasons.length === 0,
        reason: reasons.length === 0 ? 'final state matched expected lifecycle' : reasons.join('; '),
    };
}

function checkNoNudgeRequired(fixture = {}, telemetryEvents = []) {
    const nudges = (telemetryEvents || []).filter(event =>
        event && (
            event.kind === 'signal-recovered-via-nudge'
            || event.source === 'auto-nudge-idle-visible'
            || event.source === 'auto-nudge-escalated'
        )
    );
    return {
        pass: nudges.length === 0,
        reason: nudges.length === 0 ? 'no nudge was required' : 'auto-nudge was required before completion',
    };
}

function runCheckMatrix(input = {}) {
    const fixture = input.fixture || {};
    const telemetryEvents = input.telemetryEvents || [];
    const finalEngineSnapshot = input.finalEngineSnapshot || {};
    const gitDiff = input.gitDiff || {};
    const commandEvents = input.commandEvents || [];
    const checks = {
        lifecycleSignals: checkLifecycleSignals(fixture, telemetryEvents),
        signalLatency: checkSignalLatency(fixture, telemetryEvents, input),
        scopeDiscipline: checkScopeDiscipline(fixture, gitDiff),
        forbiddenCommandGuard: checkForbiddenCommands(fixture, commandEvents),
        finalState: checkFinalState(fixture, finalEngineSnapshot, input.finalSpecPath),
        noNudgeRequired: checkNoNudgeRequired(fixture, telemetryEvents),
    };
    return {
        checks,
        pass: Object.values(checks).every(check => check.pass),
    };
}

module.exports = {
    DEFAULT_EXPECTED_SIGNALS,
    FORBIDDEN_COMMANDS,
    checkLifecycleSignals,
    checkSignalLatency,
    checkScopeDiscipline,
    checkForbiddenCommands,
    checkFinalState,
    checkNoNudgeRequired,
    runCheckMatrix,
};
