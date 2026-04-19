#!/usr/bin/env node
// REGRESSION F276: getSpecStateDirForEntity started throwing on unknown
// lifecycles, turning every /api/spec-reconcile call for a legacy/hand-edited
// snapshot into a 500. Handler must instead return 200 with
// skipped='unknown-lifecycle' so the dashboard keeps rendering.
// REGRESSION F272 cbe3aeba: reconciler must NEVER move a spec to a junk
// location when the lifecycle isn't recognized.
// REGRESSION 2047fd10: listVisibleSpecMatches used to walk logs/ — covered
// indirectly here because the reconciler uses resolveEntitySpec which calls
// listVisibleSpecMatches, and any log-dir false-match would surface as a
// duplicate-matches-no-snapshot-hint error on this path.
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const { handleSpecReconcileApiRequest } = require('../../lib/dashboard-server');

testAsync('POST /api/spec-reconcile returns skipped=unknown-lifecycle without mutating', async () => {
    await withTempDirAsync('aigon-spec-reconcile-', async (repo) => {
        for (const d of ['docs/specs/features/01-inbox', 'docs/specs/features/02-backlog', 'docs/specs/features/03-in-progress', 'docs/specs/features/04-in-evaluation', 'docs/specs/features/05-done', 'docs/specs/features/06-paused', 'docs/specs/features/logs', '.aigon/workflows/features/19']) {
            fs.mkdirSync(path.join(repo, d), { recursive: true });
        }
        const currentSpec = path.join(repo, 'docs/specs/features/02-backlog/feature-19-x.md');
        fs.writeFileSync(currentSpec, '# feature-19-x\n');
        // Seed a log with the same prefix — pins 2047fd10 logs-dir exclusion.
        fs.writeFileSync(path.join(repo, 'docs/specs/features/logs/feature-19-cc-log.md'), '# log\n');
        fs.writeFileSync(path.join(repo, '.aigon/workflows/features/19/snapshot.json'), JSON.stringify({
            entityType: 'feature', featureId: '19', currentSpecState: 'mystery', lifecycle: 'mystery',
            mode: 'solo_branch', agents: { cx: { status: 'running' } },
            createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:05:00Z',
        }));

        const server = http.createServer((req, res) => {
            if (req.url === '/api/spec-reconcile' && req.method === 'POST') {
                handleSpecReconcileApiRequest(req, res, { registeredRepos: [], defaultRepoPath: repo });
            } else { res.writeHead(404); res.end(); }
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;

        try {
            const response = await new Promise((resolve, reject) => {
                const req = http.request({ hostname: '127.0.0.1', port, path: '/api/spec-reconcile', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
                    let body = '';
                    res.on('data', (c) => { body += c; });
                    res.on('end', () => resolve({ statusCode: res.statusCode, body: body ? JSON.parse(body) : {} }));
                });
                req.on('error', reject);
                req.end(JSON.stringify({ repoPath: repo, entityType: 'feature', entityId: '19' }));
            });
            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.ok, true);
            assert.strictEqual(response.body.skipped, 'unknown-lifecycle');
            assert.strictEqual(response.body.moved, false);
            assert.strictEqual(fs.readFileSync(currentSpec, 'utf8'), '# feature-19-x\n');
        } finally {
            await new Promise((r) => server.close(r));
        }
    });
});

report();
