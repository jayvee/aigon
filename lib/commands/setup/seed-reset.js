'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// --- Gold-image helpers (F504) ---------------------------------------------
//
// A "gold image" is a tarball of a fully-provisioned seed repo (including
// `.git` and `node_modules`) that lets benchmark runs skip the ~2-3 minute
// clone/install/push cycle on every pair reset.

function goldImageDir() {
    return path.join(os.homedir(), '.aigon', 'bench-seeds');
}

function goldImagePath(seedName) {
    return path.join(goldImageDir(), `${seedName}-gold.tar.gz`);
}

function goldImageMetaPath(seedName) {
    return path.join(goldImageDir(), `${seedName}-gold.meta.json`);
}

function goldImageExists(seedName) {
    return fs.existsSync(goldImagePath(seedName)) && fs.existsSync(goldImageMetaPath(seedName));
}

function readGoldMeta(seedName) {
    const p = goldImageMetaPath(seedName);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function writeGoldMeta(seedName, meta) {
    fs.mkdirSync(goldImageDir(), { recursive: true });
    fs.writeFileSync(goldImageMetaPath(seedName), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

/**
 * Tar up the seed repo into ~/.aigon/bench-seeds/<seed>-gold.tar.gz.
 * Returns { ok, sizeBytes, ms, error? }.
 */
function createGoldImage({ seedName, repoPath, parentDir, repoName, execFn = spawnSync }) {
    fs.mkdirSync(goldImageDir(), { recursive: true });
    const tarPath = goldImagePath(seedName);
    const tmpPath = `${tarPath}.tmp-${process.pid}`;
    const t0 = Date.now();
    try {
        const result = execFn('tar', ['-czf', tmpPath, '-C', parentDir, repoName], {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            timeout: 300_000,
        });
        if (result.status !== 0) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            return { ok: false, error: `tar exited ${result.status}: ${(result.stderr || '').slice(0, 400)}` };
        }
        fs.renameSync(tmpPath, tarPath);
        const stat = fs.statSync(tarPath);
        return { ok: true, sizeBytes: stat.size, ms: Date.now() - t0 };
    } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        return { ok: false, error: e.message };
    }
}

/**
 * Extract a gold image tarball over `parentDir`, replacing any existing
 * `<repoName>` subdirectory. Returns { ok, ms, error? }.
 */
function extractGoldImage({ seedName, parentDir, repoName, repoPath, execFn = spawnSync }) {
    const tarPath = goldImagePath(seedName);
    if (!fs.existsSync(tarPath)) return { ok: false, error: `gold image not found at ${tarPath}` };
    const t0 = Date.now();
    try {
        if (fs.existsSync(repoPath)) {
            fs.rmSync(repoPath, { recursive: true, force: true });
        }
        fs.mkdirSync(parentDir, { recursive: true });
        const result = execFn('tar', ['-xzf', tarPath, '-C', parentDir], {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            timeout: 120_000,
        });
        if (result.status !== 0) {
            return { ok: false, error: `tar exited ${result.status}: ${(result.stderr || '').slice(0, 400)}` };
        }
        return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function getAigonVersionForGold() {
    try {
        return require(path.join(__dirname, '..', '..', '..', 'package.json')).version;
    } catch (_) {
        return 'unknown';
    }
}

const FEATURE_STAGE_FOLDERS = [
    { folder: '01-inbox', stage: 'inbox' },
    { folder: '02-backlog', stage: 'backlog' },
    { folder: '03-in-progress', stage: 'in-progress' },
    { folder: '04-in-evaluation', stage: 'in-evaluation' },
    { folder: '05-done', stage: 'done' },
    { folder: '06-paused', stage: 'paused' },
];

const WORKING_REPO_REGISTRY = {
    brewboard: 'https://github.com/jayvee/brewboard.git',
    trailhead: 'https://github.com/jayvee/trailhead.git',
};

// Canonical seed repo URLs. Single source of truth for both `seed-reset`
// (wipe-and-reclone existing) and `install-seed` (first-time clone).
const SEED_REGISTRY = {
    brewboard: 'https://github.com/jayvee/brewboard-seed.git',
    trailhead: 'https://github.com/jayvee/trailhead-seed.git',
};

// Stages that should be collapsed back to backlog during a seed reset so the
// board looks like a real project (no orphaned in-progress without sessions).
const SEED_RESET_TO_BACKLOG = new Set(['in-progress', 'in-evaluation', 'paused']);

function canonicalSeedFeatureId(id) {
    const raw = String(id);
    if (/^\d+$/.test(raw)) return String(parseInt(raw, 10)).padStart(2, '0');
    return raw;
}

function parseEntitySpecIdentity(file, entityType, stage) {
    const prefix = entityType === 'research' ? 'research' : 'feature';
    const match = file.match(new RegExp(`^${prefix}-(.+)\\.md$`));
    if (!match) return null;
    const suffix = match[1];
    if (/^\d+-/.test(suffix)) {
        return canonicalSeedFeatureId(suffix.split('-')[0]);
    }
    if (stage === 'inbox') return suffix;
    return null;
}

function writeJsonFile(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function rebuildSeedFeatureManifests(repoPath, options = {}) {
    const collapseActiveToBacklog = options.collapseActiveToBacklog === true;
    const specsRoot = path.join(repoPath, 'docs', 'specs', 'features');
    const stateDir = path.join(repoPath, '.aigon', 'state');
    const backlogDir = path.join(specsRoot, '02-backlog');
    const manifests = [];

    FEATURE_STAGE_FOLDERS.forEach(({ folder, stage }) => {
        const dir = path.join(specsRoot, folder);
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir)
            .filter(file => /^feature-\d+-.*\.md$/.test(file))
            .forEach(file => {
                const match = file.match(/^feature-(\d+)-(.+)\.md$/);
                if (!match) return;

                let effectiveStage = stage;
                let specFile = path.join(dir, file);

                // Move active-stage specs back to backlog so the board is clean.
                if (collapseActiveToBacklog && SEED_RESET_TO_BACKLOG.has(stage)) {
                    fs.mkdirSync(backlogDir, { recursive: true });
                    const dest = path.join(backlogDir, file);
                    fs.renameSync(specFile, dest);
                    specFile = dest;
                    effectiveStage = 'backlog';

                    // Remove any logs/evals left over from the prior run.
                    const featureNum = match[1];
                    const logsDir = path.join(specsRoot, 'logs');
                    const evalsDir = path.join(specsRoot, 'evaluations');
                    [logsDir, evalsDir].forEach(d => {
                        if (!fs.existsSync(d)) return;
                        fs.readdirSync(d)
                            .filter(f => f.startsWith(`feature-${featureNum}`) && f.endsWith('.md'))
                            .forEach(f => fs.unlinkSync(path.join(d, f)));
                    });
                    // Also check logs/alternatives and logs/selected
                    ['alternatives', 'selected'].forEach(sub => {
                        const subDir = path.join(logsDir, sub);
                        if (!fs.existsSync(subDir)) return;
                        fs.readdirSync(subDir)
                            .filter(f => f.startsWith(`feature-${featureNum}`) && f.endsWith('.md'))
                            .forEach(f => fs.unlinkSync(path.join(subDir, f)));
                    });
                }

                const featureId = canonicalSeedFeatureId(match[1]);
                manifests.push({
                    id: featureId,
                    type: 'feature',
                    name: match[2],
                    stage: effectiveStage,
                    specPath: specFile,
                    agents: [],
                    winner: null,
                    pending: [],
                    events: [],
                });
            });
    });

    manifests
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
        .forEach(manifest => {
            writeJsonFile(path.join(stateDir, `feature-${manifest.id}.json`), manifest);
        });

    return manifests;
}

/**
 * Apply seed-state fixtures declared in `.aigon/seed-state.json`.
 *
 * After the standard bootstrap (which puts everything in backlog/done),
 * this emits the exact workflow events that would have been produced by a
 * real feature run — bringing specific features to their declared target state.
 *
 * This gives the seed a realistic project snapshot: some features implemented
 * and awaiting review, rather than everything collapsed to backlog.
 *
 * Format of `.aigon/seed-state.json`:
 * {
 *   "features": {
 *     "08": {
 *       "targetState": "code_review_in_progress",
 *       "authorAgentId": "cc",
 *       "specPath": "docs/specs/features/03-in-progress/feature-08-rating-filter.md"
 *     }
 *   }
 * }
 *
 * Supported targetState values: "code_review_in_progress"
 */
function applySeedStateFixtures(repoPath) {
    const fixturesPath = path.join(repoPath, '.aigon', 'seed-state.json');
    if (!fs.existsSync(fixturesPath)) return 0;

    let config;
    try {
        config = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
    } catch (e) {
        console.warn(`   ⚠️  Could not parse .aigon/seed-state.json: ${e.message}`);
        return 0;
    }

    const { persistEntityEvents } = require('../../workflow-core/engine');
    const features = config.features || {};
    let applied = 0;
    const now = () => new Date().toISOString();

    for (const [featureId, fixture] of Object.entries(features)) {
        const target = fixture.targetState;
        const agent = fixture.authorAgentId || 'cc';
        const specPath = fixture.specPath
            ? path.join(repoPath, fixture.specPath)
            : null;

        try {
            if (target === 'code_review_in_progress') {
                const events = [
                    {
                        type: 'feature.started',
                        featureId,
                        mode: 'drive',
                        authorAgentId: agent,
                        agents: [agent],
                        modelOverrides: {},
                        effortOverrides: {},
                        at: now(),
                    },
                    {
                        type: 'signal.agent_started',
                        featureId,
                        agentId: agent,
                        role: 'do',
                        at: now(),
                    },
                    {
                        type: 'signal.agent_submitted',
                        featureId,
                        agentId: agent,
                        role: 'do',
                        at: now(),
                    },
                    {
                        type: 'feature.code_review.started',
                        featureId,
                        reviewerId: null,
                        pendingCodeReviewer: null,
                        at: now(),
                    },
                ];
                persistEntityEvents(repoPath, 'feature', featureId, events);

                // Move spec to 03-in-progress if it exists and isn't already there
                let sourcePath = specPath;
                if (sourcePath && !fs.existsSync(sourcePath)) {
                    const basename = path.basename(sourcePath);
                    sourcePath = FEATURE_STAGE_FOLDERS
                        .map(({ folder }) => path.join(repoPath, 'docs', 'specs', 'features', folder, basename))
                        .find(candidate => fs.existsSync(candidate));
                }

                if (sourcePath && fs.existsSync(sourcePath)) {
                    const specsRoot = path.join(repoPath, 'docs', 'specs', 'features');
                    const inProgressDir = path.join(specsRoot, '03-in-progress');
                    const destPath = path.join(inProgressDir, path.basename(sourcePath));
                    if (sourcePath !== destPath && !fs.existsSync(destPath)) {
                        fs.mkdirSync(inProgressDir, { recursive: true });
                        fs.renameSync(sourcePath, destPath);
                    }
                }

                applied++;
            }
        } catch (e) {
            console.warn(`   ⚠️  Failed to apply seed fixture for feature ${featureId}: ${e.message}`);
        }
    }

    return applied;
}

// Returns the most recent commit whose subject matches the highest-priority
// pattern group.  Groups are tried in order; within each group the newest
// matching commit wins (git log is newest-first).
function findSeedResetBaseline(repoPath) {
    const matcherGroups = [
        [/^chore: reset fixture to clean backlog state$/],
        [/^chore: update Aigon to v/i, /^chore: install Aigon v/i],
        [/^chore: ignore local env files$/],
        [/^chore: seed aigon specs/i],
    ];

    try {
        const lines = execSync('git log --all --format="%H\t%s"', {
            cwd: repoPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).split('\n').map(line => line.trim()).filter(Boolean);

        for (const matchers of matcherGroups) {
            for (const line of lines) {
                const [commit, subject = ''] = line.split('\t');
                if (matchers.some(re => re.test(subject))) {
                    return { commit, subject };
                }
            }
        }
    } catch (e) {
        return null;
    }

    return null;
}

function normalizeGitHubRepoSlug(remoteUrl) {
    const match = String(remoteUrl || '').trim().match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    return match ? `${match[1]}/${match[2]}` : null;
}

function collectSeedResetRemoteUrls({
    repoName,
    seedUrl,
    repoPath,
    repoExists,
    workingRepoRegistry = WORKING_REPO_REGISTRY,
    execFn = execSync,
    pathExists = fs.existsSync,
    pathLib = path,
}) {
    const urls = new Set();
    if (seedUrl) urls.add(seedUrl);
    if (workingRepoRegistry[repoName]) urls.add(workingRepoRegistry[repoName]);

    if (repoExists && pathExists(pathLib.join(repoPath, '.git'))) {
        try {
            const originUrl = execFn('git remote get-url origin', {
                cwd: repoPath,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (originUrl) urls.add(originUrl);
        } catch (_) { /* ignore */ }
    }

    return [...urls];
}

function parseSeedResetRemoteHeads(output) {
    return String(output || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.match(/^.+\trefs\/heads\/(.+)$/))
        .map(match => match && match[1])
        .filter(Boolean);
}

function cleanupSeedResetRemoteBranches({
    remoteUrls,
    repoPath,
    repoExists,
    execFn = execSync,
    fsLib = fs,
    osLib = os,
    pathLib = path,
}) {
    const result = { helperRepoCreated: false, deletedByRemote: {} };
    if (!remoteUrls || remoteUrls.length === 0) return result;

    const hasRepoCwd = repoExists && fsLib.existsSync(pathLib.join(repoPath, '.git'));
    let helperRepo = null;
    let cwd = repoPath;

    if (!hasRepoCwd) {
        helperRepo = fsLib.mkdtempSync(pathLib.join(osLib.tmpdir(), 'aigon-seed-reset-'));
        execFn('git init -q', { cwd: helperRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        result.helperRepoCreated = true;
        cwd = helperRepo;
    }

    try {
        remoteUrls.forEach(remoteUrl => {
            const lsRemoteOutput = execFn(
                `git ls-remote --heads "${remoteUrl}" 'feature-*' 'research-*'`,
                { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
            );
            const branchNames = parseSeedResetRemoteHeads(lsRemoteOutput);
            result.deletedByRemote[remoteUrl] = branchNames;
            if (branchNames.length === 0) return;

            const refs = branchNames.map(name => `:refs/heads/${name}`).join(' ');
            execFn(`git push "${remoteUrl}" ${refs}`, {
                cwd,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        });
        return result;
    } finally {
        if (helperRepo) {
            try { fsLib.rmSync(helperRepo, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        }
    }
}

function closeSeedResetOpenPullRequests({
    remoteUrl,
    execFn = execSync,
}) {
    const repoSlug = normalizeGitHubRepoSlug(remoteUrl);
    const result = { repoSlug, closed: [], skipped: null };
    if (!repoSlug) {
        result.skipped = 'non_github_remote';
        return result;
    }

    try {
        execFn('gh --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
        result.skipped = 'gh_missing';
        return result;
    }

    try {
        execFn('gh auth status', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
        result.skipped = 'gh_auth';
        return result;
    }

    const prs = JSON.parse(execFn(
        `gh pr list --repo "${repoSlug}" --state open --limit 100 --json number,headRefName`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ) || '[]');

    prs
        .filter(pr => /^feature-|^research-/.test(pr.headRefName || ''))
        .forEach(pr => {
            execFn(
                `gh pr close ${pr.number} --repo "${repoSlug}" --comment "Closed by aigon seed-reset" --delete-branch=false`,
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
            );
            result.closed.push(pr.number);
        });

    return result;
}

function stripSeedResetStaleConfigKeys(configPath, keys = ['pro']) {
    if (!fs.existsSync(configPath)) return [];
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const removed = [];
    keys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(raw, key)) {
            delete raw[key];
            removed.push(key);
        }
    });
    if (removed.length > 0) {
        fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');
    }
    return removed;
}

module.exports = {
    FEATURE_STAGE_FOLDERS,
    WORKING_REPO_REGISTRY,
    SEED_REGISTRY,
    SEED_RESET_TO_BACKLOG,
    canonicalSeedFeatureId,
    parseEntitySpecIdentity,
    writeJsonFile,
    rebuildSeedFeatureManifests,
    findSeedResetBaseline,
    normalizeGitHubRepoSlug,
    collectSeedResetRemoteUrls,
    parseSeedResetRemoteHeads,
    cleanupSeedResetRemoteBranches,
    closeSeedResetOpenPullRequests,
    stripSeedResetStaleConfigKeys,
    applySeedStateFixtures,
    // Gold-image helpers (F504)
    goldImageDir,
    goldImagePath,
    goldImageMetaPath,
    goldImageExists,
    readGoldMeta,
    writeGoldMeta,
    createGoldImage,
    extractGoldImage,
    getAigonVersionForGold,
};
