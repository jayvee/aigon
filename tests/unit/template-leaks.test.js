#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanText } = require('../../lib/template-leak-rules');
const {
    runStaticScan,
    scanAgentPlaceholderFiles,
    scanRenderedManifestFiles,
} = require('../../lib/template-leak-scan');
const { test, report } = require('../_helpers');

// REGRESSION: leaking placeholder values must fail the static guard.
test('template-leaks: npm command in placeholder text is reported with key', () => {
    const findings = scanText('Run `npm test` before commit', {
        file: 'templates/agents/x.json',
        allowSuppression: false,
        placeholderKey: 'EXAMPLE_NOTE',
    });
    assert.ok(findings.length > 0, 'expected leak finding');
    assert.ok(findings.some((f) => f.label.includes('npm')));
    assert.strictEqual(findings[0].placeholderKey, 'EXAMPLE_NOTE');
});

// REGRESSION: clean shipped placeholders pass the static scan.
test('template-leaks: current agent placeholders pass static scan', () => {
    const findings = scanAgentPlaceholderFiles();
    assert.strictEqual(findings.length, 0, findings.map((f) => `${f.file} ${f.placeholderKey}: ${f.match}`).join('\n'));
});

// REGRESSION: injected rendered artifact text fails scan.
test('template-leaks: injected rendered artifact with next dev is detected', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-leak-inject-'));
    try {
        const rel = '.aigon/docs/agents/cursor.md';
        const abs = path.join(repo, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, '# Agent\n\nNever run next dev directly.\n');
        const manifest = { files: [{ path: rel }] };
        const findings = scanRenderedManifestFiles(repo, manifest);
        assert.ok(findings.length > 0);
        assert.ok(findings.some((f) => f.match.includes('next dev')));
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// REGRESSION: import-safe module does not exit the process.
test('template-leaks: importing scan module is side-effect free', () => {
    const modPath = path.resolve(__dirname, '../../lib/template-leak-rules.js');
    delete require.cache[modPath];
    delete require.cache[path.resolve(__dirname, '../../lib/template-leak-scan.js')];
    const rules = require('../../lib/template-leak-rules');
    assert.ok(Array.isArray(rules.LEAK_PATTERNS));
    assert.ok(typeof rules.scanText === 'function');
});

// REGRESSION: full static scan (templates + placeholders) passes on clean tree.
test('template-leaks: runStaticScan passes on clean repository state', () => {
    const { allFindings } = runStaticScan();
    assert.strictEqual(allFindings.length, 0, allFindings.slice(0, 3).map((f) => formatShort(f)).join('; '));
});

function formatShort(f) {
    return `${f.file}:${f.lineNo}${f.placeholderKey ? ` (${f.placeholderKey})` : ''} ${f.match}`;
}

report();
