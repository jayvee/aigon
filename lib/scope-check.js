'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function canonicalId(featureId) {
    return String(parseInt(String(featureId), 10)).padStart(2, '0');
}

function getFileSnapshotPath(mainRepo, featureId) {
    return path.join(mainRepo, '.aigon', 'state', `feature-${canonicalId(featureId)}-file-snapshot.txt`);
}

function captureFileSnapshot(repoPath, featureId) {
    const snapshotPath = getFileSnapshotPath(repoPath, featureId);
    const result = spawnSync('git', ['ls-files'], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.error || result.status !== 0) {
        return { ok: false, error: (result.error || new Error('git ls-files failed')).message };
    }
    const stateDir = path.dirname(snapshotPath);
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(snapshotPath, result.stdout, 'utf8');
    const fileCount = result.stdout.trim().split('\n').filter(Boolean).length;
    return { ok: true, path: snapshotPath, fileCount };
}

function readFileSnapshot(mainRepo, featureId) {
    const snapshotPath = getFileSnapshotPath(mainRepo, featureId);
    if (!fs.existsSync(snapshotPath)) return null;
    const content = fs.readFileSync(snapshotPath, 'utf8');
    return new Set(content.trim().split('\n').filter(Boolean));
}

const SPEC_KANBAN_RE = /^docs\/specs\/features\/(01-inbox|02-backlog|03-in-progress|04-done)\//;
const TEST_FILE_RE = /\.(test|spec)\.(js|ts|jsx|tsx|mjs|cjs)$|\.spec\.[jt]sx?$/;

function checkScope(mainRepo, featureId, baseBranch) {
    const branch = baseBranch || 'main';
    const snapshot = readFileSnapshot(mainRepo, featureId);
    if (!snapshot) {
        return { ok: true, warnings: [], noSnapshot: true };
    }

    const result = spawnSync('git', ['diff', '--name-status', `${branch}...HEAD`], {
        cwd: mainRepo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.error || result.status !== 0) {
        return { ok: true, warnings: [], diffError: true };
    }

    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const warnings = [];
    let totalChanged = 0;
    const deletedFiles = [];
    const deletedTestFiles = [];
    const specMoveErrors = [];

    for (const line of lines) {
        const parts = line.split('\t');
        const statusCode = parts[0];
        totalChanged++;

        if (statusCode.startsWith('D')) {
            const filePath = parts[1];
            if (snapshot.has(filePath)) {
                if (TEST_FILE_RE.test(filePath)) {
                    deletedTestFiles.push(filePath);
                } else {
                    deletedFiles.push(filePath);
                }
            }
        } else if (statusCode.startsWith('R')) {
            const srcFile = parts[1];
            const dstFile = parts[2];
            if (srcFile && dstFile) {
                const srcMatch = SPEC_KANBAN_RE.exec(srcFile);
                const dstMatch = SPEC_KANBAN_RE.exec(dstFile);
                if (srcMatch && dstMatch && srcMatch[1] !== dstMatch[1]) {
                    specMoveErrors.push({ from: srcFile, to: dstFile });
                }
            }
        }
    }

    if (specMoveErrors.length > 0) {
        warnings.push({
            level: 'error',
            message: `Spec files moved between kanban folders (${specMoveErrors.length}). Only the CLI manages spec state transitions.`,
            files: specMoveErrors.map(m => `${m.from} → ${m.to}`),
        });
    }
    if (deletedTestFiles.length > 0) {
        warnings.push({
            level: 'warn',
            message: `Test files deleted that existed at feature-start time (${deletedTestFiles.length}). Verify this is intentional.`,
            files: deletedTestFiles,
        });
    }
    if (deletedFiles.length > 0) {
        warnings.push({
            level: 'warn',
            message: `Non-test files deleted that existed at feature-start time (${deletedFiles.length}).`,
            files: deletedFiles,
        });
    }
    if (totalChanged > 20) {
        warnings.push({
            level: 'info',
            message: `Large changeset: ${totalChanged} files changed. Review for out-of-scope edits.`,
            files: [],
        });
    }

    const hasErrors = warnings.some(w => w.level === 'error');
    const hasWarnings = warnings.some(w => w.level === 'warn');
    return { ok: !hasErrors, hasErrors, hasWarnings, warnings, totalChanged };
}

function printScopeWarnings(result) {
    if (!result.warnings || result.warnings.length === 0) return;
    console.log('\n📋 Scope check:');
    for (const w of result.warnings) {
        const icon = w.level === 'error' ? '❌' : w.level === 'warn' ? '⚠️ ' : 'ℹ️ ';
        console.log(`   ${icon} ${w.message}`);
        const shown = (w.files || []).slice(0, 10);
        for (const f of shown) {
            console.log(`      - ${f}`);
        }
        if (w.files && w.files.length > 10) {
            console.log(`      ... and ${w.files.length - 10} more`);
        }
    }
}

module.exports = {
    captureFileSnapshot,
    readFileSnapshot,
    checkScope,
    printScopeWarnings,
    getFileSnapshotPath,
};
