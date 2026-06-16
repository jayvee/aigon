'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { detectDefaultBranch } = require('../dashboard-status-helpers');

const MAX_FILE_DIFF_BYTES = 200 * 1024;

function safeGit(cwd, args, opts = {}) {
    try {
        return execFileSync('git', ['-C', cwd, ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 1024 * 1024 * 16,
            ...opts,
        }).trim();
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
    // Prefer fleet pattern feature-{id}-{agent}-{desc}; fall back to drive feature-{id}-{desc}.
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
    return candidates.find(p => fs.existsSync(p) && isValidGitWorktree(p)) || null;
}

function isValidGitWorktree(worktreePath) {
    if (!worktreePath || !fs.existsSync(worktreePath)) return false;
    return safeGit(worktreePath, ['rev-parse', '--git-dir']) !== null;
}

function parseLogLines(raw) {
    if (!raw) return [];
    return raw.split('\n').map(line => {
        const parts = line.split('\x1f');
        if (parts.length < 4) return null;
        const [hash, timestamp, author, ...rest] = parts;
        return {
            hash: hash.slice(0, 12),
            fullHash: hash,
            timestamp,
            author,
            message: rest.join('\x1f'),
        };
    }).filter(Boolean);
}

function gitLog(cwd, range) {
    // ASCII Unit Separator (\x1f) is safe vs. commit messages containing pipes.
    const fmt = '--format=%H%x1f%aI%x1f%an%x1f%s';
    const raw = safeGit(cwd, ['log', range, fmt]);
    return parseLogLines(raw);
}

function collectFiles(cwd, hash) {
    const raw = safeGit(cwd, ['show', '--numstat', '--format=', hash]);
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

function collectFileNumstat(cwd, hash, filePath) {
    const raw = safeGit(cwd, ['show', '--numstat', '--format=', hash, '--', filePath]);
    if (!raw) return null;
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (!m) continue;
        return {
            path: m[3],
            added: m[1] === '-' ? null : parseInt(m[1], 10) || 0,
            removed: m[2] === '-' ? null : parseInt(m[2], 10) || 0,
            binary: m[1] === '-' || m[2] === '-',
        };
    }
    return null;
}

function attachFiles(cwd, commits) {
    return commits.map(c => ({
        hash: c.hash,
        fullHash: c.fullHash,
        message: c.message,
        author: c.author,
        timestamp: c.timestamp,
        files: collectFiles(cwd, c.fullHash),
    }));
}

function resolveGitHubRepoUrl(repoPath) {
    const originUrl = safeGit(repoPath, ['remote', 'get-url', 'origin']);
    if (!originUrl) return null;
    if (!/github\.com[:/]/i.test(originUrl)) return null;
    // SSH: git@github.com:owner/repo.git  →  https://github.com/owner/repo
    // HTTPS: https://github.com/owner/repo.git  →  https://github.com/owner/repo
    const slug = originUrl
        .replace(/^git@github\.com:/, '')
        .replace(/^https?:\/\/github\.com\//, '')
        .replace(/\.git$/, '');
    return 'https://github.com/' + slug;
}

function commitMessageBody(cwd, fullHash) {
    return safeGit(cwd, ['show', '-s', '--format=%B', fullHash]) || '';
}

function isInternalPlumbingCommit(cwd, fullHash) {
    return /Aigon-Internal:\s*true/i.test(commitMessageBody(cwd, fullHash));
}

function collectFromWorktree(worktreePath) {
    const defaultBranch = detectDefaultBranch(worktreePath);
    const range = `${defaultBranch}..HEAD`;
    const commits = gitLog(worktreePath, range).filter(c => !isInternalPlumbingCommit(worktreePath, c.fullHash));
    return { source: 'worktree', commits: attachFiles(worktreePath, commits) };
}

function collectFromMerged(repoPath, featureId) {
    const idStr = String(featureId);
    // grep matches "Merge feature {id}" and "Merge feature {id} from agent {agentId}".
    // Match "Merge feature {id}" with a trailing space, end-of-line, or " from".
    // Using POSIX-extended grep so the alternation works across git versions.
    const mergeHash = safeGit(repoPath, [
        'log',
        '--all',
        '--extended-regexp',
        `--grep=^Merge feature ${idStr}( |$)`,
        '--format=%H',
        '-1',
    ]);
    if (!mergeHash) {
        return { source: 'merged', commits: [], mergeCommit: null };
    }
    // Try parent1..parent2 for true merges; fall back to the single merge commit (squash/ff).
    const parent2 = safeGit(repoPath, ['rev-parse', `${mergeHash}^2`]);
    let commits = [];
    if (parent2) {
        commits = gitLog(repoPath, `${mergeHash}^1..${mergeHash}^2`);
    }
    if (commits.length === 0) {
        // Squash or fast-forward — surface the merge commit itself.
        commits = gitLog(repoPath, `${mergeHash}~1..${mergeHash}`);
    }
    const filtered = commits.filter(c => !isInternalPlumbingCommit(repoPath, c.fullHash));
    return {
        source: 'merged',
        mergeCommit: mergeHash,
        commits: attachFiles(repoPath, filtered),
    };
}

function resolveFeatureCommitSource(repoPath, featureId) {
    const worktreePath = findFeatureWorktree(repoPath, featureId);
    if (worktreePath) {
        return { source: 'worktree', gitPath: worktreePath };
    }
    return { source: 'merged', gitPath: repoPath };
}

function readFileDiff(cwd, hash, filePath) {
    let raw = '';
    let truncated = false;
    try {
        raw = execFileSync('git', [
            '-C', cwd,
            'show',
            '--format=',
            '--patch',
            '--find-renames',
            '--find-copies',
            hash,
            '--',
            filePath,
        ], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 1024 * 1024 * 16,
        });
    } catch (error) {
        if (error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && error.stdout) {
            raw = String(error.stdout);
            truncated = true;
        } else {
            return null;
        }
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_DIFF_BYTES) {
        raw = Buffer.from(raw, 'utf8').subarray(0, MAX_FILE_DIFF_BYTES).toString('utf8');
        truncated = true;
    }
    return { raw, truncated };
}

function getFileDiffPayload(repoPath, featureId, hash, filePath) {
    const sourceInfo = resolveFeatureCommitSource(repoPath, featureId);
    const commitExists = safeGit(sourceInfo.gitPath, ['cat-file', '-e', `${hash}^{commit}`]) !== null;
    if (!commitExists) {
        return { status: 404, payload: { error: 'Unknown commit' } };
    }
    const numstat = collectFileNumstat(sourceInfo.gitPath, hash, filePath);
    const diffResult = readFileDiff(sourceInfo.gitPath, hash, filePath);
    if (!diffResult) {
        return { status: 404, payload: { error: 'Diff not found for file' } };
    }
    const binary = !!(numstat && numstat.binary) || /^Binary files /m.test(diffResult.raw);
    const hasTextHunks = /^@@ /m.test(diffResult.raw);
    const diff = binary || !hasTextHunks ? '' : diffResult.raw;
    return {
        status: 200,
        payload: {
            source: sourceInfo.source,
            hash,
            path: filePath,
            diff,
            binary,
            truncated: diffResult.truncated,
            repoUrl: resolveGitHubRepoUrl(repoPath),
        },
    };
}

function handleCommits(req, res, ctx, match) {
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
        const payload = worktreePath
            ? collectFromWorktree(worktreePath)
            : collectFromMerged(repoPath, entityId);
        payload.repoUrl = resolveGitHubRepoUrl(repoPath);
        ctx.sendJson(200, payload);
    } catch (e) {
        ctx.sendJson(500, { error: e && e.message ? e.message : String(e) });
    }
}

function handleCommitDiff(req, res, ctx, match) {
    let entityId = '';
    let hash = '';
    try {
        entityId = decodeURIComponent(match[1] || '').trim();
        hash = decodeURIComponent(match[2] || '').trim();
    } catch (_) {
        ctx.sendJson(400, { error: 'Invalid feature id or commit hash in path' });
        return;
    }
    if (!/^\d+$/.test(entityId)) {
        ctx.sendJson(400, { error: 'Feature id must be numeric' });
        return;
    }
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
        ctx.sendJson(400, { error: 'Commit hash is invalid' });
        return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, String(url.searchParams.get('repoPath') || '').trim());
    if (!repoPath) return;
    const filePath = String(url.searchParams.get('path') || '').trim();
    if (!filePath) {
        ctx.sendJson(400, { error: 'Missing required path query parameter' });
        return;
    }

    try {
        const result = getFileDiffPayload(repoPath, entityId, hash, filePath);
        ctx.sendJson(result.status, result.payload);
    } catch (e) {
        ctx.sendJson(500, { error: e && e.message ? e.message : String(e) });
    }
}

module.exports = [
    {
        method: 'GET',
        // Accept either /api/feature/:id/commits/:hash/diff or /api/features/:id/commits/:hash/diff.
        path: /^\/api\/features?\/([^/]+)\/commits\/([^/]+)\/diff$/,
        handler: handleCommitDiff,
    },
    {
        method: 'GET',
        // Accept either /api/feature/:id/commits or /api/features/:id/commits.
        path: /^\/api\/features?\/([^/]+)\/commits$/,
        handler: handleCommits,
    },
];

module.exports._internals = {
    findFeatureWorktree,
    isValidGitWorktree,
    collectFromWorktree,
    collectFromMerged,
    getFileDiffPayload,
    parseLogLines,
    MAX_FILE_DIFF_BYTES,
};
