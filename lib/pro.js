'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

let pro = null;
let proResolvedPath = null;
let proLoadAttempted = false;
let proLoadError = null;

function tryRequireProFromGlobalRoot() {
    let globalRoot = '';
    try {
        globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (e) {
        proLoadError = e;
        return null;
    }
    if (!globalRoot) return null;
    const candidate = path.join(globalRoot, '@senlabsai', 'aigon-pro');
    try {
        proResolvedPath = require.resolve(candidate);
        return require(candidate);
    } catch (e) {
        proLoadError = e;
        return null;
    }
}

function loadPro() {
    if (pro) return pro;
    if (proLoadAttempted) return null;
    proLoadAttempted = true;

    try {
        proResolvedPath = require.resolve('@senlabsai/aigon-pro');
        pro = require('@senlabsai/aigon-pro');
        return pro;
    } catch (e) {
        proLoadError = e;
    }

    pro = tryRequireProFromGlobalRoot();
    return pro;
}

/**
 * Check if Pro is available, respecting the AIGON_FORCE_PRO environment override.
 *
 * Pro availability is a property of the **aigon install**, not of any individual
 * repo. The override therefore lives in an environment variable — naturally
 * global to a process tree, non-persistent, and test-friendly. It must NOT be
 * read from project config (`.aigon/config.json`); a per-repo Pro flag produced
 * the 2026-04-06 incoherence bug where the dashboard top nav (running with
 * `cwd: ~/src/aigon`) and the autonomous-start subprocess (running with
 * `cwd: ~/src/brewboard`) disagreed about Pro state in the same session.
 *
 * Accepted AIGON_FORCE_PRO values:
 *   - "false" / "0" → simulate free tier even when @aigon/pro is installed
 *   - "true"  / "1" → force Pro on, even without @aigon/pro installed
 *                     (use for dev when the package is globally linked but not
 *                     visible to Node require — e.g. after npm install wiped the
 *                     local npm-link symlink)
 *   - anything else / unset → use package availability (@senlabsai/aigon-pro must be
 *                             resolvable via require())
 *
 * Because spawnSync inherits process.env by default, setting this flag in the
 * shell that starts `aigon server start` automatically propagates to every
 * subprocess the server spawns (autonomous-start, feature-close, etc.), keeping
 * the whole process tree in agreement — which is exactly what the 2026-04-06
 * per-repo-config incident taught us to require.
 */
function isProAvailable() {
    const raw = process.env.AIGON_FORCE_PRO;
    if (raw === 'false' || raw === '0') return false;
    if (raw === 'true' || raw === '1') return true;
    const proPackage = loadPro();
    if (!proPackage) return false;
    // If aigon-pro exports isActivated(), defer to its key check.
    if (typeof proPackage.isActivated === 'function') return proPackage.isActivated();
    return true;
}

/**
 * Check a Pro capability and print a one-shot fallback message if unavailable.
 * Returns boolean. Never throws. Never calls process.exit — callers decide.
 *
 * Writes to stderr (not stdout) so the dashboard's error-extraction
 * heuristic in dashboard-server.js can surface the first line as the
 * user-facing error toast instead of showing a generic "exit code 1"
 * message. This also matches shell convention: failure-path output
 * belongs on stderr.
 */
function assertProCapability(capabilityName, fallbackCmd) {
    if (isProAvailable()) return true;
    console.error(`🔒 ${capabilityName} is a Pro feature.`);
    if (fallbackCmd) console.error(`   Free alternative: ${fallbackCmd}`);
    console.error('   Install: npm install -g @senlabsai/aigon-pro');
    console.error('   Activate: aigon pro activate <your-key>');
    return false;
}

/**
 * Read the installed @senlabsai/aigon-pro package version, if resolvable.
 * Returns null when the package is not installed or its package.json is
 * unreadable. Never throws.
 */
function getProPackageVersion() {
    loadPro();
    if (!proResolvedPath) return null;
    try {
        // proResolvedPath points at the package entry file (e.g. index.js);
        // walk up to find the nearest package.json with the matching name.
        let dir = path.dirname(proResolvedPath);
        for (let i = 0; i < 6; i++) {
            const pkgPath = path.join(dir, 'package.json');
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    if (pkg && pkg.name === '@senlabsai/aigon-pro' && pkg.version) {
                        return pkg.version;
                    }
                } catch (_) {}
            }
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    } catch (_) {}
    return null;
}

/**
 * Lightweight read of the global Pro key — used by the dashboard Version
 * panel and `aigon pro status` to report whether the user has activated.
 * No JSON parse errors propagate; returns false on any read failure.
 */
function hasProKey() {
    try {
        const cfgPath = path.resolve(
            process.env.GLOBAL_CONFIG_PATH || path.join(os.homedir(), '.aigon', 'config.json')
        );
        if (!fs.existsSync(cfgPath)) return false;
        const raw = fs.readFileSync(cfgPath, 'utf8').trim();
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(parsed && parsed.proKey);
    } catch (_) {
        return false;
    }
}

/**
 * Full Pro status snapshot for the dashboard Version panel and any other
 * surface that wants to render all three signals at once. Pure, synchronous,
 * never throws.
 */
function getProStatus() {
    const packageInstalled = Boolean(loadPro());
    const version = packageInstalled ? getProPackageVersion() : null;
    const keyPresent = hasProKey();
    const active = isProAvailable();
    return {
        packageInstalled,
        version,
        keyPresent,
        active,
        resolvedPath: proResolvedPath || null,
        loadError: proLoadError ? (proLoadError.message || String(proLoadError)) : null,
    };
}

module.exports = {
    isProAvailable,
    getPro: () => loadPro(),
    getProResolvedPath: () => {
        loadPro();
        return proResolvedPath;
    },
    getProLoadError: () => {
        loadPro();
        return proLoadError;
    },
    getProPackageVersion,
    hasProKey,
    getProStatus,
    assertProCapability,
};
