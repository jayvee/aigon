'use strict';

// REGRESSION: doctor auth must never spawn interactive agy (F616 incident class).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    authCommandSpawnsAgy,
    shouldSkipDoctorAuthProbe,
    doctorAuthStatusForSkippedAgent,
} = require('../../lib/doctor/agent-auth-probe');

test('shouldSkipDoctorAuthProbe: ag is always skipped', () => {
    assert.equal(shouldSkipDoctorAuthProbe('ag', { method: 'envVar' }), true);
    assert.equal(shouldSkipDoctorAuthProbe('ag', {}), true);
});

test('shouldSkipDoctorAuthProbe: any authCheck.command containing agy is skipped', () => {
    assert.equal(
        shouldSkipDoctorAuthProbe('xx', {
            method: 'command',
            command: 'agy --dangerously-skip-permissions -p "PONG"',
        }),
        true,
    );
    assert.equal(
        shouldSkipDoctorAuthProbe('cc', { method: 'command', command: 'claude auth status' }),
        false,
    );
});

test('doctorAuthStatusForSkippedAgent: token env reports authenticated', () => {
    const prev = process.env.ANTIGRAVITY_TOKEN;
    process.env.ANTIGRAVITY_TOKEN = 'test-token';
    try {
        const result = doctorAuthStatusForSkippedAgent({});
        assert.equal(result.status, 'authenticated');
    } finally {
        if (prev === undefined) delete process.env.ANTIGRAVITY_TOKEN;
        else process.env.ANTIGRAVITY_TOKEN = prev;
    }
});

test('doctor.js auth probe guard never calls spawnSync with agy', () => {
    const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../lib/commands/setup/doctor.js'),
        'utf8',
    );
    assert.ok(!/spawnSync\(authCheck\.command/.test(src) || /authCommandSpawnsAgy/.test(src));
    assert.ok(authCommandSpawnsAgy('agy -p ping'));
    assert.ok(!authCommandSpawnsAgy('claude auth status'));
});
