#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const { handleSpecReconcileApiRequest } = require('../../lib/dashboard-server');

function seedRepo(repo) {
    const dirs = [
        'docs/specs/features/01-inbox',
        'docs/specs/features/02-backlog',
        'docs/specs/features/03-in-progress',
        'docs/specs/features/04-in-evaluation',
        'docs/specs/features/05-done',
        'docs/specs/features/06-paused',
        '.aigon/workflows/features/19',
    ];
    dirs.forEach(dir => fs.mkdirSync(path.join(repo, dir), { recursive: true }));
}

function requestJson(port, payload) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/api/spec-reconcile',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        }, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk.toString('utf8'); });
            res.on('end', () => {
                let parsed = {};
                try { parsed = body ? JSON.parse(body) : {}; } catch (_) {}
                resolve({ statusCode: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
    });
}

// REGRESSION: F276 changed getSpecStateDirForEntity to throw on unknown lifecycles,
// which turned every /api/spec-reconcile call for a legacy/hand-edited snapshot into
// a 500. The handler must instead return 200 with skipped='unknown-lifecycle' so the
// dashboard can keep rendering. Also pins F272/cbe3aeba: the reconciler must NEVER
// move a spec file to a junk location when the lifecycle isn't recognized.
testAsync('POST /api/spec-reconcile returns skipped=unknown-lifecycle without mutating', async () => {
    await withTempDirAsync('aigon-spec-reconcile-', async (repo) => {
        seedRepo(repo);
        const currentSpec = path.join(repo, 'docs/specs/features/02-backlog/feature-19-x.md');
        fs.writeFileSync(currentSpec, '# feature-19-x\n');
        fs.writeFileSync(path.join(repo, '.aigon/workflows/features/19/snapshot.json'), JSON.stringify({
            entityType: 'feature',
            featureId: '19',
            currentSpecState: 'mystery',
            lifecycle: 'mystery',
            mode: 'solo_branch',
            agents: { cx: { status: 'running' } },
            createdAt: '2026-04-01T10:00:00Z',
            updatedAt: '2026-04-01T10:05:00Z',
        }));

        const server = http.createServer((req, res) => {
            if (req.url === '/api/spec-reconcile' && req.method === 'POST') {
                handleSpecReconcileApiRequest(req, res, {
                    registeredRepos: [],
                    defaultRepoPath: repo,
                });
                return;
            }
            res.writeHead(404);
            res.end();
        });

        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            const response = await requestJson(port, {
                repoPath: repo,
                entityType: 'feature',
                entityId: '19',
            });
            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.body.ok, true);
            assert.strictEqual(response.body.skipped, 'unknown-lifecycle');
            assert.strictEqual(response.body.moved, false);
            assert.ok(fs.existsSync(currentSpec));
            assert.strictEqual(fs.readFileSync(currentSpec, 'utf8'), '# feature-19-x\n');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});

report();
