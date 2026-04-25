#!/usr/bin/env node
'use strict';
const a = require('assert'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { test, withTempDir, report } = require('../_helpers');
const sup = require('../../lib/supervisor'), { readSpecSection } = require('../../lib/spec-crud');
const tmux = (args) => spawnSync('tmux', args, { encoding: 'utf8', stdio: 'pipe' });
const kill = (name) => { try { tmux(['kill-session', '-t', name]); } catch (_) {} };
const w = (f, body = '') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };

// REGRESSION feature 293: idle detection must honour role-aware tmux session names and clear on fresh progress events.
test('supervisor idle detection: role-aware tmux session and signal clear', () => withTempDir('aigon-idle-', (repo) => {
    const repoName = path.basename(repo), session = `${repoName}-f1-do-cc-idle-test`;
    const hb = path.join(repo, '.aigon', 'state', 'heartbeat-01-cc');
    const ev = path.join(repo, '.aigon', 'workflows', 'features', '01', 'events.jsonl');
    const snapshot = { lifecycle: 'in-progress', agents: { cc: { status: 'running' } } };
    kill(session);
    a.strictEqual(tmux(['new-session', '-d', '-s', session, 'tail -f /dev/null']).status, 0, 'tmux session starts');
    try {
        w(hb); w(ev);
        const nowSecs = Date.now() / 1000;
        fs.utimesSync(hb, nowSecs, nowSecs);
        sup.sweepEntity(repo, 'feature', '01', snapshot, {});
        a.strictEqual(sup.getAgentLiveness(repo, 'feature', '01', 'cc').idleState, null, 'fresh session not idle');
        fs.utimesSync(hb, nowSecs - (11 * 60), nowSecs - (11 * 60));
        sup.sweepEntity(repo, 'feature', '01', snapshot, {});
        a.deepStrictEqual(sup.getAgentLiveness(repo, 'feature', '01', 'cc').idleState, { level: 'soft', idleMinutes: 11 });
        fs.writeFileSync(ev, `${JSON.stringify({ type: 'signal.agent_ready', agentId: 'cc', at: new Date().toISOString() })}\n`);
        sup.sweepEntity(repo, 'feature', '01', snapshot, {});
        a.strictEqual(sup.getAgentLiveness(repo, 'feature', '01', 'cc').idleState, null, 'progress clears idle');
    } finally {
        kill(session);
    }
}));

// REGRESSION feature 293: spec pre-authorisations must be readable as plain bullet lines from the spec body.
test('readSpecSection: returns pre-authorised bullets only', () => withTempDir('aigon-preauth-', (dir) => {
    const spec = path.join(dir, 'feature-1-demo.md');
    w(spec, `---\ncomplexity: low\n---\n# Feature: demo\n\n## Validation\nx\n\n## Pre-authorised\n- May raise \`scripts/check-test-budget.sh\` CEILING by up to +40 LOC.\n- May skip \`npm run test:ui\` for lib-only changes.\n\n## Technical Approach\nx\n`);
    a.deepStrictEqual(readSpecSection(spec, 'Pre-authorised'), [
        'May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC.',
        'May skip `npm run test:ui` for lib-only changes.',
    ]);
    a.deepStrictEqual(readSpecSection(spec, 'Open Questions'), []);
}));

report();
