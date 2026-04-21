#!/usr/bin/env node
// REGRESSION feature 285: collectRepoStatus exposes awaitingInput + anyAwaitingInput on feature and research cards.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');
const ast = require('../../lib/agent-status');
const { collectRepoStatus, clearTierCache } = require('../../lib/dashboard-status-collector');
const { buildAutonomousPlanHtml } = require('../../templates/dashboard/js/autonomous-plan.js');
const w = (root, rel, body) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };

testAsync('dashboard payload: awaitingInput + anyAwaitingInput (feature + research)', async () => {
    await withTempDirAsync('aigon-await-dash-', async (repo) => {
        w(repo, 'docs/specs/features/03-in-progress/feature-99-awaiting-dash.md', '#\n');
        w(repo, 'docs/specs/features/logs/feature-99-cc-log.md', '#\n');
        w(repo, 'docs/specs/research-topics/03-in-progress/research-88-awaiting-dash.md', '#\n');
        w(repo, 'docs/specs/research-topics/logs/research-88-cc-findings.md', '#\n');
        await engine.startFeature(repo, '99', 'solo_branch', ['cc']);
        await engine.startResearch(repo, '88', 'fleet', ['cc']);
        ast.writeAwaitingInput(repo, '99', 'cc', 'Pick A or B');
        ast.writeAwaitingInput(repo, '88', 'cc', 'Choose features', 'research');
        clearTierCache(repo);
        const response = { summary: { implementing: 0, waiting: 0, submitted: 0, error: 0, total: 0 } };
        const st = collectRepoStatus(repo, response);
        assert.ok(st);
        const f = st.features.find((x) => String(x.id) === '99');
        const r = st.research.find((x) => String(x.id) === '88');
        assert.ok(f && f.anyAwaitingInput);
        assert.strictEqual(f.agents.find((a) => a.id === 'cc').awaitingInput.message, 'Pick A or B');
        assert.ok(r && r.anyAwaitingInput);
        assert.strictEqual(r.agents.find((a) => a.id === 'cc').awaitingInput.message, 'Choose features');
    });
});

testAsync('dashboard autonomous renderer shows running and waiting stages together', async () => {
    // REGRESSION F297: autonomous cards must render future planned stages, not just the active one.
    const html = buildAutonomousPlanHtml({
        stages: [
            { type: 'implement', label: 'Implement', status: 'running', agents: [{ id: 'cc' }] },
            { type: 'review', label: 'Review', status: 'waiting', agents: [{ id: 'cx' }] },
            { type: 'close', label: 'Close', status: 'waiting', agents: [] },
        ]
    }, {
        agentDisplayNames: { cc: 'Claude Code', cx: 'Cursor' }
    });
    assert.match(html, /Autonomous plan/);
    assert.match(html, /Implement/);
    assert.match(html, /Claude Code/);
    assert.match(html, /Review/);
    assert.match(html, /Cursor/);
    assert.match(html, /Running/);
    assert.match(html, /Waiting/);
    assert.ok(html.indexOf('Implement') < html.indexOf('Review'));
    assert.ok(html.indexOf('Review') < html.indexOf('Close'));
});

report();
