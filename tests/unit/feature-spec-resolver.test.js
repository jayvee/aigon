#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../../lib/workflow-core/engine');
const resolver = require('../../lib/feature-spec-resolver');

let passed = 0;
let failed = 0;
const asyncTests = [];

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (error) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${error.message}`);
        failed++;
    }
}

function testAsync(description, fn) {
    asyncTests.push(
        fn()
            .then(() => {
                console.log(`  ✓ ${description}`);
                passed++;
            })
            .catch(error => {
                console.error(`  ✗ ${description}`);
                console.error(`    ${error.message}`);
                failed++;
            })
    );
}

function makeTempRepo() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-feature-spec-'));
    [
        'docs/specs/features/01-inbox',
        'docs/specs/features/02-backlog',
        'docs/specs/features/03-in-progress',
        'docs/specs/features/04-in-evaluation',
        'docs/specs/features/05-done',
        'docs/specs/features/06-paused',
    ].forEach(dir => fs.mkdirSync(path.join(repo, dir), { recursive: true }));
    return repo;
}

console.log('# feature-spec-resolver.js');

test('resolveFeatureSpec prefers non-placeholder content over placeholder active copy', () => {
    const repo = makeTempRepo();
    try {
        const backlogPath = path.join(repo, 'docs/specs/features/02-backlog/feature-07-add-footer.md');
        const inProgressPath = path.join(repo, 'docs/specs/features/03-in-progress/feature-07-add-footer.md');
        fs.writeFileSync(backlogPath, '# Real spec\n\n## Acceptance Criteria\n\n- footer\n');
        fs.writeFileSync(inProgressPath, '# Feature 07\n\nSpec created by workflow-core.\n');

        const resolved = resolver.resolveFeatureSpec(repo, '07');
        assert.strictEqual(resolved.path, backlogPath);
        assert.strictEqual(resolved.isPlaceholder, false);
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('resolveFeatureSpec respects workflow snapshot expected path when real visible spec exists', async () => {
    const repo = makeTempRepo();
    try {
        const backlogPath = path.join(repo, 'docs/specs/features/02-backlog/feature-07-add-footer.md');
        const inProgressPath = path.join(repo, 'docs/specs/features/03-in-progress/feature-07-add-footer.md');
        fs.writeFileSync(backlogPath, '# Footer spec\n');
        await engine.startFeature(repo, '07', 'solo_worktree', ['cc']);
        fs.renameSync(backlogPath, inProgressPath);

        const resolved = resolver.resolveFeatureSpec(repo, '07');
        assert.strictEqual(resolved.path, inProgressPath);
        assert.strictEqual(resolved.stage, 'in-progress');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

Promise.all(asyncTests).then(() => {
    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
});
