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

function globToRegExp(pattern) {
    const dir = path.dirname(pattern);
    const file = path.basename(pattern);
    const re = new RegExp('^' + file.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return { dir, re };
}

function expandGlob(pattern) {
    const { dir, re } = globToRegExp(pattern);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f)).sort();
}

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('usage: run-tests-parallel.js <glob-or-file> [...more] [--exclude=<glob-or-file>]');
    process.exit(2);
}

const files = [];
const excludes = [];
for (const a of args) {
    if (a.startsWith('--exclude=')) {
        excludes.push(a.slice('--exclude='.length));
    } else if (a.includes('*')) files.push(...expandGlob(a));
    else if (fs.existsSync(a)) files.push(a);
}

function isExcluded(file) {
    return excludes.some((pattern) => {
        if (pattern.includes('*')) {
            const { dir, re } = globToRegExp(pattern);
            return path.normalize(path.dirname(file)) === path.normalize(dir) && re.test(path.basename(file));
        }
        return path.normalize(file) === path.normalize(pattern);
    });
}

const selectedFiles = [...new Set(files)].filter((file) => !isExcluded(file));

if (selectedFiles.length === 0) {
    console.log('no test files matched');
    process.exit(0);
}

const concurrency = Math.max(2, Math.min(selectedFiles.length, parseInt(process.env.TEST_CONCURRENCY, 10) || os.cpus().length - 1));
const start = Date.now();
let nextIndex = 0;
let active = 0;
let done = 0;
let firstFailure = null;
const results = new Array(selectedFiles.length);

function launch() {
    while (active < concurrency && nextIndex < selectedFiles.length) {
        const idx = nextIndex++;
        const file = selectedFiles[idx];
        active++;
        const fileStart = Date.now();
        const child = spawn(process.execPath, [file], { env: process.env });
        let out = '';
        let err = '';
        child.stdout.on('data', d => { out += d.toString(); });
        child.stderr.on('data', d => { err += d.toString(); });
        child.on('close', (code) => {
            active--;
            done++;
            const ms = Date.now() - fileStart;
            const ok = code === 0;
            results[idx] = { file, ok, code, out, err, ms };
            const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
            const timing = process.env.TEST_TIMINGS === '0' ? '' : ` ${ms}ms`;
            process.stdout.write(`${tag} ${file}${timing} ${ok ? '' : `(exit ${code})`}\n`);
            if (!ok && !firstFailure) {
                firstFailure = results[idx];
                process.stdout.write(out);
                process.stderr.write(err);
            }
            if (done === selectedFiles.length) {
                const ms = Date.now() - start;
                const fails = results.filter(r => r && !r.ok).length;
                const slowest = results
                    .filter(Boolean)
                    .sort((a, b) => b.ms - a.ms)
                    .slice(0, parseInt(process.env.TEST_SLOWEST_COUNT, 10) || 10);
                console.log(`\n${results.length - fails}/${results.length} passed in ${ms}ms (concurrency ${concurrency})`);
                if (process.env.TEST_TIMINGS !== '0') {
                    console.log('\nSlowest test files:');
                    slowest.forEach((r) => console.log(`  ${String(r.ms).padStart(6)}ms  ${r.file}`));
                }
                process.exit(fails === 0 ? 0 : 1);
            } else {
                launch();
            }
        });
    }
}

launch();
