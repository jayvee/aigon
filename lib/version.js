'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ROOT_DIR } = require('./config');

const VERSION_FILE = '.aigon/version';

function getAigonVersion() {
    const pkgPath = path.join(ROOT_DIR, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version;
    }
    return null;
}

function getInstalledVersion() {
    const versionPath = path.join(process.cwd(), VERSION_FILE);
    if (fs.existsSync(versionPath)) {
        return fs.readFileSync(versionPath, 'utf8').trim();
    }
    return null;
}

function setInstalledVersion(version) {
    // Skip in worktrees — only the main repo tracks installed version.
    // Writing it in worktrees causes merge conflicts when feature-close merges back.
    const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
    if (fs.existsSync(worktreeMarker)) return;
    const versionPath = path.join(process.cwd(), VERSION_FILE);
    const dir = path.dirname(versionPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(versionPath, version);
}

function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

function getChangelogEntriesSince(fromVersion) {
    const changelogPath = path.join(ROOT_DIR, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) {
        return [];
    }

    const content = fs.readFileSync(changelogPath, 'utf8');
    const entries = [];

    // Split by version headers: ## [x.y.z]
    const versionPattern = /^## \[(\d+\.\d+\.\d+)\]/gm;
    const sections = content.split(versionPattern);

    // sections alternates: [preamble, version1, content1, version2, content2, ...]
    for (let i = 1; i < sections.length; i += 2) {
        const version = sections[i];
        let body = sections[i + 1] || '';

        // Remove the date suffix (e.g., " - 2026-02-02") from the start of body
        body = body.replace(/^\s*-\s*\d{4}-\d{2}-\d{2}\s*/, '').trim();

        // Stop if we've reached fromVersion or older
        if (fromVersion && compareVersions(version, fromVersion) <= 0) {
            break;
        }

        entries.push({ version, body });
    }

    return entries;
}

let aigonCliOriginCheckCache = null;

function checkAigonCliOrigin() {
    if (aigonCliOriginCheckCache) {
        return aigonCliOriginCheckCache;
    }

    try {
        // Check if ROOT_DIR is a git repo with an origin remote
        try {
            execSync('git remote get-url origin', { cwd: ROOT_DIR, stdio: 'pipe' });
        } catch {
            aigonCliOriginCheckCache = { behind: 0, error: null };
            return aigonCliOriginCheckCache; // No remote — skip silently
        }

        // Fetch latest from origin (quiet, non-fatal)
        try {
            execSync('git fetch origin --quiet', { cwd: ROOT_DIR, stdio: 'pipe', timeout: 15000 });
        } catch (e) {
            aigonCliOriginCheckCache = { behind: 0, error: `Could not reach origin: ${e.message}` };
            return aigonCliOriginCheckCache;
        }

        // Detect default branch on remote
        let remoteBranch = 'origin/main';
        try {
            execSync('git rev-parse --verify origin/main', { cwd: ROOT_DIR, stdio: 'pipe' });
        } catch {
            try {
                execSync('git rev-parse --verify origin/master', { cwd: ROOT_DIR, stdio: 'pipe' });
                remoteBranch = 'origin/master';
            } catch {
                aigonCliOriginCheckCache = { behind: 0, error: null };
                return aigonCliOriginCheckCache;
            }
        }

        // Count commits behind
        const count = execSync(`git rev-list HEAD..${remoteBranch} --count`, {
            cwd: ROOT_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        aigonCliOriginCheckCache = { behind: parseInt(count, 10) || 0, error: null };
        return aigonCliOriginCheckCache;
    } catch (e) {
        aigonCliOriginCheckCache = { behind: 0, error: e.message };
        return aigonCliOriginCheckCache;
    }
}

function upgradeAigonCli() {
    console.log('🔄 CLI upgrade: pulling latest aigon from origin...');
    try {
        execSync('git pull origin main', { cwd: ROOT_DIR, stdio: 'inherit' });
    } catch {
        // Try master if main fails
        execSync('git pull origin master', { cwd: ROOT_DIR, stdio: 'inherit' });
    }
    console.log('📦 CLI upgrade: installing dependencies...');
    execSync('npm ci', { cwd: ROOT_DIR, stdio: 'inherit' });
    aigonCliOriginCheckCache = null;
    console.log('✅ CLI upgrade complete.\n');
}

module.exports = {
    VERSION_FILE,
    getAigonVersion,
    getInstalledVersion,
    setInstalledVersion,
    compareVersions,
    getChangelogEntriesSince,
    checkAigonCliOrigin,
    upgradeAigonCli,
};
