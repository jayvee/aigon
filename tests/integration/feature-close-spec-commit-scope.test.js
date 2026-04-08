#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const close = require('../../lib/feature-close');

const FEATURE_FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function runGit(repoPath, cmd) {
    return execSync(cmd, { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' });
}

function findFile(typeConfig, id, searchFolders = typeConfig.folders) {
    const prefix = `feature-${id}-`;
    for (const folder of searchFolders) {
        const dir = path.join(typeConfig.root, folder);
        if (!fs.existsSync(dir)) continue;
        const match = fs.readdirSync(dir).find((name) => name.startsWith(prefix) && name.endsWith('.md'));
        if (match) return { fullPath: path.join(dir, match), folder, file: match };
    }
    return null;
}

function stagePaths(runGitFn, repoPath, paths) {
    const unique = [...new Set((paths || []).filter(Boolean))];
    if (unique.length === 0) return;
    const quoted = unique.map((p) => JSON.stringify(path.relative(repoPath, p))).join(' ');
    runGitFn(`git add -- ${quoted}`);
}

testAsync('commitSpecMove leaves unrelated staged files out of the spec-move commit', () => withTempDirAsync('aigon-close-scope-', async (repo) => {
    fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', '03-in-progress'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', '05-done'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'app'), { recursive: true });

    runGit(repo, 'git init -b main');
    runGit(repo, 'git config user.name "Aigon Test"');
    runGit(repo, 'git config user.email "test@example.com"');

    const inProgressSpec = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-35-demo.md');
    const doneSpec = path.join(repo, 'docs', 'specs', 'features', '05-done', 'feature-35-demo.md');
    const manifestPath = path.join(repo, 'app', 'manifest.yml');

    fs.writeFileSync(inProgressSpec, '# Feature 35\n');
    fs.writeFileSync(manifestPath, 'modules:\n  - llm\n');
    runGit(repo, 'git add .');
    runGit(repo, 'git commit -m "init"');

    fs.renameSync(inProgressSpec, doneSpec);
    fs.writeFileSync(manifestPath, 'modules:\n');
    runGit(repo, 'git add app/manifest.yml');

    close.commitSpecMove(
        { num: '35', desc: 'demo', repoPath: repo },
        { changedDependencyIds: [] },
        {
            PATHS: {
                features: {
                    root: path.join(repo, 'docs', 'specs', 'features'),
                    folders: FEATURE_FOLDERS,
                },
            },
            findFile,
            runGit: (cmd) => runGit(repo, cmd),
            stagePaths,
        }
    );

    const changedFiles = runGit(repo, 'git show --name-status --pretty=format: HEAD').trim().split('\n').filter(Boolean);
    const status = runGit(repo, 'git status --short');

    assert.ok(changedFiles.some((line) => line.includes('docs/specs/features/05-done/feature-35-demo.md')), 'spec move should be committed');
    assert.ok(changedFiles.some((line) => line.includes('docs/specs/features/03-in-progress/feature-35-demo.md')), 'spec removal should be committed');
    assert.ok(!changedFiles.some((line) => line.includes('app/manifest.yml')), 'unrelated staged file must not be included in spec-move commit');
    assert.match(status, /^ M app\/manifest\.yml$/m, 'unrelated app change should remain unstaged in the working tree');
}));

report();
