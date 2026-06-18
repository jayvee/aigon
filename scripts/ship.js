#!/usr/bin/env node
'use strict';

/**
 * aigon release driver — three modes for shipping changes.
 *
 *   share    Push the current branch to origin. No version bump, no tag.
 *            Pre-push gate: npm run test:deploy.
 *
 *   cut      share + bump package.json version + ensure CHANGELOG has an entry
 *            for the new version + commit + tag + push tag. Stays out of npm.
 *
 *   publish  cut + npm run release (which routes prereleases to `next` and
 *            stables to `latest`, gated by check-pack.js).
 *
 * Usage:
 *   node scripts/ship.js <mode> [--version=X] [--skip-tests] [--allow-dirty]
 *                                [--dry-run] [--yes]
 *
 *   --version=X       Required for `cut` and `publish`. Examples: 2.64.0-beta.5,
 *                     2.65.0-beta.1, 2.65.0. Anything with a `-suffix` ships
 *                     to the npm `next` dist-tag; bare semver ships to `latest`.
 *   --skip-tests      Skip the test:deploy gate. Use with care — the gate is
 *                     the contract for "safe to share".
 *   --allow-dirty     Allow uncommitted changes in the working tree. Off by
 *                     default because release-time leaks usually mean an
 *                     unintended file (.env.local, scratch test artefacts).
 *   --dry-run         Print the action plan and exit without doing anything.
 *   --yes             Skip the confirmation prompt before destructive steps.
 *
 * Examples:
 *   npm run ship -- share
 *   npm run ship -- cut --version=2.64.0-beta.5
 *   npm run ship -- publish --version=2.65.0
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MODES = ['share', 'cut', 'publish'];
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');

function fail(msg, code = 1) {
    process.stderr.write(`ship: ${msg}\n`);
    process.exit(code);
}

function info(msg) {
    process.stdout.write(`ship: ${msg}\n`);
}

function parseArgs(argv) {
    const args = { mode: null, flags: {} };
    for (const a of argv) {
        if (!a.startsWith('--') && !args.mode) {
            args.mode = a;
        } else if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq > -1) args.flags[a.slice(2, eq)] = a.slice(eq + 1);
            else args.flags[a.slice(2)] = true;
        }
    }
    return args;
}

function sh(cmd, opts = {}) {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function shStream(cmd, opts = {}) {
    const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, stdio: 'inherit', ...opts });
    if (r.status !== 0) throw new Error(`command failed (${r.status}): ${cmd}`);
}

function gitDirty() {
    const out = sh('git status --porcelain');
    return out.length > 0;
}

function gitBranch() {
    return sh('git rev-parse --abbrev-ref HEAD');
}

function gitAheadBehind() {
    try {
        const upstream = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
        const counts = sh('git rev-list --left-right --count HEAD...@{u}').split(/\s+/);
        return { upstream, ahead: parseInt(counts[0] || '0', 10), behind: parseInt(counts[1] || '0', 10) };
    } catch (_) {
        return { upstream: null, ahead: 0, behind: 0 };
    }
}

function readPkg() {
    return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
}

function writePkgVersion(version) {
    const text = fs.readFileSync(PKG_PATH, 'utf8');
    const updated = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
    if (updated === text) throw new Error(`could not find "version" key in ${PKG_PATH}`);
    fs.writeFileSync(PKG_PATH, updated);
}

function changelogHasVersion(version) {
    const text = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    const re = new RegExp('^##\\s*\\[?' + version.replace(/[.+]/g, '\\$&') + '\\]?', 'm');
    return re.test(text);
}

function isPrerelease(version) {
    return /^\d+\.\d+\.\d+-.+/.test(version);
}

function distTagFor(version) {
    return isPrerelease(version) ? 'next' : 'latest';
}

function tagExists(tag) {
    try { sh(`git rev-parse --verify --quiet refs/tags/${tag}`); return true; } catch (_) { return false; }
}

async function confirm(prompt, autoYes) {
    if (autoYes) { info(`auto-confirmed: ${prompt}`); return true; }
    if (!process.stdin.isTTY) {
        fail(`refusing to proceed without --yes for: ${prompt}`);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${prompt} [y/N] `, (answer) => {
            rl.close();
            resolve(/^y(es)?$/i.test(answer.trim()));
        });
    });
}

function runDeployGate(skip) {
    if (skip) {
        info('skipping test:deploy (--skip-tests)');
        return;
    }
    info('running test:deploy (core + dependency/security release checks + browser + budget)…');
    shStream('npm run test:deploy');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.mode || !MODES.includes(args.mode)) {
        process.stdout.write(fs.readFileSync(__filename, 'utf8').match(/^\/\*\*[\s\S]+?\*\//)[0] + '\n');
        fail(`first arg must be one of: ${MODES.join(', ')}`);
    }

    const dryRun = !!args.flags['dry-run'];
    const allowDirty = !!args.flags['allow-dirty'];
    const skipTests = !!args.flags['skip-tests'];
    const yes = !!args.flags['yes'];
    const newVersion = args.flags.version || null;

    if ((args.mode === 'cut' || args.mode === 'publish') && !newVersion) {
        fail(`--version=<x.y.z[-tag]> is required for ${args.mode}`);
    }

    const branch = gitBranch();
    const dirty = gitDirty();
    const { upstream, ahead, behind } = gitAheadBehind();
    const pkg = readPkg();

    info('plan');
    info(`  mode:           ${args.mode}`);
    info(`  branch:         ${branch}${upstream ? ` (tracks ${upstream})` : ' (no upstream)'}`);
    info(`  ahead/behind:   ${ahead}/${behind}`);
    info(`  package:        ${pkg.name}@${pkg.version}`);
    if (newVersion) {
        info(`  new version:    ${newVersion}  →  npm dist-tag "${distTagFor(newVersion)}"`);
    }
    info(`  working tree:   ${dirty ? 'DIRTY' : 'clean'}`);
    info(`  test:deploy:    ${skipTests ? 'SKIP' : 'will run'}`);
    info(`  dry-run:        ${dryRun ? 'yes' : 'no'}`);

    if (dryRun) { info('dry run — exiting'); return; }

    if (dirty && !allowDirty) {
        fail('working tree is dirty. Commit or stash first, or pass --allow-dirty.');
    }

    if (behind > 0) {
        fail(`branch is ${behind} behind ${upstream}; pull before shipping.`);
    }

    if (newVersion && newVersion !== pkg.version && tagExists(`v${newVersion}`)) {
        fail(`tag v${newVersion} already exists locally. Pick a different version.`);
    }

    if ((args.mode === 'cut' || args.mode === 'publish')) {
        if (!changelogHasVersion(newVersion)) {
            fail(`CHANGELOG.md has no "## [${newVersion}]" heading. Add the entry first, then re-run.`);
        }
    }

    if (args.mode === 'publish') {
        // cheap sanity check: prevents the "first publish fails after long wait" scenario
        try { sh('npm whoami'); } catch (_) {
            fail('not logged in to npm. Run `npm login` first.');
        }
    }

    if (!await confirm(`proceed with ${args.mode}?`, yes)) fail('aborted by user.', 0);

    runDeployGate(skipTests);

    if (args.mode === 'cut' || args.mode === 'publish') {
        if (newVersion !== pkg.version) {
            info(`bumping package.json: ${pkg.version} → ${newVersion}`);
            writePkgVersion(newVersion);
            shStream(`git add package.json && git commit -m "chore(release): ${newVersion}"`);
        } else {
            info(`package.json already at ${newVersion} — no bump`);
        }

        const tag = `v${newVersion}`;
        info(`tagging ${tag}`);
        shStream(`git tag ${tag}`);
    }

    info(`pushing ${branch} to origin`);
    shStream(`git push origin ${branch}`);

    if (args.mode === 'cut' || args.mode === 'publish') {
        info('pushing tags');
        shStream('git push origin --tags');
    }

    if (args.mode === 'publish') {
        info(`publishing to npm (dist-tag ${distTagFor(newVersion)})`);
        shStream('npm run release');
        info(`✅ published ${pkg.name}@${newVersion}`);
    }

    info(`✅ ${args.mode} complete.`);
}

main().catch(err => fail(err.message || String(err)));
