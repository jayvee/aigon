'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 8000;

async function safeGitAsync(cwd, args) {
    try {
        const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 16,
            timeout: GIT_TIMEOUT_MS,
        });
        return stdout.trim();
    } catch (_) {
        return null;
    }
}

function findFeatureWorktree(repoPath, featureId) {
    const repoName = path.basename(repoPath);
    const baseDir = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
    if (!fs.existsSync(baseDir)) return null;
    const idStr = String(featureId);
    let entries;
    try {
        entries = fs.readdirSync(baseDir);
    } catch (_) {
        return null;
    }
    const fleetRegex = /^feature-(\d+)-(\w+)-.+$/;
    const driveRegex = /^feature-(\d+)-.+$/;
    const fleetHits = [];
    const driveHits = [];
    for (const name of entries) {
        const fleetMatch = name.match(fleetRegex);
        if (fleetMatch && fleetMatch[1] === idStr) {
            fleetHits.push(path.join(baseDir, name));
            continue;
        }
        const driveMatch = name.match(driveRegex);
        if (driveMatch && driveMatch[1] === idStr) {
            driveHits.push(path.join(baseDir, name));
        }
    }
    const candidates = fleetHits.length ? fleetHits : driveHits;
    return candidates.find(p => fs.existsSync(p)) || null;
}

function parseLogLines(raw) {
    if (!raw) return [];
    return raw.split('\n').map(line => {
        const parts = line.split('\x1f');
        if (parts.length < 4) return null;
        const [hash, timestamp, author, message, trailerRaw = ''] = parts;
        return {
            hash: hash.slice(0, 12),
            fullHash: hash,
            timestamp,
            author,
            message,
            aigonInternal: trailerRaw.trim() === 'true',
        };
    }).filter(Boolean);
}

async function gitLog(cwd, range) {
    const fmt = '--format=%H%x1f%aI%x1f%an%x1f%s%x1f%(trailers:key=Aigon-Internal,valueonly,separator=%x1f)';
    const raw = await safeGitAsync(cwd, ['log', range, fmt]);
    return parseLogLines(raw);
}

async function collectFiles(cwd, hash) {
    const raw = await safeGitAsync(cwd, ['show', '--numstat', '--format=', hash]);
    if (!raw) return [];
    const files = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (!m) continue;
        files.push({
            path: m[3],
            added: m[1] === '-' ? 0 : parseInt(m[1], 10) || 0,
            removed: m[2] === '-' ? 0 : parseInt(m[2], 10) || 0,
        });
    }
    return files;
}

async function attachFiles(cwd, commits) {
    // Fetch file stats for all commits concurrently.
    const fileLists = await Promise.all(commits.map(c => collectFiles(cwd, c.fullHash)));
    return commits.map((c, i) => ({
        hash: c.hash,
        fullHash: c.fullHash,
        message: c.message,
        author: c.author,
        timestamp: c.timestamp,
        files: fileLists[i],
    }));
}

// Local-only branch detection — reads refs on disk, no network.
async function detectDefaultBranchLocal(cwd) {
    for (const b of ['main', 'master']) {
        const r = await safeGitAsync(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${b}`]);
        if (r !== null) return b;
    }
    return (await safeGitAsync(cwd, ['branch', '--show-current'])) || 'main';
}

// Reads remote.origin.url from .git/config — purely local, no network.
async function resolveGitHubRepoUrl(repoPath) {
    const originUrl = await safeGitAsync(repoPath, ['config', '--get', 'remote.origin.url']);
    if (!originUrl) return null;
    if (!/github\.com[:/]/i.test(originUrl)) return null;
    const slug = originUrl
        .replace(/^git@github\.com:/, '')
        .replace(/^https?:\/\/github\.com\//, '')
        .replace(/\.git$/, '');
    return 'https://github.com/' + slug;
}

async function collectFromWorktree(worktreePath) {
    const defaultBranch = await detectDefaultBranchLocal(worktreePath);
    const commits = await gitLog(worktreePath, `${defaultBranch}..HEAD`);
    const filtered = commits.filter(c => !c.aigonInternal);
    return { source: 'worktree', commits: await attachFiles(worktreePath, filtered) };
}

async function collectFromMerged(repoPath, featureId) {
    const idStr = String(featureId);
    // Search HEAD only (not --all) to avoid walking remote refs.
    // Features always merge to the default branch so HEAD covers it.
    const mergeHash = await safeGitAsync(repoPath, [
        'log', 'HEAD',
        '--extended-regexp',
        `--grep=^Merge feature ${idStr}( |$)`,
        '--format=%H',
        '-1',
    ]);
    if (!mergeHash) {
        return { source: 'merged', commits: [], mergeCommit: null };
    }
    const parent2 = await safeGitAsync(repoPath, ['rev-parse', `${mergeHash}^2`]);
    let commits = [];
    if (parent2) {
        commits = await gitLog(repoPath, `${mergeHash}^1..${mergeHash}^2`);
    }
    if (commits.length === 0) {
        commits = await gitLog(repoPath, `${mergeHash}~1..${mergeHash}`);
    }
    const filtered = commits.filter(c => !c.aigonInternal);
    return {
        source: 'merged',
        mergeCommit: mergeHash,
        commits: await attachFiles(repoPath, filtered),
    };
}

async function handleCommits(req, res, ctx, match) {
    let entityId = '';
    try {
        entityId = decodeURIComponent(match[1] || '').trim();
    } catch (_) {
        ctx.sendJson(400, { error: 'Invalid feature id in path' });
        return;
    }
    if (!/^\d+$/.test(entityId)) {
        ctx.sendJson(400, { error: 'Feature id must be numeric' });
        return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, String(url.searchParams.get('repoPath') || '').trim());
    if (!repoPath) return;

    try {
        const worktreePath = findFeatureWorktree(repoPath, entityId);
        const [payload, repoUrl] = await Promise.all([
            worktreePath ? collectFromWorktree(worktreePath) : collectFromMerged(repoPath, entityId),
            resolveGitHubRepoUrl(repoPath),
        ]);
        payload.repoUrl = repoUrl;
        ctx.sendJson(200, payload);
    } catch (e) {
        ctx.sendJson(500, { error: e && e.message ? e.message : String(e) });
    }
}

module.exports = [
    {
        method: 'GET',
        path: /^\/api\/features?\/([^/]+)\/commits$/,
        handler: handleCommits,
    },
];

module.exports._internals = {
    findFeatureWorktree,
    collectFromWorktree,
    collectFromMerged,
    parseLogLines,
};
