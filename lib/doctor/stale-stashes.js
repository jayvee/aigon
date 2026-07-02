'use strict';

// Detect and clean up leaked feature-close auto-stashes.
//
// feature-close auto-stashes dirty changes on the default branch before merging
// a feature branch, then pops the stash afterward. A *clean* pop applies and
// drops the stash. A *conflicting* pop leaves the stash on the stack as a safety
// net — but resolving the resulting conflict markers is not the same as dropping
// the stash, and nothing ever re-surfaces the "now drop it" step. So every
// conflicting close leaks one `aigon-feature-close-auto-stash` entry, and they
// accumulate indefinitely. This module lets `aigon doctor` list them and, on
// --fix, archive each to a recoverable patch before dropping.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUTO_STASH_MARKER = 'aigon-feature-close-auto-stash';
const ARCHIVE_DIRNAME = 'aigon-stash-archive';

function git(repoPath, args, opts = {}) {
    return execSync(`git ${args}`, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        ...opts,
    });
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'stash';
}

/**
 * List stashes created by feature-close (message contains AUTO_STASH_MARKER).
 * Returns newest-first with their live `stash@{N}` ref and a stable commit sha
 * so callers can re-resolve the ref even if indices shift after a drop.
 * @returns {{ index: number, ref: string, sha: string, subject: string }[]}
 */
function findAutoStashes(repoPath) {
    let raw = '';
    try {
        // %gd = selector (stash@{N}), %H = sha, %gs = reflog subject
        raw = git(repoPath, "stash list --format='%gd%x09%H%x09%gs'").trim();
    } catch (_) {
        return [];
    }
    if (!raw) return [];
    const out = [];
    for (const line of raw.split('\n')) {
        const [ref, sha, subject = ''] = line.split('\t');
        if (!ref || !subject.includes(AUTO_STASH_MARKER)) continue;
        const m = ref.match(/stash@\{(\d+)\}/);
        out.push({
            index: m ? parseInt(m[1], 10) : NaN,
            ref,
            sha: (sha || '').trim(),
            subject: subject.trim(),
        });
    }
    return out;
}

function archiveDir(repoPath) {
    const gitDir = git(repoPath, 'rev-parse --git-dir').trim();
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(repoPath, gitDir);
    return path.join(abs, ARCHIVE_DIRNAME);
}

/**
 * Write a stash's diff to a recoverable patch file under
 * <git-dir>/aigon-stash-archive/. Resolved by sha so it's index-independent.
 * @returns {string} absolute patch path
 */
function archiveStash(repoPath, stash) {
    const dir = archiveDir(repoPath);
    fs.mkdirSync(dir, { recursive: true });
    const shortSha = (stash.sha || '').slice(0, 8) || 'nosha';
    const file = path.join(dir, `stash-${shortSha}-${slugify(stash.subject)}.patch`);
    const patch = git(repoPath, `stash show -p ${stash.sha}`, { maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(file, patch);
    return file;
}

/**
 * Archive every leaked auto-stash to a patch, then drop it. Drops are resolved
 * by sha (`git stash drop <sha>` is not supported, so we re-find the current
 * index for each sha immediately before dropping) to stay correct as indices
 * shift. Manual/user stashes are never touched.
 * @returns {{ archived: number, dropped: number, patches: string[], errors: string[] }}
 */
function archiveAndDropAutoStashes(repoPath) {
    const result = { archived: 0, dropped: 0, patches: [], errors: [] };
    const targets = findAutoStashes(repoPath);
    for (const stash of targets) {
        let patchPath;
        try {
            patchPath = archiveStash(repoPath, stash);
            result.archived += 1;
            result.patches.push(patchPath);
        } catch (e) {
            result.errors.push(`archive ${stash.sha.slice(0, 8)}: ${e.message}`);
            continue; // never drop a stash we couldn't archive
        }
        // Re-resolve the current index for this sha before dropping.
        try {
            const live = findAutoStashes(repoPath).find(s => s.sha === stash.sha);
            if (!live) { result.errors.push(`drop ${stash.sha.slice(0, 8)}: ref no longer found`); continue; }
            git(repoPath, `stash drop ${live.ref}`);
            result.dropped += 1;
        } catch (e) {
            result.errors.push(`drop ${stash.sha.slice(0, 8)}: ${e.message}`);
        }
    }
    return result;
}

module.exports = {
    AUTO_STASH_MARKER,
    ARCHIVE_DIRNAME,
    findAutoStashes,
    archiveDir,
    archiveStash,
    archiveAndDropAutoStashes,
};
