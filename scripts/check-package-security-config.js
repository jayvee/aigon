#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const packageFiles = [
    'package.json',
    'site/package.json',
].filter((file) => fs.existsSync(path.join(root, file)));

function readPackageJson(file) {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function parseNpmrc(file) {
    const result = new Map();
    if (!fs.existsSync(file)) return result;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx === -1) continue;
        result.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }
    return result;
}

let failures = 0;

for (const file of packageFiles) {
    const pkg = readPackageJson(file);
    if (!pkg.packageManager) {
        failures += 1;
        console.log(`FAIL ${file}: missing packageManager`);
    } else if (!pkg.packageManager.startsWith('npm@')) {
        failures += 1;
        console.log(`FAIL ${file}: packageManager is ${pkg.packageManager}, expected npm@...`);
    } else {
        console.log(`OK ${file}: packageManager=${pkg.packageManager}`);
    }
}

const projectNpmrcPath = path.join(root, '.npmrc');
const npmrc = parseNpmrc(projectNpmrcPath);
const minReleaseAge = Number(npmrc.get('min-release-age'));

if (!Number.isFinite(minReleaseAge)) {
    failures += 1;
    console.log('FAIL .npmrc: missing numeric min-release-age');
} else if (minReleaseAge < 1) {
    failures += 1;
    console.log(`FAIL .npmrc: min-release-age=${minReleaseAge}, expected at least 1 day`);
} else {
    console.log(`OK .npmrc: min-release-age=${minReleaseAge} day(s)`);
}

const authLikeKeys = [...npmrc.keys()].filter((key) => /(?:^|[:/])_auth(?:Token)?$|_password$|username$|token$/i.test(key));
if (authLikeKeys.length > 0) {
    failures += 1;
    console.log(`FAIL .npmrc: auth-token-like entries present (${authLikeKeys.join(', ')})`);
} else {
    console.log('OK .npmrc: no auth-token-like project entries');
}

if (failures > 0) {
    process.exitCode = 1;
}
