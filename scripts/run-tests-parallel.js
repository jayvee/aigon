#!/usr/bin/env node
'use strict';

// Parallel test-file runner. Each test file is a standalone node script
// (uses tests/_helpers test()/report()), so we spawn one node process per file
// and bound concurrency to (CPU - 1). Used by package.json:test:integration
// and test:workflow. Files remain runnable individually for debugging.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function expandGlob(pattern) {
    const dir = path.dirname(pattern);
    const file = path.basename(pattern);
    if (!fs.existsSync(dir)) return [];
    const re = new RegExp('^' + file.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f)).sort();
}

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('usage: run-tests-parallel.js <glob-or-file> [...more]');
    process.exit(2);
}

const files = [];
for (const a of args) {
    if (a.includes('*')) files.push(...expandGlob(a));
    else if (fs.existsSync(a)) files.push(a);
}

if (files.length === 0) {
    console.log('no test files matched');
    process.exit(0);
}

const concurrency = Math.max(2, Math.min(files.length, parseInt(process.env.TEST_CONCURRENCY, 10) || os.cpus().length - 1));
const start = Date.now();
let nextIndex = 0;
let active = 0;
let done = 0;
let firstFailure = null;
const results = new Array(files.length);

function launch() {
    while (active < concurrency && nextIndex < files.length) {
        const idx = nextIndex++;
        const file = files[idx];
        active++;
        const child = spawn(process.execPath, [file], { env: process.env });
        let out = '';
        let err = '';
        child.stdout.on('data', d => { out += d.toString(); });
        child.stderr.on('data', d => { err += d.toString(); });
        child.on('close', (code) => {
            active--;
            done++;
            const ok = code === 0;
            results[idx] = { file, ok, code, out, err };
            const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
            process.stdout.write(`${tag} ${file} ${ok ? '' : `(exit ${code})`}\n`);
            if (!ok && !firstFailure) {
                firstFailure = results[idx];
                process.stdout.write(out);
                process.stderr.write(err);
            }
            if (done === files.length) {
                const ms = Date.now() - start;
                const fails = results.filter(r => r && !r.ok).length;
                console.log(`\n${results.length - fails}/${results.length} passed in ${ms}ms (concurrency ${concurrency})`);
                process.exit(fails === 0 ? 0 : 1);
            } else {
                launch();
            }
        });
    }
}

launch();
