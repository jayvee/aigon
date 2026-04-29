#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const benchHydrate = require('../../lib/bench-hydrate');

function w(repo, name, content) {
    const d = path.join(repo, '.aigon', 'benchmarks');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, name), JSON.stringify(content));
}

test('bench-hydrate: empty, verdicts, precedence, merge-into-quota', () => {
    withTempDir((repo) => {
        assert.deepStrictEqual(benchHydrate.hydrateBenchVerdicts(repo), {});
        // Older all-pairs (passed), newer all-pairs (failed) — newer sweep wins.
        w(repo, 'all-2026-04-28.json', { timestamp: '2026-04-28T00:00:00Z', pairs: [{ agentId: 'cc', modelValue: 'm', ok: true }] });
        w(repo, 'all-2026-04-29.json', { timestamp: '2026-04-29T00:00:00Z', pairs: [
            { agentId: 'cc', modelValue: 'm', ok: false },
            { agentId: 'op', modelValue: 'p', ok: true, totalMs: 100 },
        ] });
        // Per-run more recent than newest all-pairs — all-pairs still wins for cc::m.
        w(repo, 'brewboard-07-2026-04-30.json', { agent: 'cc', model: 'm', timestamp: '2026-04-30Z', ok: true });
        // Per-run fills pair not covered by any all-pairs file.
        w(repo, 'brewboard-07-2026-04-29.json', { agent: 'gg', model: 'only', timestamp: '2026-04-29Z', ok: true, totalMs: 7 });
        const idx = benchHydrate.hydrateBenchVerdicts(repo);
        assert.strictEqual(idx['cc::m'].benchVerdict, 'failed');
        assert.strictEqual(idx['op::p'].benchTotalMs, 100);
        assert.strictEqual(idx['gg::only'].benchVerdict, 'passed');
        const state = { schemaVersion: 1, agents: { op: { models: {
            p: { verdict: 'available', probeOk: true },
            none: { verdict: 'available', probeOk: true },
        } } } };
        benchHydrate.mergeBenchVerdictsIntoQuota(state, repo);
        assert.strictEqual(state.agents.op.models.p.benchVerdict, 'passed');
        assert.strictEqual(state.agents.op.models.none.benchVerdict, 'unknown');
    });
});

report();
