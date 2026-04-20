'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const agentRegistry = require('./agent-registry');
const ATTRIBUTION_AGENT_IDS = agentRegistry.getAttributionAgentIds();
const ATTRIBUTION_AGENT_ID_SET = new Set(ATTRIBUTION_AGENT_IDS);
const LEGACY_EMAIL_AGENT_IDS = agentRegistry.getAgentEmailIds();
const AI_AGENT_EMAIL_RE = agentRegistry.getAgentEmailRegex();
const AIGON_NOTES_REF = 'aigon-attribution';

const COMMIT_CACHE_RELATIVE_PATH = path.join('.aigon', 'cache', 'commits.json');
const KNOWN_AGENT_IDS = agentRegistry.getKnownAgentIds();

/**
 * Run a git command with stdio: inherit (for side-effecting commands like commit/checkout).
 * Logs the command before running. Re-throws on failure.
 * @param {string} command - Full git command (e.g. 'git checkout main')
 * @param {object} [options] - Additional execSync options
 */
function run(command, options = {}) {
    console.log(`Running git: ${command}`);
    try {
        // For push commands, capture stderr and filter out GitHub's remote hints
        if (command.includes('git push')) {
            const result = spawnSync('sh', ['-c', command], {
                stdio: ['inherit', 'inherit', 'pipe'],
                ...options,
            });
            if (result.stderr && result.stderr.length > 0) {
                const stderr = result.stderr.toString();
                const filtered = stderr.split('\n').filter(line =>
                    !line.startsWith('remote:') && !line.match(/^\s*$/)
                ).join('\n');
                if (filtered.trim()) process.stderr.write(filtered + '\n');
            }
            if (result.status !== 0) {
                throw new Error(`git push exited with code ${result.status}`);
            }
        } else {
            execSync(command, { stdio: 'inherit', ...options });
        }
    } catch (e) {
        console.error('❌ Git command failed.');
        throw e;
    }
}

/**
 * Get porcelain git status, filtering out .env files.
 * .env files contain pulled secrets and must never block workflows.
 * This is the SINGLE place where .env filtering lives.
 * @param {string} [cwd] - Optional working directory (for worktree status)
 * @returns {string} Filtered porcelain status, or '' if clean/error
 */
function getStatus(cwd) {
    try {
        const cmd = cwd
            ? `git -C "${cwd}" status --porcelain`
            : 'git status --porcelain';
        const raw = execSync(cmd, { encoding: 'utf8' }).trim();
        if (!raw) return '';
        return raw.split('\n').filter(line =>
            !line.match(/\.env(\.\w+)?$/) &&
            !line.match(/test-results\//)
        ).join('\n').trim();
    } catch (e) {
        return '';
    }
}

/**
 * Get raw porcelain git status for specific paths (no .env filtering).
 * Used for checking whether agent/config files have changed (e.g. install-agent).
 * @param {string} [paths] - Space-separated paths to check (e.g. 'docs/ AGENTS.md')
 * @param {object} [opts] - Additional execSync options
 * @returns {string} Raw porcelain status, or '' if clean/error
 */
function getStatusRaw(paths, opts) {
    try {
        const pathStr = paths ? ` ${paths}` : '';
        return execSync(`git status --porcelain${pathStr} 2>/dev/null`, { encoding: 'utf8', ...opts }).trim();
    } catch (e) {
        return '';
    }
}

/**
 * Get current branch name.
 * @param {string} [cwd] - Optional working directory
 * @returns {string} Branch name, or '' if not in a repo or detached HEAD
 */
function getCurrentBranch(cwd) {
    try {
        const cmd = cwd
            ? `git -C "${cwd}" branch --show-current`
            : 'git branch --show-current';
        return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch (e) {
        return '';
    }
}

/**
 * Get current HEAD commit SHA.
 * @returns {string|null} Commit SHA, or null if not in a repo or no commits
 */
function getCurrentHead(cwd) {
    try {
        const cmd = cwd
            ? `git -C "${cwd}" rev-parse HEAD`
            : 'git rev-parse HEAD';
        return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch (e) {
        return null;
    }
}

/**
 * Detect the default branch (main or master) by checking the remote HEAD,
 * then verifying the branch exists locally.
 * @returns {string} 'main' or 'master' (or whatever the remote default is)
 */
function getDefaultBranch() {
    let defaultBranch;
    try {
        defaultBranch = execSync(
            'git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/heads/main',
            { encoding: 'utf8' }
        ).trim()
            .replace('refs/remotes/origin/', '')
            .replace('refs/heads/', '');
    } catch (e) {
        defaultBranch = 'main';
    }
    try {
        execSync(`git rev-parse --verify ${defaultBranch}`, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        defaultBranch = 'master';
    }
    return defaultBranch;
}

/**
 * Assert that the current branch is the default branch (main/master).
 * Throws if on a feature/worktree branch. Call at the top of commands
 * that commit to main (create, prioritise, start, close, etc.).
 * @throws {Error} If not on the default branch
 */
function assertOnDefaultBranch() {
    const current = getCurrentBranch();
    const defaultBranch = getDefaultBranch();
    if (current !== defaultBranch) {
        throw new Error(
            `Must be on '${defaultBranch}' branch to run this command. Currently on: '${current}'.\n` +
            `   Run: git checkout ${defaultBranch}`
        );
    }
}

/**
 * Check whether a branch exists locally.
 * @param {string} branchName
 * @returns {boolean}
 */
function branchExists(branchName) {
    try {
        execSync(`git rev-parse --verify ${branchName}`, { encoding: 'utf8', stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * List all branches (local).
 * @returns {string[]} Array of branch names (current branch marker stripped)
 */
function listBranches() {
    try {
        const output = execSync('git branch --list', { encoding: 'utf8' });
        return output.split('\n').map(b => b.trim().replace(/^[*+]\s+/, '')).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/**
 * Get the git common directory path.
 * Returns an absolute path when inside a worktree, or a relative '.git' in the main repo.
 * @param {string} [cwd] - Optional working directory
 * @returns {string|null}
 */
function getCommonDir(cwd) {
    try {
        const options = { stdio: 'pipe' };
        if (cwd) options.cwd = cwd;
        return execSync('git rev-parse --git-common-dir', options).toString().trim();
    } catch (e) {
        return null;
    }
}

/**
 * List all worktree paths (excludes the current working directory).
 * Returns raw path strings for callers that need to apply their own filtering.
 * @returns {string[]} Array of absolute worktree paths
 */
function listWorktreePaths() {
    const paths = [];
    try {
        const wtOutput = execSync('git worktree list', { encoding: 'utf8' });
        wtOutput.split('\n').forEach(line => {
            const wtMatch = line.match(/^([^\s]+)\s+/);
            if (!wtMatch) return;
            const wtPath = wtMatch[1];
            if (wtPath === process.cwd()) return;
            paths.push(wtPath);
        });
    } catch (e) {
        // Not in a git repo or no worktrees
    }
    return paths;
}

/**
 * List all feature worktrees (excludes the main/current worktree).
 * Equivalent to the old findWorktrees() in utils.js.
 * @param {string} [cwd] - Repo or worktree path to resolve "current" checkout (defaults to process.cwd())
 * @returns {Array<{path: string, featureId: string, agent: string, desc: string, mtime: Date}>}
 */
function listWorktrees(cwd = process.cwd()) {
    const worktrees = [];
    try {
        const wtOutput = execSync('git worktree list', { encoding: 'utf8', cwd });
        wtOutput.split('\n').forEach(line => {
            const wtMatch = line.match(/^([^\s]+)\s+/);
            if (!wtMatch) return;
            const wtPath = wtMatch[1];
            if (wtPath === path.resolve(cwd)) return;

            const featureMatch = path.basename(wtPath).match(/^feature-(\d+)-(\w+)-(.+)$/);
            if (featureMatch) {
                worktrees.push({
                    path: wtPath,
                    featureId: featureMatch[1],
                    agent: featureMatch[2],
                    desc: featureMatch[3],
                    mtime: fs.existsSync(wtPath) ? fs.statSync(wtPath).mtime : new Date(0)
                });
            }
        });
    } catch (e) {
        // Not in a git repo or no worktrees
    }
    return worktrees;
}

/**
 * Filter worktrees by feature ID, handling padded/unpadded comparison.
 * Equivalent to the old filterByFeatureId() in utils.js.
 * @param {Array} worktrees - Result from listWorktrees()
 * @param {string|number} featureId
 * @returns {Array}
 */
function filterWorktreesByFeature(worktrees, featureId) {
    const paddedId = String(featureId).padStart(2, '0');
    const unpaddedId = String(parseInt(featureId, 10));
    return worktrees.filter(wt =>
        wt.featureId === paddedId || wt.featureId === unpaddedId
    );
}

/**
 * Get files changed between two commits.
 * @param {string} fromSha
 * @param {string} toSha
 * @returns {string[]}
 */
function getChangedFiles(fromSha, toSha) {
    if (!fromSha || !toSha || fromSha === toSha) return [];
    try {
        const output = execSync(`git diff --name-only ${fromSha}..${toSha}`, { encoding: 'utf8' }).trim();
        if (!output) return [];
        return output.split('\n').map(line => line.trim()).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/**
 * Get commit summaries (short hash + subject) between two commits.
 * @param {string} fromSha
 * @param {string} toSha
 * @returns {string[]}
 */
function getCommitSummaries(fromSha, toSha) {
    if (!fromSha || !toSha || fromSha === toSha) return [];
    try {
        const output = execSync(`git log --format=%h\\ %s --reverse ${fromSha}..${toSha}`, { encoding: 'utf8' }).trim();
        if (!output) return [];
        return output.split('\n').map(line => line.trim()).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/**
 * Get a diff for context (recent committed changes, or staged changes as fallback).
 * Tries HEAD~1..HEAD first, then --cached, then returns ''.
 * @param {number} [maxLength] - Truncate at this many characters (default 5000)
 * @returns {string}
 */
function getRecentDiff(maxLength) {
    const limit = maxLength || 5000;
    try {
        const out = execSync(
            'git diff HEAD~1 HEAD 2>/dev/null || git diff --cached 2>/dev/null || echo ""',
            { encoding: 'utf8', timeout: 10000 }
        );
        return out.slice(0, limit);
    } catch (e) {
        return '';
    }
}

/**
 * Commit all dirty files with a given message, if there are any uncommitted changes.
 * Generic version of the old ensureRalphCommit() from validation.js.
 * @param {string} message - Commit message
 * @returns {{ ok: boolean, committed: boolean, autoCommitted: boolean, message: string }}
 */
function ensureCommit(message) {
    const statusBefore = getStatus();
    if (!statusBefore) {
        return {
            ok: true,
            committed: false,
            autoCommitted: false,
            message: 'No uncommitted changes.'
        };
    }

    const addResult = spawnSync('git', ['add', '-A'], { stdio: 'inherit' });
    if (addResult.error || addResult.status !== 0) {
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: addResult.error ? addResult.error.message : `git add failed with status ${addResult.status}`
        };
    }

    const commitResult = spawnSync('git', ['commit', '-m', message], { stdio: 'inherit' });
    if (commitResult.error) {
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: commitResult.error.message
        };
    }
    if (commitResult.status !== 0) {
        const remaining = getStatus();
        if (!remaining) {
            return {
                ok: true,
                committed: false,
                autoCommitted: false,
                message: 'No additional commit needed.'
            };
        }
        return {
            ok: false,
            committed: false,
            autoCommitted: false,
            message: `git commit failed with status ${commitResult.status}`
        };
    }

    return {
        ok: true,
        committed: true,
        autoCommitted: true,
        message: `Auto-committed: ${message}`
    };
}

/**
 * Detect if the current directory is a feature worktree and return its feature ID.
 * Returns null if not in a worktree or not a feature worktree.
 * @returns {{ featureId: string, agentId: string } | null}
 */
function detectWorktreeFeature() {
    const dirName = path.basename(process.cwd());
    const match = dirName.match(/^feature-(\d+)-([a-z]{2})-.+$/);
    if (match) return { featureId: match[1], agentId: match[2] };
    return null;
}

/**
 * Get the main repo path. If in a worktree, resolves the parent repo via git-common-dir.
 * If not in a worktree, returns process.cwd().
 * @param {string} [cwd] - Optional working directory
 * @returns {string} Absolute path to the main repo
 */
function getMainRepoPath(cwd) {
    const commonDir = getCommonDir(cwd);
    if (!commonDir) return cwd || process.cwd();
    // In a worktree, commonDir is absolute (e.g. /path/to/repo/.git).
    // From a non-worktree subdirectory, git returns a relative path (".git" or "../.git")
    // which must be resolved against cwd before dirname'ing — otherwise the main repo
    // path silently becomes the subdirectory and every spec/snapshot lookup fails.
    const base = cwd || process.cwd();
    const absCommonDir = path.isAbsolute(commonDir)
        ? commonDir
        : path.resolve(base, commonDir);
    return path.dirname(absCommonDir);
}

/**
 * Check if the current directory is inside a git worktree (not the main repo).
 * @param {string} [cwd] - Optional working directory
 * @returns {boolean}
 */
function isInsideWorktree(cwd) {
    const commonDir = getCommonDir(cwd);
    return !!(commonDir && path.isAbsolute(commonDir));
}

/**
 * Check if the current worktree context conflicts with the given feature ID.
 * Returns a warning message if in a worktree for a different feature, null otherwise.
 * @param {string} targetFeatureId - The feature ID the command wants to operate on
 * @returns {string|null} Warning message or null if no conflict
 */
function checkWorktreeScope(targetFeatureId) {
    const wt = detectWorktreeFeature();
    if (!wt) return null; // Not in a worktree — no conflict
    const targetUnpadded = String(parseInt(targetFeatureId, 10));
    const wtUnpadded = String(parseInt(wt.featureId, 10));
    if (targetUnpadded === wtUnpadded) return null; // Same feature — no conflict
    return `You are in a worktree for feature ${wt.featureId} but trying to operate on feature ${targetFeatureId}. Switch to the main repo or the correct worktree.`;
}

function _shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function _runGitRead(command, cwd) {
    const options = { encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 };
    if (cwd) options.cwd = cwd;
    return execSync(command, options).trim();
}

function _normalizeCommitRange(options = {}) {
    if (typeof options === 'string') {
        return options.trim();
    }
    if (options.range) return String(options.range).trim();
    if (options.fromRef && options.toRef) return `${options.fromRef}..${options.toRef}`;
    if (options.baseRef && options.targetRef) return `${options.baseRef}..${options.targetRef}`;
    if (options.baseRef) return `${options.baseRef}..HEAD`;
    return 'HEAD';
}

function _parseAgentIdFromEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const normalized = email.trim().toLowerCase();
    if (!AI_AGENT_EMAIL_RE.test(normalized)) return null;
    const local = normalized.split('@')[0];
    const base = local.split('+')[0];
    return LEGACY_EMAIL_AGENT_IDS.includes(base) ? base : null;
}

function _parseAgentIdFromAttributionValue(value) {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (ATTRIBUTION_AGENT_ID_SET.has(normalized)) return normalized;
    return _parseAgentIdFromEmail(normalized);
}

function _readCommitBody(sha, cwd) {
    try {
        return _runGitRead(`git show -s --format=%B ${_shellQuote(sha)}`, cwd);
    } catch (_) {
        return '';
    }
}

function _readCommitNote(sha, cwd, ref = AIGON_NOTES_REF) {
    try {
        return _runGitRead(`git notes --ref=${_shellQuote(ref)} show ${_shellQuote(sha)}`, cwd);
    } catch (_) {
        return '';
    }
}

function _parseMessageAttribution(body) {
    const out = {
        agentIds: new Set(),
        hasAgentIdTrailer: false,
        hasAgentCoAuthor: false,
        hasNonAgentCoAuthor: false,
    };
    if (!body) return out;

    const trailerRegex = /^Aigon-Agent-ID:\s*([a-z0-9_-]+)\s*$/gim;
    let match = null;
    while ((match = trailerRegex.exec(body)) !== null) {
        const id = _parseAgentIdFromAttributionValue(match[1]);
        if (id) out.agentIds.add(id);
        out.hasAgentIdTrailer = true;
    }

    const coAuthorRegex = /^Co-authored-by:\s*.+<([^>]+)>\s*$/gim;
    while ((match = coAuthorRegex.exec(body)) !== null) {
        const email = String(match[1] || '').trim().toLowerCase();
        const id = _parseAgentIdFromEmail(email);
        if (id) {
            out.agentIds.add(id);
            out.hasAgentCoAuthor = true;
        } else if (email) {
            out.hasNonAgentCoAuthor = true;
        }
    }
    return out;
}

function _parseNoteAttribution(note) {
    const out = {
        agentIds: new Set(),
        hasAttributionNote: false,
    };
    if (!note) return out;

    const lines = note.split('\n').map(line => line.trim()).filter(Boolean);
    lines.forEach(line => {
        const valueMatch = line.match(/^(?:aigon\.)?(?:agent_id|agent-id|agent)\s*[:=]\s*(.+)$/i);
        if (valueMatch) {
            const raw = valueMatch[1]
                .split(/[,\s]+/)
                .map(v => v.trim())
                .filter(Boolean);
            raw.forEach(candidate => {
                const parsed = _parseAgentIdFromAttributionValue(candidate);
                if (parsed) out.agentIds.add(parsed);
            });
            out.hasAttributionNote = true;
            return;
        }

        const authorshipMatch = line.match(/^(?:aigon\.)?authorship\s*[:=]\s*(.+)$/i);
        if (authorshipMatch) {
            const raw = String(authorshipMatch[1] || '').trim().toLowerCase();
            if (raw === 'ai-authored' || raw === 'ai' || raw === 'agent' || raw === 'aigon') {
                out.hasAttributionNote = true;
            }
        }
    });
    return out;
}

function _classifyCommitAttribution(commit, cwd, notesRef = AIGON_NOTES_REF) {
    const authorEmail = String(commit.authorEmail || '').trim().toLowerCase();
    const authorAgentId = _parseAgentIdFromEmail(authorEmail);
    const message = _readCommitBody(commit.sha, cwd);
    const note = _readCommitNote(commit.sha, cwd, notesRef);

    const messageSignals = _parseMessageAttribution(message);
    const noteSignals = _parseNoteAttribution(note);

    const agentIds = new Set();
    if (authorAgentId) agentIds.add(authorAgentId);
    messageSignals.agentIds.forEach(id => agentIds.add(id));
    noteSignals.agentIds.forEach(id => agentIds.add(id));

    const hasAISignal = !!authorAgentId ||
        messageSignals.hasAgentIdTrailer ||
        messageSignals.hasAgentCoAuthor ||
        noteSignals.hasAttributionNote ||
        agentIds.size > 0;

    const mixed = hasAISignal && messageSignals.hasNonAgentCoAuthor;

    let classification = 'human-authored';
    if (mixed) classification = 'mixed';
    else if (hasAISignal) classification = 'ai-authored';

    return {
        sha: commit.sha,
        authorName: commit.authorName || '',
        authorEmail,
        subject: commit.subject || '',
        classification,
        agent_ids: [...agentIds],
        signals: {
            author_agent_email: !!authorAgentId,
            trailer_agent_id: messageSignals.hasAgentIdTrailer,
            trailer_agent_coauthor: messageSignals.hasAgentCoAuthor,
            trailer_non_agent_coauthor: messageSignals.hasNonAgentCoAuthor,
            git_note: noteSignals.hasAttributionNote,
        },
    };
}

function _collectCommitSummariesForRange(range, cwd, pathspec) {
    const cmd = pathspec
        ? `git log --reverse --format=%H%x09%an%x09%ae%x09%s ${range} -- ${_shellQuote(pathspec)}`
        : `git log --reverse --format=%H%x09%an%x09%ae%x09%s ${range}`;
    const out = _runGitRead(cmd, cwd);
    if (!out) return [];
    return out
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [sha, authorName, authorEmail, ...subjectParts] = line.split('\t');
            return {
                sha: String(sha || '').trim(),
                authorName: String(authorName || '').trim(),
                authorEmail: String(authorEmail || '').trim(),
                subject: subjectParts.join('\t').trim(),
            };
        })
        .filter(c => c.sha);
}

function _aggregateAttributionCounts(classifiedCommits) {
    const counts = {
        'ai-authored': 0,
        'human-authored': 0,
        mixed: 0,
    };
    classifiedCommits.forEach(commit => {
        counts[commit.classification] = (counts[commit.classification] || 0) + 1;
    });
    return counts;
}

/**
 * Compute git signals for a feature branch/range.
 * Metrics are derived from git log + git diff against the base branch.
 * @param {object} options
 * @param {string} [options.baseRef] - Base branch/ref (defaults to detected default branch)
 * @param {string} [options.targetRef] - Target branch/ref (defaults to HEAD)
 * @param {number} [options.expectedScopeFiles] - Expected file count from spec scope heuristic
 * @param {string} [options.cwd] - Optional working directory
 * @returns {{
 *   commit_count:number, lines_added:number, lines_removed:number, lines_changed:number,
 *   files_touched:number, fix_commit_count:number, fix_commit_ratio:number,
 *   rework_thrashing:boolean, rework_fix_cascade:boolean, rework_scope_creep:boolean
 * }}
 */
function getFeatureGitSignals(options = {}) {
    const cwd = options.cwd;
    const targetRef = options.targetRef || 'HEAD';
    const baseRef = options.baseRef || getDefaultBranch();
    const expectedScopeFiles = Number.isFinite(options.expectedScopeFiles) && options.expectedScopeFiles > 0
        ? options.expectedScopeFiles
        : 10;

    const defaults = {
        commit_count: 0,
        lines_added: 0,
        lines_removed: 0,
        lines_changed: 0,
        files_touched: 0,
        fix_commit_count: 0,
        fix_commit_ratio: 0,
        rework_thrashing: false,
        rework_fix_cascade: false,
        rework_scope_creep: false,
    };

    try {
        _runGitRead(`git rev-parse --verify ${_shellQuote(baseRef)}`, cwd);
        _runGitRead(`git rev-parse --verify ${_shellQuote(targetRef)}`, cwd);
    } catch (_) {
        return defaults;
    }

    let range = `${baseRef}..${targetRef}`;
    try {
        const mergeBase = _runGitRead(`git merge-base ${_shellQuote(baseRef)} ${_shellQuote(targetRef)}`, cwd);
        if (mergeBase) range = `${mergeBase}..${targetRef}`;
    } catch (_) {
        // Fall back to base..target when merge-base is unavailable.
    }

    let commitSubjects = [];
    try {
        const out = _runGitRead(`git log --format=%s --reverse ${range}`, cwd);
        commitSubjects = out ? out.split('\n').map(line => line.trim()).filter(Boolean) : [];
    } catch (_) {}

    const fixRegex = /^(fix|fixup|bugfix)\b/i;
    const hasFixTagRegex = /fix:/i;
    const isFixCommit = (subject) => fixRegex.test(subject) || hasFixTagRegex.test(subject);

    const commitCount = commitSubjects.length;
    const fixCommitCount = commitSubjects.filter(isFixCommit).length;
    const fixCommitRatio = commitCount > 0
        ? Math.round((fixCommitCount / commitCount) * 1000) / 1000
        : 0;

    // Detect 3+ consecutive fix commits.
    let maxFixStreak = 0;
    let currentFixStreak = 0;
    commitSubjects.forEach(subject => {
        if (isFixCommit(subject)) {
            currentFixStreak += 1;
            if (currentFixStreak > maxFixStreak) maxFixStreak = currentFixStreak;
        } else {
            currentFixStreak = 0;
        }
    });

    let linesAdded = 0;
    let linesRemoved = 0;
    const filesTouched = new Set();
    try {
        const numstat = _runGitRead(`git diff --numstat ${range}`, cwd);
        numstat.split('\n').forEach(line => {
            if (!line.trim()) return;
            const parts = line.split('\t');
            if (parts.length < 3) return;
            const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
            const removed = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
            linesAdded += added;
            linesRemoved += removed;
            filesTouched.add(parts.slice(2).join('\t').trim());
        });
    } catch (_) {}

    // Detect thrashing: any file touched in 5+ commits in this range.
    const fileCommitCounts = new Map();
    try {
        const out = _runGitRead(`git log --name-only --format=__COMMIT__%H ${range}`, cwd);
        const lines = out ? out.split('\n') : [];
        let currentFiles = new Set();
        const flushCommit = () => {
            if (currentFiles.size === 0) return;
            currentFiles.forEach(file => {
                fileCommitCounts.set(file, (fileCommitCounts.get(file) || 0) + 1);
            });
            currentFiles = new Set();
        };
        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            if (trimmed.startsWith('__COMMIT__')) {
                flushCommit();
                return;
            }
            currentFiles.add(trimmed);
        });
        flushCommit();
    } catch (_) {}
    const thrashing = [...fileCommitCounts.values()].some(count => count >= 5);

    const filesTouchedCount = filesTouched.size;
    return {
        commit_count: commitCount,
        lines_added: linesAdded,
        lines_removed: linesRemoved,
        lines_changed: linesAdded + linesRemoved,
        files_touched: filesTouchedCount,
        fix_commit_count: fixCommitCount,
        fix_commit_ratio: fixCommitRatio,
        rework_thrashing: thrashing,
        rework_fix_cascade: maxFixStreak >= 3,
        rework_scope_creep: filesTouchedCount > (expectedScopeFiles * 2),
    };
}

/**
 * Classify commits in a git range as ai-authored, human-authored, or mixed.
 * AI signals come from Aigon trailers, Aigon git notes, or legacy agent
 * author emails for historical commits.
 * @param {object|string} [options]
 * @param {string} [options.range] - Explicit git range (e.g. 'main..HEAD')
 * @param {string} [options.fromRef] - Start ref for range (requires toRef)
 * @param {string} [options.toRef] - End ref for range (requires fromRef)
 * @param {string} [options.baseRef] - Base ref fallback (defaults to HEAD when omitted)
 * @param {string} [options.targetRef] - Target ref fallback
 * @param {string} [options.cwd] - Optional working directory
 * @param {string} [options.notesRef='aigon-attribution'] - Notes ref to inspect
 * @returns {{
 *   range:string,
 *   classification:string,
 *   counts:{'ai-authored':number,'human-authored':number,mixed:number},
 *   commits:Array<object>
 * }}
 */
function classifyCommitAttributionRange(options = {}) {
    const cwd = options.cwd;
    const notesRef = options.notesRef || AIGON_NOTES_REF;
    const range = _normalizeCommitRange(options);
    let commits = [];
    try {
        commits = _collectCommitSummariesForRange(range, cwd, options.path);
    } catch (_) {
        return {
            range,
            classification: 'human-authored',
            counts: { 'ai-authored': 0, 'human-authored': 0, mixed: 0 },
            commits: [],
        };
    }

    const classifiedCommits = commits.map(commit => _classifyCommitAttribution(commit, cwd, notesRef));
    const counts = _aggregateAttributionCounts(classifiedCommits);

    let classification = 'human-authored';
    if (counts.mixed > 0 || (counts['ai-authored'] > 0 && counts['human-authored'] > 0)) {
        classification = 'mixed';
    } else if (counts['ai-authored'] > 0) {
        classification = 'ai-authored';
    }

    return {
        range,
        classification,
        counts,
        commits: classifiedCommits,
    };
}

/**
 * Compute line-level attribution for a file by combining git blame with commit attribution.
 * @param {object} options
 * @param {string} options.filePath - File path relative to repo root/cwd
 * @param {string} [options.ref='HEAD'] - Ref to blame
 * @param {string} [options.cwd] - Optional working directory
 * @param {string} [options.notesRef='aigon-attribution'] - Notes ref to inspect
 * @returns {{
 *   file:string,
 *   ref:string,
 *   total_lines:number,
 *   line_counts:{'ai-authored':number,'human-authored':number,mixed:number},
 *   commits:Array<object>
 * }}
 */
function getFileLineAttribution(options = {}) {
    const filePath = options.filePath;
    const ref = options.ref || 'HEAD';
    const cwd = options.cwd;
    const notesRef = options.notesRef || AIGON_NOTES_REF;
    if (!filePath) {
        return {
            file: '',
            ref,
            total_lines: 0,
            line_counts: { 'ai-authored': 0, 'human-authored': 0, mixed: 0 },
            commits: [],
        };
    }

    let blameOutput = '';
    try {
        blameOutput = _runGitRead(`git blame --line-porcelain ${_shellQuote(ref)} -- ${_shellQuote(filePath)}`, cwd);
    } catch (_) {
        return {
            file: filePath,
            ref,
            total_lines: 0,
            line_counts: { 'ai-authored': 0, 'human-authored': 0, mixed: 0 },
            commits: [],
        };
    }

    const lineCountsBySha = new Map();
    const headerRegex = /^([0-9a-f]{40})\s+\d+\s+\d+\s+(\d+)$/;
    blameOutput.split('\n').forEach(line => {
        const m = line.match(headerRegex);
        if (!m) return;
        const sha = m[1];
        const count = parseInt(m[2], 10) || 0;
        lineCountsBySha.set(sha, (lineCountsBySha.get(sha) || 0) + count);
    });

    const commits = [];
    lineCountsBySha.forEach((lineCount, sha) => {
        let summary = null;
        try {
            const out = _runGitRead(`git show -s --format=%H%x09%an%x09%ae%x09%s ${_shellQuote(sha)}`, cwd);
            if (out) {
                const [s, authorName, authorEmail, ...subjectParts] = out.split('\t');
                summary = {
                    sha: s,
                    authorName: authorName || '',
                    authorEmail: authorEmail || '',
                    subject: subjectParts.join('\t').trim(),
                };
            }
        } catch (_) {}
        if (!summary) {
            summary = { sha, authorName: '', authorEmail: '', subject: '' };
        }
        const classified = _classifyCommitAttribution(summary, cwd, notesRef);
        commits.push({
            ...classified,
            line_count: lineCount,
        });
    });

    const lineCounts = {
        'ai-authored': 0,
        'human-authored': 0,
        mixed: 0,
    };
    commits.forEach(commit => {
        lineCounts[commit.classification] = (lineCounts[commit.classification] || 0) + commit.line_count;
    });

    const totalLines = commits.reduce((sum, commit) => sum + commit.line_count, 0);
    return {
        file: filePath,
        ref,
        total_lines: totalLines,
        line_counts: lineCounts,
        commits: commits.sort((a, b) => b.line_count - a.line_count),
    };
}

// ---------------------------------------------------------------------------
// Commit analytics
// ---------------------------------------------------------------------------

function _getCommitCachePath(cwd) {
    const root = cwd ? path.resolve(cwd) : process.cwd();
    return path.join(root, COMMIT_CACHE_RELATIVE_PATH);
}

function _readCommitCache(cwd) {
    try {
        const cachePath = _getCommitCachePath(cwd);
        if (!fs.existsSync(cachePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function _writeCommitCache(cwd, payload) {
    try {
        const cachePath = _getCommitCachePath(cwd);
        const dir = path.dirname(cachePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_) {
        // cache writes must never break command flow
    }
}

function _parseFeatureAttributionFromRef(refText) {
    if (!refText) return { featureId: null, agent: null };
    const normalized = String(refText).trim();
    const match = normalized.match(/feature-(\d+)-([a-z0-9-]+)/i);
    if (!match) return { featureId: null, agent: null };
    const featureId = String(parseInt(match[1], 10));
    const remainder = match[2];
    const firstSegment = remainder.split('-')[0].toLowerCase();
    const agent = KNOWN_AGENT_IDS.has(firstSegment) ? firstSegment : null;
    return { featureId, agent };
}

function _extractAttribution(commit, cwd) {
    const refs = [];
    const pushRef = (value) => {
        if (!value) return;
        String(value)
            .split(',')
            .map(v => v.replace(/^HEAD\s*->\s*/, '').trim())
            .filter(Boolean)
            .forEach(v => refs.push(v));
    };
    pushRef(commit.refs);
    pushRef(commit.sourceRef);

    let featureId = null;
    let agent = null;
    refs.forEach(ref => {
        const parsed = _parseFeatureAttributionFromRef(ref);
        if (!featureId && parsed.featureId) featureId = parsed.featureId;
        if (!agent && parsed.agent) agent = parsed.agent;
    });

    // Secondary attribution: merge commit message references a feature branch.
    if (!featureId) {
        const msgMatch = String(commit.message || '').match(/feature-(\d+)-/i);
        if (msgMatch) featureId = String(parseInt(msgMatch[1], 10));
    }

    // Co-authored-by trailer fallback for agent attribution.
    if (!agent && commit.body) {
        const coAuthorRegex = /^Co-authored-by:\s+(.+)$/gim;
        let m;
        while ((m = coAuthorRegex.exec(commit.body)) !== null) {
            const line = (m[1] || '').toLowerCase();
            const tokenMatch = line.match(/\b(cc|gg|cx|cu)\b/);
            if (tokenMatch) {
                agent = tokenMatch[1];
                break;
            }
        }
    }

    if (!agent && commit.sha) {
        try {
            const note = _readCommitNote(commit.sha, cwd);
            const parsedNote = _parseNoteAttribution(note);
            if (parsedNote.agentIds.size > 0) {
                agent = [...parsedNote.agentIds][0];
            }
        } catch (_) {}
    }

    return { featureId: featureId || null, agent: agent || null };
}

function _parseCommitBodiesByHash(cwd) {
    const out = _runGitRead('git log --all --format=%H%x1f%B%x1e', cwd);
    if (!out) return {};
    const byHash = {};
    out.split('\x1e').forEach(block => {
        const trimmed = block.trim();
        if (!trimmed) return;
        const sep = trimmed.indexOf('\x1f');
        if (sep === -1) return;
        const hash = trimmed.slice(0, sep).trim();
        const body = trimmed.slice(sep + 1).trim();
        if (hash) byHash[hash] = body;
    });
    return byHash;
}

function _collectCommitHistory(cwd) {
    const out = _runGitRead('git log --all --date=iso-strict --decorate=full --source --format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1f%S --numstat', cwd);
    if (!out) return [];
    const bodyByHash = _parseCommitBodiesByHash(cwd);

    const commits = [];
    const lines = out.split('\n');
    let current = null;

    const pushCurrent = () => {
        if (!current) return;
        const attribution = _extractAttribution(current, cwd);
        commits.push({
            hash: current.hash,
            author: current.author,
            authorEmail: current.authorEmail,
            date: current.date,
            message: current.message,
            filesChanged: current.filesChanged,
            linesAdded: current.linesAdded,
            linesRemoved: current.linesRemoved,
            featureId: attribution.featureId,
            agent: attribution.agent,
            refs: current.refs || '',
            sourceRef: current.sourceRef || '',
        });
    };

    lines.forEach(rawLine => {
        const line = rawLine || '';
        const header = line.split('\x1f');
        if (header.length >= 7 && /^[0-9a-f]{7,40}$/i.test(header[0])) {
            pushCurrent();
            const hash = header[0];
            current = {
                hash,
                author: header[1] || '',
                authorEmail: header[2] || '',
                date: header[3] || '',
                message: header[4] || '',
                refs: header[5] || '',
                sourceRef: header[6] || '',
                body: bodyByHash[hash] || '',
                filesChanged: 0,
                linesAdded: 0,
                linesRemoved: 0,
            };
            return;
        }
        if (!current) return;
        const parts = line.split('\t');
        if (parts.length < 3) return;
        current.filesChanged += 1;
        const added = parts[0] === '-' ? 0 : (parseInt(parts[0], 10) || 0);
        const removed = parts[1] === '-' ? 0 : (parseInt(parts[1], 10) || 0);
        current.linesAdded += added;
        current.linesRemoved += removed;
    });
    pushCurrent();
    return commits;
}

function getCommitAnalytics(options = {}) {
    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const forceRefresh = !!options.forceRefresh;
    const head = getCurrentHead(cwd);
    if (!head) {
        return {
            generatedAt: new Date().toISOString(),
            lastParsedCommit: null,
            head: null,
            commits: [],
        };
    }

    const cached = _readCommitCache(cwd);
    if (!forceRefresh && cached && cached.head === head && Array.isArray(cached.commits)) {
        return cached;
    }

    const commits = _collectCommitHistory(cwd);
    const payload = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        head,
        lastParsedCommit: head,
        commits,
    };
    _writeCommitCache(cwd, payload);
    return payload;
}

function _toDayStartTs(value) {
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return null;
    const day = new Date(ts);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
}

function filterCommitAnalytics(commits, filters = {}) {
    const list = Array.isArray(commits) ? commits : [];
    const fromTs = filters.from ? new Date(filters.from).getTime() : null;
    const toTsRaw = filters.to ? new Date(filters.to).getTime() : null;
    const toTs = Number.isFinite(toTsRaw) ? (toTsRaw + 24 * 60 * 60 * 1000 - 1) : null;
    const periodDays = Number.isFinite(filters.periodDays) ? filters.periodDays : null;
    const sinceTs = periodDays ? (Date.now() - periodDays * 24 * 60 * 60 * 1000) : null;
    const feature = filters.feature !== undefined && filters.feature !== null
        ? String(parseInt(filters.feature, 10))
        : null;
    const agent = filters.agent ? String(filters.agent).toLowerCase() : null;

    return list.filter(commit => {
        const ts = new Date(commit.date || '').getTime();
        if (!Number.isFinite(ts)) return false;
        if (Number.isFinite(fromTs) && ts < fromTs) return false;
        if (Number.isFinite(toTs) && ts > toTs) return false;
        if (Number.isFinite(sinceTs) && ts < sinceTs) return false;
        if (feature && String(commit.featureId || '') !== feature) return false;
        if (agent && String(commit.agent || '').toLowerCase() !== agent) return false;
        return true;
    });
}

function buildCommitAnalyticsSummary(commits) {
    const list = Array.isArray(commits) ? commits : [];
    const byFeature = {};
    const byAgent = {};
    let unattributed = 0;
    let linesAdded = 0;
    let linesRemoved = 0;
    let filesChanged = 0;

    list.forEach(commit => {
        const featureId = commit.featureId || null;
        const agent = commit.agent || null;
        if (!featureId) unattributed += 1;
        if (featureId) byFeature[featureId] = (byFeature[featureId] || 0) + 1;
        if (agent) byAgent[agent] = (byAgent[agent] || 0) + 1;
        linesAdded += Number(commit.linesAdded || 0);
        linesRemoved += Number(commit.linesRemoved || 0);
        filesChanged += Number(commit.filesChanged || 0);
    });

    return {
        total: list.length,
        attributed: list.length - unattributed,
        byFeature,
        byAgent,
        unattributed,
        filesChanged,
        linesAdded,
        linesRemoved,
    };
}

function buildCommitSeries(commits) {
    const list = Array.isArray(commits) ? commits : [];
    const daily = {};
    const weekly = {};
    const monthly = {};

    const weekKey = (date) => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() - day + 1);
        return d.toISOString().slice(0, 10);
    };

    list.forEach(commit => {
        const ts = _toDayStartTs(commit.date);
        if (!Number.isFinite(ts)) return;
        const d = new Date(ts);
        const day = d.toISOString().slice(0, 10);
        const week = weekKey(d);
        const month = d.toISOString().slice(0, 7);
        const isFeature = !!commit.featureId;
        if (!daily[day]) daily[day] = { count: 0, feature: 0, nonFeature: 0 };
        daily[day].count++; daily[day][isFeature ? 'feature' : 'nonFeature']++;
        if (!weekly[week]) weekly[week] = { count: 0, feature: 0, nonFeature: 0 };
        weekly[week].count++; weekly[week][isFeature ? 'feature' : 'nonFeature']++;
        if (!monthly[month]) monthly[month] = { count: 0, feature: 0, nonFeature: 0 };
        monthly[month].count++; monthly[month][isFeature ? 'feature' : 'nonFeature']++;
    });

    const toSortedArray = (obj, keyName) => Object.entries(obj)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => ({ [keyName]: key, ...val }));

    return {
        daily: toSortedArray(daily, 'date'),
        weekly: toSortedArray(weekly, 'week'),
        monthly: toSortedArray(monthly, 'month'),
    };
}

module.exports = {
    getRecentDiff,
    listWorktreePaths,
    run,
    runGit: run,
    getStatus,
    getStatusRaw,
    getCurrentBranch,
    getCurrentHead,
    getDefaultBranch,
    assertOnDefaultBranch,
    branchExists,
    listBranches,
    getCommonDir,
    listWorktrees,
    filterWorktreesByFeature,
    getChangedFiles,
    getCommitSummaries,
    ensureCommit,
    detectWorktreeFeature,
    checkWorktreeScope,
    getMainRepoPath,
    isInsideWorktree,
    getFeatureGitSignals,
    classifyCommitAttributionRange,
    getFileLineAttribution,
    getCommitAnalytics,
    filterCommitAnalytics,
    buildCommitAnalyticsSummary,
    buildCommitSeries,
};
