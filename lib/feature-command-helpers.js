'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const { parseFrontMatter, serializeYamlScalar } = require('./cli-parse');

function parseLogFrontmatterForBackfill(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return { fields: {}, events: [] };
    const block = m[1];
    const fields = {};
    const events = [];
    let inEvents = false;
    for (const line of block.split('\n')) {
        if (/^events:/.test(line)) { inEvents = true; continue; }
        if (inEvents) {
            if (line.startsWith('  - ')) {
                const tsMatch = line.match(/ts:\s*"([^"]+)"/);
                const statusMatch = line.match(/status:\s*(\w+)/);
                if (tsMatch && statusMatch) events.push({ ts: tsMatch[1], status: statusMatch[1] });
            } else if (line && !/^\s/.test(line)) {
                inEvents = false;
                const idx = line.indexOf(':');
                if (idx !== -1) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        } else {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            if (key) fields[key] = val;
        }
    }
    return { fields, events };
}

function estimateExpectedScopeFiles(specPath) {
    try {
        if (!specPath || !fs.existsSync(specPath)) return 1;
        const raw = fs.readFileSync(specPath, 'utf8');
        const parsed = parseFrontMatter(raw);
        const body = parsed.body || raw;

        const pathLike = new Set();
        const inlineCodeMatches = body.match(/`[^`\n]+`/g) || [];
        inlineCodeMatches.forEach(token => {
            const value = token.slice(1, -1).trim();
            if (!value || /\s/.test(value) || /^https?:\/\//i.test(value)) return;
            if (value.includes('/')) pathLike.add(value);
        });

        const acSection = body.match(/^##\s+Acceptance Criteria\s*\r?\n([\s\S]*?)(?=^##\s+|$)/im);
        const acCount = acSection
            ? (acSection[1].match(/^- \[(?: |x|X)\]/gm) || []).length
            : 0;

        const baseline = Math.max(1, Math.min(8, acCount || 1));
        return Math.max(pathLike.size, baseline);
    } catch (_) {
        return 1;
    }
}

function upsertLogFrontmatterScalars(safeWriteWithStatus, logPath, fields) {
    if (!logPath || !fs.existsSync(logPath)) return false;
    const keys = Object.keys(fields || {});
    if (keys.length === 0) return false;

    const content = fs.readFileSync(logPath, 'utf8');
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const serializedLines = keys.map(key => `${key}: ${serializeYamlScalar(fields[key])}`);
    let nextContent = content;

    if (fmMatch) {
        const lines = fmMatch[1].split(/\r?\n/);
        keys.forEach((key, index) => {
            const lineValue = serializedLines[index];
            const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`);
            const existingIndex = lines.findIndex(line => keyPattern.test(line));
            if (existingIndex >= 0) lines[existingIndex] = lineValue;
            else lines.push(lineValue);
        });
        const rebuilt = `---\n${lines.join('\n')}\n---\n`;
        nextContent = rebuilt + content.slice(fmMatch[0].length).replace(/^\r?\n/, '');
    } else {
        const frontmatter = `---\n${serializedLines.join('\n')}\n---\n\n`;
        nextContent = frontmatter + content.replace(/^﻿/, '');
    }

    if (nextContent === content) return false;
    safeWriteWithStatus(logPath, nextContent);
    return true;
}

function runGitRead(cwd, args) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.error || result.status !== 0) {
        throw result.error || new Error(`git ${args.join(' ')} exited with code ${result.status}`);
    }
    return (result.stdout || '').trim();
}

function isIgnoredFeatureSubmissionPath(featureNum, relativePath) {
    const normalizedFeatureId = String(parseInt(String(featureNum), 10) || featureNum).padStart(2, '0');
    const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
    if (!normalizedPath) return true;
    if (normalizedPath.startsWith('.aigon/')) return true;
    if (normalizedPath.startsWith('docs/specs/features/logs/')) {
        return normalizedPath.startsWith(`docs/specs/features/logs/feature-${normalizedFeatureId}-`);
    }
    return false;
}

function getFeatureSubmissionEvidence(repoPath, featureNum, defaultBranch) {
    const baseBranch = defaultBranch || 'main';
    try {
        const mergeBase = runGitRead(repoPath, ['merge-base', 'HEAD', baseBranch]);
        const commitsRaw = runGitRead(repoPath, ['log', '--no-merges', '--format=%H%x09%s', `${mergeBase}..HEAD`]);
        const commits = commitsRaw
            ? commitsRaw.split('\n').map(line => {
                const [sha, ...rest] = line.split('\t');
                return { sha: sha || '', subject: rest.join('\t').trim() };
            }).filter(entry => entry.sha)
            : [];
        const substantiveCommits = commits.filter(entry => !/^chore: worktree setup for\b/i.test(entry.subject));

        const changedFilesRaw = runGitRead(repoPath, ['diff', '--name-only', `${mergeBase}..HEAD`]);
        const changedFiles = changedFilesRaw ? changedFilesRaw.split('\n').map(line => line.trim()).filter(Boolean) : [];
        const substantiveFiles = changedFiles.filter(file => !isIgnoredFeatureSubmissionPath(featureNum, file));

        if (substantiveCommits.length === 0) {
            return {
                ok: false,
                reason: 'no substantive commits found beyond worktree setup',
                changedFiles,
                substantiveFiles,
                substantiveCommits,
            };
        }

        if (substantiveFiles.length === 0) {
            return {
                ok: false,
                reason: 'no implementation files changed beyond feature logs/state files',
                changedFiles,
                substantiveFiles,
                substantiveCommits,
            };
        }

        return {
            ok: true,
            reason: null,
            changedFiles,
            substantiveFiles,
            substantiveCommits,
        };
    } catch (error) {
        return {
            ok: false,
            reason: `could not inspect git history (${error.message})`,
            changedFiles: [],
            substantiveFiles: [],
            substantiveCommits: [],
        };
    }
}


module.exports = {
    runGitRead,
    isIgnoredFeatureSubmissionPath,
    getFeatureSubmissionEvidence,
    parseLogFrontmatterForBackfill,
    estimateExpectedScopeFiles,
    upsertLogFrontmatterScalars,
};
