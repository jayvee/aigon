#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const lockfiles = [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'site/package-lock.json',
].filter((file) => fs.existsSync(path.join(root, file)));

const suspiciousPackages = new Set([
    '@opensearch-project/opensearch',
    'byte-parser',
    'cross-stitch',
    'echarts-for-react',
    'intercom-client',
    'jest-canvas-mock',
    'jest-date-mock',
    'mistralai',
    'openclaw-cn',
    'size-sensor',
    'timeago.js',
    'ts-dna',
]);

const suspiciousScopes = [
    '@antv/',
    '@mistralai/',
    '@openclaw-cn/',
    '@squawk/',
    '@starmind/',
    '@tanstack/',
    '@uipath/',
];

function packageNameFromLockKey(key, meta) {
    if (!key) return meta.name || '(root)';
    if (meta && meta.name) return meta.name;
    const marker = '/node_modules/';
    const idx = key.lastIndexOf(marker);
    if (idx >= 0) return key.slice(idx + marker.length);
    return key.replace(/^node_modules\//, '');
}

function isSuspiciousFamily(name) {
    return suspiciousPackages.has(name) || suspiciousScopes.some((scope) => name.startsWith(scope));
}

function rootDependencyNames(lockJson) {
    const rootPackage = lockJson.packages && lockJson.packages[''];
    if (!rootPackage) return new Set();

    const fields = [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
    ];
    return new Set(fields.flatMap((field) => Object.keys(rootPackage[field] || {})));
}

let foundSuspicious = 0;
let foundInstallScripts = 0;

for (const lockfile of lockfiles) {
    const lockPath = path.join(root, lockfile);
    const lockJson = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = lockJson.packages || {};
    const directDeps = rootDependencyNames(lockJson);

    console.log(`Lockfile: ${lockfile}`);

    let lockSuspicious = 0;
    for (const [key, meta] of Object.entries(packages)) {
        if (!key || !key.includes('node_modules/')) continue;
        const name = packageNameFromLockKey(key, meta);
        if (!isSuspiciousFamily(name)) continue;

        lockSuspicious += 1;
        foundSuspicious += 1;
        const relation = directDeps.has(name) ? 'direct' : 'transitive';
        const scriptFlag = meta.hasInstallScript ? 'has install script' : 'no install script flag';
        console.log(`  suspicious-family: ${name}@${meta.version || '(unknown)'} (${relation}, ${scriptFlag})`);
    }
    if (lockSuspicious === 0) console.log('  suspicious-family: none');

    let lockInstallScripts = 0;
    for (const [key, meta] of Object.entries(packages)) {
        if (!key || !key.includes('node_modules/') || !meta.hasInstallScript) continue;
        lockInstallScripts += 1;
        foundInstallScripts += 1;
        const name = packageNameFromLockKey(key, meta);
        console.log(`  dependency-install-script: ${name}@${meta.version || '(unknown)'}`);
    }
    if (lockInstallScripts === 0) console.log('  dependency-install-script: none');
}

if (lockfiles.length === 0) {
    console.log('No npm lockfiles found.');
}

if (foundSuspicious > 0) {
    console.log(`Found ${foundSuspicious} package(s) in known suspicious Mini Shai-Hulud package families.`);
}

if (foundInstallScripts > 0) {
    console.log(`Found ${foundInstallScripts} dependency package(s) flagged with install scripts in lockfiles.`);
}
