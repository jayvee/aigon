'use strict';

const fs = require('fs');
// Boundary: no direct fs reads of engine state or docs/specs here; use owner modules.
const path = require('path');
const os = require('os');
const { execSync, spawnSync, spawn } = require('child_process');
const git = require('./git');
const stateMachine = require('./state-queries');
const { isProAvailable } = require('./pro');
const proBridge = require('./pro-bridge');
const workflowReadModel = require('./workflow-read-model');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const featureSpecResolver = require('./feature-spec-resolver');
const { reconcileEntitySpec } = require('./spec-reconciliation');
const { queryGitHubPrStatus } = require('./remote-gate-github');
const { collectFeatureDeepStatus } = require('./feature-status');
const terminalAdapters = require('./terminal-adapters');
const dashboardActions = require('./dashboard-actions');
const dashboardActionCommand = require('./dashboard-action-command');
const dashboardProAssets = require('./dashboard-pro-assets');
const dashboardStyles = require('./dashboard-styles');
const agentRegistry = require('./agent-registry');
const {
    collectDashboardStatusData,
    collectDashboardStatusDataAsync,
    collectAllFeaturesLean,
    collectDashboardHealth,
    refreshRepoInDashboardStatus,
    collectEntityAgentLogs,
    collectFeaturesForResearch,
    collectResearchFindings,
    countDoneEntities,
    getAgentDetailRecords,
    readEntityLogExcerpts,
} = require('./dashboard-status-collector');
const { createStatusSnapshotStore } = require('./dashboard-status-version');
const { createDashboardSseHub } = require('./dashboard-sse');
const { createDashboardRouteDispatcher } = require('./dashboard-routes');
const { attachPtyWebSocketServer } = require('./pty-session-handler');
const {
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
    safeTmuxSessionExists,
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    worktreeHasImplementationCommits,
    hasResearchFindingsProgress,
    parseStatusFlags,
    maybeFlagEndedSession,
} = require('./dashboard-status-helpers');
// Supervisor integration: startSupervisorLoop and getSupervisorStatus are
// injected via serverOptions by the infra.js command handler, NOT imported
// directly — the HTTP module has zero imports of the supervisor module.

// Constants from config.js
const {
    GLOBAL_CONFIG_PATH, GLOBAL_CONFIG_DIR, DASHBOARD_LOG_FILE, ACTION_LOG_FILE, ROOT_DIR, CLI_ENTRY_PATH,
    DASHBOARD_DYNAMIC_PORT_START, DASHBOARD_DYNAMIC_PORT_END,
    loadGlobalConfig, saveGlobalConfig,
    readConductorReposFromGlobalConfig, loadProjectConfig, getActiveProfile,
    getNestedValue, setNestedValue, DEFAULT_GLOBAL_CONFIG, getConfigModelValue,
    getDefaultAgent,
} = require('./config');
const {
    getAppId, isProxyAvailable, getDevProxyUrl, openInBrowser,
    addCaddyRoute, removeCaddyRoute, buildCaddyHostname,
    parseCaddyRoutes, isProcessAlive, isPortInUseSync,
} = require('./proxy');
const storagePoller = require('./storage-poller');
const agentQuotaPoller = require('./agent-quota-poller');
const { createDashboardFsWatch } = require('./dashboard-fs-watch');
const { collectAnalyticsData } = require('./analytics');
const { runTmux, shellQuote, tmuxSessionExists } = require('./worktree');
const { readTemplate } = require('./templates');
const { getAigonVersion } = require('./version');

const LIVE_LOG_DIR = path.join(GLOBAL_CONFIG_DIR, 'server', 'action-logs');

const dashboardDetail = require('./dashboard-detail');

function formatPeekUptime(totalSec) {
    const s = Math.max(0, Math.floor(Number(totalSec)));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60) % 60;
    const h = Math.floor(s / 3600) % 24;
    const d = Math.floor(s / 86400);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function getTmuxSessionPeekMeta(sessionName) {
    if (!sessionName) return { uptime: '', lastActivity: '' };
    const meta = runTmux(['display-message', '-t', sessionName, '-p', '#{session_created}\t#{session_activity}'], { encoding: 'utf8', stdio: 'pipe' });
    if (meta.error || meta.status !== 0) return { uptime: '', lastActivity: '' };
    const parts = (meta.stdout || '').trim().split('\t');
    const created = parseInt(parts[0], 10);
    const activity = parseInt(parts[1], 10);
    if (!Number.isFinite(created) || !Number.isFinite(activity)) return { uptime: '', lastActivity: '' };
    const now = Math.floor(Date.now() / 1000);
    return {
        uptime: formatPeekUptime(Math.max(0, now - created)),
        lastActivity: new Date(activity * 1000).toLocaleString(),
    };
}

function platformOpen(target) {
    const value = String(target || '').trim();
    if (!value) {
        const err = new Error('Path is required');
        err.code = 'INVALID_PATH';
        throw err;
    }
    const cmd = process.platform === 'linux' ? 'xdg-open'
        : process.platform === 'win32' ? 'explorer.exe'
            : process.platform === 'darwin' ? 'open'
                : null;
    if (!cmd) {
        const err = new Error(`Opening folders is not supported on platform: ${process.platform}`);
        err.code = 'UNSUPPORTED_PLATFORM';
        throw err;
    }
    const openResult = spawnSync(cmd, [value], { stdio: 'ignore' });
    if (openResult.error) {
        const err = new Error(openResult.error.message || `Failed to run ${cmd}`);
        err.code = openResult.error.code || 'OPEN_COMMAND_FAILED';
        throw err;
    }
    if (openResult.status !== 0) {
        const err = new Error(`Failed to open path (exit ${openResult.status})`);
        err.code = 'OPEN_COMMAND_FAILED';
        throw err;
    }
}

const dashboardSettings = require('./dashboard-settings');

function escapeForHtmlScript(jsonValue) {
    return JSON.stringify(jsonValue)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function buildDashboardHtml(initialData, instanceName, templateRootOverride, configs = {}) {
    const version = getAigonVersion() || '0';
    const agents = agentRegistry.getDashboardAgents({
        globalConfig: configs.globalConfig || null,
        projectConfig: configs.projectConfig || null,
        repoPath: configs.repoPath || process.cwd(),
    });
    const bootstrap = {
        initialData,
        instanceName: instanceName || 'main',
        agents,
        defaultAgent: getDefaultAgent(),
    };
    const serializedBootstrap = escapeForHtmlScript(bootstrap);
    let htmlTemplate;
    if (templateRootOverride) {
        const overridePath = path.join(templateRootOverride, 'templates', 'dashboard', 'index.html');
        if (fs.existsSync(overridePath)) {
            htmlTemplate = fs.readFileSync(overridePath, 'utf8');
        } else {
            htmlTemplate = readTemplate('dashboard/index.html');
        }
    } else {
        htmlTemplate = readTemplate('dashboard/index.html');
    }
    return htmlTemplate
        .replace(/\$\{AIGON_BOOTSTRAP\}/g, () => serializedBootstrap)
        .replace(/\$\{AIGON_VERSION\}/g, () => version);
}

async function captureDashboardScreenshot(url, outputPath, width, height) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    let puppeteer = null;
    try {
        puppeteer = require('puppeteer');
    } catch (e) {
        try { puppeteer = require('puppeteer-core'); } catch (_) { /* ignore */ }
    }

    if (puppeteer) {
        const browser = await puppeteer.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setViewport({ width, height });
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
            await page.screenshot({ path: outputPath, fullPage: true });
            return { method: 'puppeteer' };
        } finally {
            await browser.close();
        }
    }

    throw new Error('Dashboard screenshot capture requires puppeteer or puppeteer-core; AppleScript fallback is disabled to avoid macOS cross-app privacy prompts.');
}

function writeRepoRegistry(repos) {
    let cfg = {};
    try {
        if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
            cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        }
    } catch (e) { /* start fresh */ }
    cfg.repos = repos;
    saveGlobalConfig(cfg);
}

function sendMacNotification(message, title = 'Aigon Dashboard', { openUrl } = {}) {
    try {
        // Prefer terminal-notifier when available — supports click-to-open actions
        const tnPath = execSync('which terminal-notifier 2>/dev/null', { encoding: 'utf8' }).trim();
        if (tnPath) {
            const args = ['-title', title, '-message', message, '-group', 'aigon', '-sender', 'com.apple.Terminal'];
            if (openUrl) args.push('-open', openUrl);
            spawnSync(tnPath, args, { stdio: 'ignore' });
            return;
        }
    } catch (_) {
        // terminal-notifier not found; notification failure is non-fatal.
    }
    // Do not fall back to osascript here. On recent macOS versions that causes
    // TCC to prompt that "node would like to access data from other apps" for
    // background dashboard/server notifications.
}

function handleSpecReconcileApiRequest(req, res, options = {}) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString('utf8'); });
    req.on('end', () => {
        let payload = {};
        try {
            payload = body ? JSON.parse(body) : {};
        } catch (_) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            return;
        }

        const entityType = String(payload.entityType || '').trim();
        const entityId = String(payload.entityId || '').trim();
        if (entityType !== 'feature' && entityType !== 'research') {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: 'entityType must be feature or research' }));
            return;
        }
        if (!entityId) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: 'entityId is required' }));
            return;
        }

        const repoResolution = dashboardActionCommand.resolveDashboardActionRepoPath(
            payload.repoPath,
            options.registeredRepos || [],
            options.defaultRepoPath || process.cwd()
        );
        if (!repoResolution.ok) {
            res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repoPath' }));
            return;
        }

        try {
            const result = (options.reconcileFn || reconcileEntitySpec)(
                repoResolution.repoPath,
                entityType,
                entityId,
                { dryRun: false, logger: options.logger }
            );
            if (typeof options.onComplete === 'function') options.onComplete(result, repoResolution.repoPath);
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ ok: true, repoPath: repoResolution.repoPath, ...result }));
        } catch (error) {
            if (/unknown-lifecycle/.test(String(error && error.message || ''))) {
                let fallbackCurrentPath = null;
                try {
                    const resolvedSpec = entityType === 'research'
                        ? featureSpecResolver.resolveResearchSpec(repoResolution.repoPath, entityId)
                        : featureSpecResolver.resolveFeatureSpec(repoResolution.repoPath, entityId);
                    fallbackCurrentPath = resolvedSpec && resolvedSpec.path ? resolvedSpec.path : null;
                } catch (_) { /* best effort */ }
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({
                    ok: true,
                    repoPath: repoResolution.repoPath,
                    entityType,
                    entityId,
                    currentPath: fallbackCurrentPath,
                    expectedPath: null,
                    driftDetected: false,
                    moved: false,
                    skipped: 'expected-path-outside-docs',
                }));
                return;
            }
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: error.message || 'Failed to reconcile spec drift' }));
        }
    });
}

function listRepoBranches(repoPath, options = {}) {
    const exec = options.execFn || execSync;
    try {
        const quotedRepo = shellQuote(repoPath);
        const output = exec(`git -C ${quotedRepo} branch --list --format="%(refname:short)"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return String(output || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

function resolveFeatureBranchForPrStatus(repoPath, featureId, options = {}) {
    const targetId = String(featureId || '').trim();
    if (!targetId) {
        return { ok: false, message: 'featureId is required' };
    }

    const snapshotReader = options.readFeatureSnapshotSync || workflowSnapshotAdapter.readFeatureSnapshotSync;
    const specResolver = options.resolveFeatureSpec || featureSpecResolver.resolveFeatureSpec;
    const branchLister = options.listRepoBranches || listRepoBranches;

    const snapshot = snapshotReader(repoPath, targetId);
    const resolvedSpec = specResolver(repoPath, targetId, { snapshot });
    if (!resolvedSpec || !resolvedSpec.path) {
        return { ok: false, message: `Feature ${targetId} spec not found` };
    }

    const m = path.basename(resolvedSpec.path).match(/^feature-(\d+)-(.+)\.md$/);
    if (!m) {
        return { ok: false, message: `Could not parse feature filename for feature ${targetId}` };
    }

    const num = m[1];
    const desc = m[2];
    const driveBranch = `feature-${num}-${desc}`;
    const allBranches = branchLister(repoPath, options);
    const branchSet = new Set(allBranches);

    const snapshotAgentBranches = Object.keys((snapshot && snapshot.agents) || {})
        .map(agentId => `feature-${num}-${agentId}-${desc}`)
        .filter(branchName => branchSet.has(branchName));
    if (snapshotAgentBranches.length === 1) {
        return { ok: true, branchName: snapshotAgentBranches[0], featureNum: num };
    }
    if (snapshotAgentBranches.length > 1) {
        return {
            ok: false,
            message: `Multiple agent branches found for feature ${num}: ${snapshotAgentBranches.join(', ')}`,
        };
    }

    const matchingBranches = allBranches.filter(branchName =>
        branchName.startsWith(`feature-${num}-`) &&
        (branchName === driveBranch || branchName.endsWith(`-${desc}`))
    );
    const agentBranches = matchingBranches.filter(branchName => branchName !== driveBranch);
    if (agentBranches.length === 1) {
        return { ok: true, branchName: agentBranches[0], featureNum: num };
    }
    if (agentBranches.length > 1) {
        return {
            ok: false,
            message: `Multiple agent branches found for feature ${num}: ${agentBranches.join(', ')}`,
        };
    }
    if (branchSet.has(driveBranch)) {
        return { ok: true, branchName: driveBranch, featureNum: num };
    }
    if (matchingBranches.length === 1) {
        return { ok: true, branchName: matchingBranches[0], featureNum: num };
    }
    if (matchingBranches.length > 1) {
        return {
            ok: false,
            message: `Multiple feature branches found for feature ${num}: ${matchingBranches.join(', ')}`,
        };
    }

    return { ok: false, message: `No local feature branch found for feature ${num}` };
}

function getFeaturePrStatusPayload(repoPath, featureId, options = {}) {
    const branchResult = resolveFeatureBranchForPrStatus(repoPath, featureId, options);
    if (!branchResult.ok) {
        return {
            provider: 'github',
            status: 'unavailable',
            message: branchResult.message,
        };
    }

    const defaultBranch = detectDefaultBranch(repoPath) || 'main';
    return queryGitHubPrStatus(branchResult.branchName, defaultBranch, {
        cwd: repoPath,
        execFn: options.execFn,
    });
}

function runDashboardServer(port, instanceName, serverId, options) {
    const http = require('http');
    const host = '0.0.0.0';
    instanceName = instanceName || 'main';
    options = options || {};
    const templateRoot = options.templateRoot || ROOT_DIR;
    const isPreview = !!options.templateRoot;
    const appId = options.appId || getAppId();
    const localUrl = `http://${host}:${port}`;
    const proxyAvailable = isProxyAvailable();
    const proxyUrl = proxyAvailable ? getDevProxyUrl(appId, serverId || null) : null;
    const dashboardUrl = proxyUrl || localUrl;
    let latestStatus;
    const statusSnapshot = createStatusSnapshotStore();
    const sseHub = createDashboardSseHub();
    function replaceLatestStatus(nextStatus, source) {
        const prevVersion = statusSnapshot.getStatusVersion();
        latestStatus = statusSnapshot.replaceLatestStatus(nextStatus, source);
        const nextVersion = statusSnapshot.getStatusVersion();
        if (source !== 'init' && nextVersion !== prevVersion) {
            sseHub.broadcast('status', { statusVersion: nextVersion });
        }
        return latestStatus;
    }
    function emptyDegradedStatus(err) {
        return {
            generatedAt: new Date().toISOString(),
            repos: [],
            summary: { implementing: 0, waiting: 0, ready: 0, error: 0, total: 0 },
            proAvailable: false,
            proStatus: { packageInstalled: false, version: null, keyPresent: false, active: false, resolvedPath: null },
            collectorError: err ? (err.message || String(err)) : null,
        };
    }
    /** Lightweight HTML bootstrap — full grid data is fetched via /api/status. */
    function buildDashboardBootstrapData(status) {
        const base = emptyDegradedStatus(null);
        if (!status || !Array.isArray(status.repos)) return base;
        return {
            ...base,
            generatedAt: status.generatedAt || base.generatedAt,
            summary: status.summary || base.summary,
            proAvailable: status.proAvailable,
            proStatus: status.proStatus,
            updateCheck: status.updateCheck,
            warming: true,
        };
    }
    function refreshLatestStatus() {
        try {
            return replaceLatestStatus(
                collectDashboardStatusData(process.env.AIGON_DASH_TIMING === '1' ? { collectPerf: true } : undefined),
                'refresh'
            );
        } catch (err) {
            console.error(`❌ collectDashboardStatusData failed: ${err && err.stack || err}`);
            // Keep the last-known-good status if we have one; otherwise serve a
            // valid-shaped empty response so /api/status and the UI degrade
            // gracefully instead of taking the daemon down.
            if (!latestStatus) replaceLatestStatus(emptyDegradedStatus(err), 'refresh-error');
        }
        return latestStatus;
    }
    replaceLatestStatus(emptyDegradedStatus(null), 'init');
    const lastStatusByAgent = {};
    const allSubmittedNotified = new Set();
    // Tracks agents for which a sticky-idle panel notification has been emitted.
    // Key: `${repoPath}:${entityPrefix}${entityId}:${agentId}`. Cleared when idle clears.
    const stickyIdleNotified = new Set();
    let globalConfig = loadGlobalConfig();

    // ── Logs event buffer ─────────────────────────────────────────────────────
    const LOGS_BUFFER_MAX = 200;
    const logsBuffer = []; // { timestamp, type, action, args, repoPath, command, exitCode, ok, stdout, stderr, duration }
    // Warm buffer from persisted action logs so entries survive server restarts
    try {
        const _saved = fs.readFileSync(ACTION_LOG_FILE, 'utf8').split('\n').filter(Boolean);
        _saved.slice(-LOGS_BUFFER_MAX).forEach(line => {
            try { logsBuffer.push(JSON.parse(line)); } catch (_) {}
        });
    } catch (_) { /* file may not exist yet */ }

    // ── feature 234: in-flight action dedupe ──────────────────────────────────
    // Prevents double-click footguns on Close / Accept / Reject / Adopt. Keyed
    // by `${repoPath}|${action}|${args.join(',')}`. Entries are removed in the
    // request handler's finally block (both success and failure).
    const inflightActions = new Map();

    // ── feature 428: live-log state for feature-close ─────────────────────────
    // Keyed by actionId (client-generated). Each entry: { logPath, lines, done }.
    const activeActionLogs = new Map();

    // Remove stale log files left by a previous server crash (> 5 min old).
    try {
        fs.mkdirSync(LIVE_LOG_DIR, { recursive: true });
        const staleThreshold = 5 * 60 * 1000;
        for (const f of fs.readdirSync(LIVE_LOG_DIR)) {
            if (!f.endsWith('.log')) continue;
            const fp = path.join(LIVE_LOG_DIR, f);
            try {
                const { mtimeMs } = fs.statSync(fp);
                if (Date.now() - mtimeMs > staleThreshold) fs.unlinkSync(fp);
            } catch (_) {}
        }
    } catch (_) {}
    function inflightKey(repoPath, action, args) {
        return `${repoPath || ''}|${action || ''}|${(args || []).join(',')}`;
    }

    const ACTION_LOG_MAX_LINES = 500;

    function logToLogs(entry) {
        entry.timestamp = new Date().toISOString();
        logsBuffer.push(entry);
        if (logsBuffer.length > LOGS_BUFFER_MAX) logsBuffer.shift();
        const stdoutText = String(entry.stdout || '');
        const startupPhases = stdoutText
            .split('\n')
            .filter(line => line.includes('[aigon:start-phase]'))
            .slice(-8);
        log(`${entry.type}: ${entry.command || entry.action} | ok=${entry.ok} exitCode=${entry.exitCode !== undefined ? entry.exitCode : 'n/a'}${entry.stderr ? ' stderr=' + String(entry.stderr).trim().slice(0, 120) : ''}${startupPhases.length ? ' phases=' + startupPhases.join(' | ').slice(0, 500) : ''}`);
        // Persist to JSONL so entries survive server restarts
        try {
            fs.appendFileSync(ACTION_LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
            // Trim file if it grows beyond ACTION_LOG_MAX_LINES
            const content = fs.readFileSync(ACTION_LOG_FILE, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            if (lines.length > ACTION_LOG_MAX_LINES) {
                fs.writeFileSync(ACTION_LOG_FILE, lines.slice(-ACTION_LOG_MAX_LINES).join('\n') + '\n', 'utf8');
            }
        } catch (_) { /* non-fatal */ }
    }

    function readPersistedActionLogs() {
        try {
            const content = fs.readFileSync(ACTION_LOG_FILE, 'utf8');
            return content.split('\n').filter(Boolean).map(line => {
                try { return JSON.parse(line); } catch (_) { return null; }
            }).filter(Boolean);
        } catch (_) { return []; }
    }

    // ── Notification system ────────────────────────────────────────────────────
    const NOTIFICATION_BUFFER_MAX = 100;
    const notificationBuffer = []; // { id, type, message, meta, timestamp, read }
    let notificationUnreadCount = 0;
    let notificationIdSeq = 0;

    const NOTIFICATION_TYPES = ['agent-waiting', 'agent-ready', 'agent-needs-attention', 'all-ready', 'all-research-ready', 'error'];

    function getNotificationConfig() {
        const cfg = (globalConfig.notifications) || {};
        return {
            enabled: cfg.enabled !== false,
            types: NOTIFICATION_TYPES.reduce((acc, t) => {
                acc[t] = cfg.types ? cfg.types[t] !== false : true;
                return acc;
            }, {})
        };
    }

    function emitNotification(type, message, meta) {
        const notifCfg = getNotificationConfig();
        const event = {
            id: ++notificationIdSeq,
            type,
            message,
            meta: meta || {},
            timestamp: new Date().toISOString(),
            read: false
        };
        notificationBuffer.push(event);
        if (notificationBuffer.length > NOTIFICATION_BUFFER_MAX) notificationBuffer.shift();
        notificationUnreadCount++;
        log(`Notification [${type}] ${message}`);

        if (notifCfg.enabled && notifCfg.types[type] !== false) {
            const title = (meta && meta.title) || 'Aigon Dashboard';
            const openUrl = (meta && meta.openUrl) || undefined;
            sendMacNotification(message, title, { openUrl });
        }
        sseHub.broadcast('notification', { unreadCount: notificationUnreadCount });
    }

    function broadcastServerRestarting() {
        sseHub.broadcast('server-restarting', {});
    }

    function emitServerEvent(event) {
        if (!event || !event.type) return;
        if (event.type === 'quota.refreshed') return;
        logToLogs({
            type: 'server-event',
            action: event.type,
            ok: true,
            event,
        });
    }

    const LOG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB
    let _logRotating = false;

    function _rotateLogIfNeeded() {
        if (_logRotating) return;
        try {
            const stat = fs.statSync(DASHBOARD_LOG_FILE);
            if (stat.size > LOG_MAX_BYTES) {
                _logRotating = true;
                const backup = DASHBOARD_LOG_FILE + '.1';
                try { fs.unlinkSync(backup); } catch (_) { /* no previous backup */ }
                fs.renameSync(DASHBOARD_LOG_FILE, backup);
                _logRotating = false;
            }
        } catch (_) { _logRotating = false; /* file doesn't exist yet */ }
    }

    function log(msg) {
        try {
            _rotateLogIfNeeded();
            fs.appendFileSync(DASHBOARD_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
        } catch (e) { /* ignore */ }
    }
    log.error = (msg) => log(`ERROR ${msg}`);
    log.warn = (msg) => log(`WARN  ${msg}`);

    // ── Startup diagnostics ───────────────────────────────────────────────────
    {
        const ver = (() => { try { return require('../package.json').version; } catch (_) { return '?'; } })();
        log(`──── Dashboard starting ────`);
        log(`  aigon     : v${ver}`);
        log(`  node      : ${process.version}`);
        log(`  platform  : ${process.platform} ${process.arch}`);
        log(`  pid       : ${process.pid}`);
        log(`  port      : ${port}`);
        log(`  instance  : ${instanceName}`);
        log(`  log file  : ${DASHBOARD_LOG_FILE}`);
        const mem = process.memoryUsage();
        log(`  memory    : rss=${Math.round(mem.rss / 1024 / 1024)}MB heap=${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
    }

    // ── Idle timer removed: dashboard stays alive until Ctrl+C or dev-server stop ──
    function resetIdleTimer() { /* no-op — kept for call-site compatibility */ }

    function resolveRepoFromPathParam(repoParam) {
        let decodedRepo = '';
        try {
            decodedRepo = decodeURIComponent(String(repoParam || ''));
        } catch (_) {
            return { ok: false, status: 400, error: 'Invalid repo path parameter' };
        }
        return dashboardActionCommand.resolveDashboardActionRepoPath(decodedRepo, readConductorReposFromGlobalConfig(), process.cwd());
    }

    function resolveRequestedRepoPath(requestedRepoPath) {
        return dashboardActionCommand.resolveDashboardActionRepoPath(requestedRepoPath, readConductorReposFromGlobalConfig(), process.cwd());
    }

    function resolveRequestedRepoPathOrRespond(res, requestedRepoPath) {
        const repoResolution = resolveRequestedRepoPath(requestedRepoPath);
        if (!repoResolution.ok) {
            res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repoPath' }));
            return null;
        }
        return repoResolution.repoPath;
    }

    // ── Pro extension point ───────────────────────────────────────────────────
    // Initialize the pro-bridge once at server start. This is the single seam
    // through which @aigon/pro registers routes (and, in the future, lifecycle
    // hooks). Open-source code never imports `@aigon/pro` outside of lib/pro.js
    // and lib/pro-bridge.js — see docs/architecture.md § "Aigon Pro".
    proBridge.initialize({
        helpers: {
            loadProjectConfig,
            resolveRequestedRepoPath,
            readConductorReposFromGlobalConfig,
            sendJson(res, status, payload) {
                res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(payload));
            },
            // Extra helpers added with feature 236 so Pro's moved engines
            // (recurring spawner, scheduled-kickoff poller, vault push) can
            // log, locate the CLI, and emit dashboard notifications.
            log,
            defaultRepoPath: options.defaultRepoPath || process.cwd(),
            cliEntryPath: CLI_ENTRY_PATH,
            emitNotification: (kind, msg, meta) => {
                try { emitNotification(kind, msg, meta); }
                catch (_) { /* notifications subsystem may not be ready */ }
            },
        },
    });

    function findFeatureAgentInStatus(repoPath, featureId, agentId) {
        const absRepoPath = path.resolve(String(repoPath || ''));
        const targetFeatureId = String(featureId || '');
        const targetAgentId = String(agentId || '');
        const repo = (latestStatus.repos || []).find(r => path.resolve(String(r.path || '')) === absRepoPath);
        if (!repo) return null;
        const feature = (repo.features || []).find(f => String(f.id) === targetFeatureId);
        if (!feature) return null;
        const agent = (feature.agents || []).find(a => String(a.id) === targetAgentId);
        if (!agent) return null;
        return { repo, feature, agent };
    }

    // F621: interval poll is a safety net (tmux liveness, watcher misses). Event-driven
    // refresh via lib/dashboard-fs-watch.js handles disk changes within ~400ms.
    const POLL_INTERVAL_SAFETY_MS = 60_000;
    /** @type {Promise<void>|null} */
    let pollInFlightPromise = null;
    /** @type {'all'|'repo'|null} */
    let pollInFlightScope = null;
    let pollLoopTimer = null;

    async function waitUntilSweepIdle() {
        const { isSweepInFlight } = require('./supervisor');
        while (isSweepInFlight()) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }

    async function pollStatus(options = {}) {
        const force = options.force === true;
        if (pollInFlightPromise) {
            if (!force && pollInFlightScope === 'all') return pollInFlightPromise;
            await pollInFlightPromise;
        }
        if (pollInFlightPromise && !force) return pollInFlightPromise;
        const run = (async () => {
            pollInFlightScope = 'all';
            await waitUntilSweepIdle();
            const pollStart = Date.now();
            try {
                // F590: always collect per-repo timings so the slow-poll log line can
                // name the responsible repos. The env var still controls whether the
                // verbose `_perf` block is *shipped* in the /api/status payload.
                const envTimingOn = process.env.AIGON_DASH_TIMING === '1';
                const collected = await collectDashboardStatusDataAsync({ collectPerf: true });
                const pollTotalMs = Date.now() - pollStart;
                const summary = collected && collected._perf;
                // F590: log automatically when a poll exceeds 1s even without the env
                // var — the next regression self-reports instead of relying on "feels slow".
                if (summary && (envTimingOn || pollTotalMs > 1000)) {
                    const top = (summary.repos || [])
                        .slice()
                        .sort((a, b) => b.totalMs - a.totalMs)
                        .slice(0, 3)
                        .map(r => `${r.name}:${r.totalMs}ms`)
                        .join(', ');
                    log(`[perf] poll summary total=${summary.totalMs}ms repos=${(summary.repos || []).length}${top ? ` top=[${top}]` : ''}${!envTimingOn ? ' ⚠️ slow (>1s)' : ''}`);
                }
                // Keep the verbose `_perf` block off the shipped payload unless the
                // env var explicitly opts in.
                if (!envTimingOn && collected && collected._perf) delete collected._perf;
                replaceLatestStatus(collected, 'poll');
            } catch (e) {
                log.error(`Poll failed: ${e.message}`);
                log.error(`  stack: ${e.stack}`);
                return; // Don't crash — skip this poll cycle
            }
            await afterPollSideEffects({ pollStart, scope: 'all' });
        })();
        pollInFlightPromise = run;
        try {
            await run;
        } finally {
            if (pollInFlightPromise === run) {
                pollInFlightPromise = null;
                pollInFlightScope = null;
            }
        }
    }

    async function pollRepoStatus(repoPath) {
        if (!repoPath) {
            return pollStatus();
        }
        if (pollInFlightPromise) {
            if (pollInFlightScope === 'all') return pollInFlightPromise;
            await pollInFlightPromise;
        }
        if (pollInFlightPromise) return pollInFlightPromise;
        const run = (async () => {
            pollInFlightScope = 'repo';
            await waitUntilSweepIdle();
            const pollStart = Date.now();
            const envTimingOn = process.env.AIGON_DASH_TIMING === '1';
            try {
                const envTimingOn = process.env.AIGON_DASH_TIMING === '1';
                const refreshed = refreshRepoInDashboardStatus(latestStatus, repoPath, { collectPerf: true });
                const pollTotalMs = Date.now() - pollStart;
                const absPath = path.resolve(repoPath);
                const repoPerf = (refreshed && refreshed.repos || [])
                    .find(r => path.resolve(String(r.path || '')) === absPath);
                const repoMs = repoPerf && repoPerf._perf ? repoPerf._perf.totalMs : pollTotalMs;
                if (envTimingOn || pollTotalMs > 500) {
                    log(`[perf] repo refresh ${path.basename(absPath)}=${repoMs}ms (wall=${pollTotalMs}ms)`);
                }
                if (repoPerf && repoPerf._perf) delete repoPerf._perf;
                if (!envTimingOn && refreshed && refreshed._perf) delete refreshed._perf;
                replaceLatestStatus(refreshed, 'poll-repo');
            } catch (e) {
                log.error(`Repo poll failed: ${e.message}`);
                return;
            }
            await afterPollSideEffects({ pollStart, scope: 'repo', repoPath });
        })();
        pollInFlightPromise = run;
        try {
            await run;
        } finally {
            if (pollInFlightPromise === run) {
                pollInFlightPromise = null;
                pollInFlightScope = null;
            }
        }
    }

    const dashboardFsWatch = createDashboardFsWatch({
        log,
        pollRepoStatus,
        readRepos: readConductorReposFromGlobalConfig,
        loadGlobalConfig: () => globalConfig,
        loadProjectConfig,
    });

    async function afterPollSideEffects(meta = {}) {
        // F454: mid-run quota scan runs after status collection, awaited so
        // each scan can yield to the loop on its own setImmediate boundaries.
        try {
            const quotaMidRun = require('./quota-mid-run-detector');
            for (const repo of (latestStatus.repos || [])) {
                if (!repo || !repo.path) continue;
                try {
                    await quotaMidRun.scanActiveSessions(repo.path);
                } catch (_) { /* best-effort per repo */ }
            }
        } catch (_) { /* F446 best-effort */ }
        (latestStatus.repos || []).forEach(repo => {
            const repoShort = repo.name || path.basename(repo.path);
            const notifTitle = `Aigon · ${repoShort}`;
            const notifMeta = (extra) => ({ title: notifTitle, openUrl: dashboardUrl, repoPath: repo.path, repoName: repoShort, ...extra });
            (repo.features || []).forEach(feature => {
                (feature.agents || []).forEach(agent => {
                    const key = `${repo.path}:${feature.id}:${agent.id}`;
                    const prev = lastStatusByAgent[key];
                    if (prev && prev !== 'waiting' && agent.status === 'waiting') {
                        emitNotification('agent-waiting', `${agent.id} waiting on #${feature.id} ${feature.name} · ${repoShort}`, notifMeta({ featureId: feature.id, agentId: agent.id }));
                    }
                    lastStatusByAgent[key] = agent.status;
                    // Sticky idle panel entry — persists until the idle state clears
                    if (agent.idleLadder && agent.idleLadder.state === 'needs-attention' && !stickyIdleNotified.has(key)) {
                        stickyIdleNotified.add(key);
                        emitNotification('agent-needs-attention', `${agent.id} needs attention on #${feature.id} ${feature.name} · ${repoShort}`, notifMeta({ featureId: feature.id, agentId: agent.id }));
                    } else if (agent.idleState && agent.idleState.level === 'sticky' && !stickyIdleNotified.has(key)) {
                        stickyIdleNotified.add(key);
                        emitNotification('agent-idle-sticky', `${agent.id} idle ${agent.idleState.idleMinutes}m on #${feature.id} ${feature.name} · ${repoShort}`, notifMeta({ featureId: feature.id, agentId: agent.id }));
                    } else if ((!agent.idleState || agent.idleState.level !== 'sticky') && (!agent.idleLadder || agent.idleLadder.state !== 'needs-attention')) {
                        stickyIdleNotified.delete(key);
                    }
                });

                (feature.reviewSessions || []).forEach(session => {
                    if (!session.running || !session.agent) return;
                    const key = `${repo.path}:${feature.id}:review:${session.agent}`;
                    if (session.idleLadder && session.idleLadder.state === 'needs-attention' && !stickyIdleNotified.has(key)) {
                        stickyIdleNotified.add(key);
                        emitNotification('agent-needs-attention', `${session.agent} reviewer needs attention on #${feature.id} ${feature.name} · ${repoShort}`, notifMeta({ featureId: feature.id, agentId: session.agent }));
                    } else if (!session.idleLadder || session.idleLadder.state !== 'needs-attention') {
                        stickyIdleNotified.delete(key);
                    }
                });

                const featureKey = `${repo.path}:${feature.id}`;
                const agents = Array.isArray(feature.agents) ? feature.agents : [];
                const featureSmCtx = {
                    agents: agents.map(a => a.id),
                    agentStatuses: Object.fromEntries(agents.map(a => [a.id, a.status])),
                    tmuxSessionStates: {}
                };
                const featureAllSubmitted = feature.stage === 'in-progress' && stateMachine.isFleet(featureSmCtx) && stateMachine.allAgentsSubmitted(featureSmCtx);
                if (featureAllSubmitted && !allSubmittedNotified.has(featureKey)) {
                    allSubmittedNotified.add(featureKey);
                    emitNotification('all-ready', `All complete #${feature.id} ${feature.name} — ready for eval · ${repoShort}`, notifMeta({ featureId: feature.id }));
                }
            });

            // --- Research agent notifications ---
            (repo.research || []).forEach(item => {
                (item.agents || []).forEach(agent => {
                    const key = `${repo.path}:R${item.id}:${agent.id}`;
                    const prev = lastStatusByAgent[key];
                    if (prev && prev !== 'waiting' && agent.status === 'waiting') {
                        emitNotification('agent-waiting', `${agent.id} waiting on R#${item.id} ${item.name} · ${repoShort}`, notifMeta({ researchId: item.id, agentId: agent.id }));
                    }
                    lastStatusByAgent[key] = agent.status;
                    // Sticky idle panel entry for research agents
                    if (agent.idleLadder && agent.idleLadder.state === 'needs-attention' && !stickyIdleNotified.has(key)) {
                        stickyIdleNotified.add(key);
                        emitNotification('agent-needs-attention', `${agent.id} needs attention on R#${item.id} ${item.name} · ${repoShort}`, notifMeta({ researchId: item.id, agentId: agent.id }));
                    } else if (agent.idleState && agent.idleState.level === 'sticky' && !stickyIdleNotified.has(key)) {
                        stickyIdleNotified.add(key);
                        emitNotification('agent-idle-sticky', `${agent.id} idle ${agent.idleState.idleMinutes}m on R#${item.id} ${item.name} · ${repoShort}`, notifMeta({ researchId: item.id, agentId: agent.id }));
                    } else if ((!agent.idleState || agent.idleState.level !== 'sticky') && (!agent.idleLadder || agent.idleLadder.state !== 'needs-attention')) {
                        stickyIdleNotified.delete(key);
                    }
                });

                const researchKey = `${repo.path}:R${item.id}`;
                const researchSmCtx = {
                    agents: (item.agents || []).map(a => a.id),
                    agentStatuses: Object.fromEntries((item.agents || []).map(a => [a.id, a.status])),
                    tmuxSessionStates: {}
                };
                const researchAllSubmitted = item.stage === 'in-progress' && stateMachine.allAgentsSubmitted(researchSmCtx);
                if (researchAllSubmitted && !allSubmittedNotified.has(researchKey)) {
                    allSubmittedNotified.add(researchKey);
                    emitNotification('all-research-ready', `All complete R#${item.id} ${item.name} — ready for synthesis · ${repoShort}`, notifMeta({ researchId: item.id }));
                }
            });
        });
        // Heartbeat sweep, session liveness, and recovery are handled by the
        // supervisor module (lib/supervisor.js) — not in the HTTP polling loop.

        const elapsed = meta.pollStart ? Date.now() - meta.pollStart : 0;
        const repoCount = (latestStatus.repos || []).length;
        const featureCount = (latestStatus.repos || []).reduce((n, r) => n + (r.features || []).length, 0);
        const researchCount = (latestStatus.repos || []).reduce((n, r) => n + (r.research || []).length, 0);
        if (meta.scope === 'repo' && meta.repoPath) {
            log(`Repo refresh complete (${path.basename(path.resolve(meta.repoPath))}, ${featureCount}F/${researchCount}R total, ${elapsed}ms)`);
        } else {
            log(`Poll complete (${repoCount} repos, ${featureCount}F/${researchCount}R, ${elapsed}ms)`);
        }
    }

    // Analytics cache: recompute when pollStatus detects new completed features
    let analyticsCache = null;
    let analyticsLastDoneCount = -1;

    function getOrRecomputeAnalytics() {
        // Count done features across all repos to detect changes
        let doneCount = 0;
        const curRepos = readConductorReposFromGlobalConfig();
        curRepos.forEach(rp => {
            try {
                doneCount += countDoneEntities(rp, 'feature');
            } catch (e) { /* ignore */ }
        });
        if (!analyticsCache || doneCount !== analyticsLastDoneCount) {
            analyticsLastDoneCount = doneCount;
            try {
                analyticsCache = collectAnalyticsData(globalConfig);
            } catch (e) {
                log(`Analytics compute error: ${e.message}`);
                analyticsCache = { generatedAt: new Date().toISOString(), error: e.message };
            }
        }
        return analyticsCache;
    }

    function parsePeriodDays(periodRaw) {
        const m = String(periodRaw || '').trim().match(/^(\d+)([dwm])$/i);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        if (!Number.isFinite(n) || n <= 0) return null;
        if (unit === 'd') return n;
        if (unit === 'w') return n * 7;
        if (unit === 'm') return n * 30;
        return null;
    }

    const dashboardRoutes = createDashboardRouteDispatcher({
        state: {
            getLatestStatus: () => latestStatus,
            setLatestStatus: next => { replaceLatestStatus(next, 'set'); },
            getStatusVersion: () => statusSnapshot.getStatusVersion(),
            getSerializedStatusBody: () => statusSnapshot.getSerializedBody(),
            getGlobalConfig: () => globalConfig,
            setGlobalConfig: next => { globalConfig = next; },
            logsBuffer,
            notificationBuffer,
            getNotificationUnreadCount: () => notificationUnreadCount,
            setNotificationUnreadCount: next => { notificationUnreadCount = next; },
            inflightActions,
            activeActionLogs,
            resetAnalyticsCache: () => { analyticsCache = null; },
        },
        helpers: {
            log,
            logToLogs,
            pollStatus,
            pollRepoStatus,
            registerRepoFsWatch: repoPath => dashboardFsWatch.addRepo(repoPath),
            unregisterRepoFsWatch: repoPath => dashboardFsWatch.removeRepo(repoPath),
            getNotificationConfig,
            emitServerEvent,
            broadcastEvent: (name, data) => sseHub.broadcast(name, data),
            broadcastServerRestarting,
            handleSseEventsRequest: (req, res) => {
                sseHub.handleEventsRequest(req, res, () => statusSnapshot.getStatusVersion());
            },
            getOrRecomputeAnalytics,
            resolveRepoFromPathParam,
            resolveRequestedRepoPath,
            resolveRequestedRepoPathOrRespond,
            findFeatureAgentInStatus,
            inflightKey,
        },
        routes: {
            CLI_ENTRY_PATH,
            DASHBOARD_SETTINGS_SCHEMA: dashboardSettings.DASHBOARD_SETTINGS_SCHEMA,
            parseFeatureSpecFileName,
            safeTmuxSessionExists,
            collectDashboardStatusData,
            collectDashboardStatusDataAsync,
            collectAllFeaturesLean,
            collectDashboardHealth,
            collectFeatureDeepStatus,
            readConductorReposFromGlobalConfig,
            resolveDetailRepoPath: dashboardDetail.resolveDetailRepoPath,
            buildDetailPayload: dashboardDetail.buildDetailPayload,
            appendDependencyGraph: dashboardDetail.appendDependencyGraph,
            platformOpen,
            writeRepoRegistry,
            resolveDashboardSessionCommand: dashboardActionCommand.resolveDashboardSessionCommand,
            buildDashboardActionCommandArgs: dashboardActionCommand.buildDashboardActionCommandArgs,
            handleSpecReconcileApiRequest,
            runDashboardInteractiveAction: dashboardActions.runDashboardInteractiveAction,
            getFeaturePrStatusPayload,
            handleLaunchReview: dashboardActions.handleLaunchReview,
            handleLaunchSpecReview: dashboardActions.handleLaunchSpecReview,
            handleLaunchEval: dashboardActions.handleLaunchEval,
            handleLaunchCloseResolve: dashboardActions.handleLaunchCloseResolve,
            handleLaunchImplementation: dashboardActions.handleLaunchImplementation,
            handleDashboardNudge: dashboardActions.handleDashboardNudge,
            handleDashboardAgentControl: dashboardActions.handleDashboardAgentControl,
            handleDashboardMarkComplete: dashboardActions.handleDashboardMarkComplete,
            readPersistedActionLogs,
            getTmuxSessionPeekMeta,
            parsePeriodDays,
            buildDashboardSettingsPayload: dashboardSettings.buildDashboardSettingsPayload,
            coerceDashboardSettingValue: dashboardSettings.coerceDashboardSettingValue,
            readRawGlobalConfig: dashboardSettings.readRawGlobalConfig,
            setNestedValue,
            getActiveProfile,
        },
        options,
    });

    const WebSocketServer = require('ws').Server;
    const ptyWss = new WebSocketServer({ noServer: true });
    attachPtyWebSocketServer(ptyWss, { tmuxSessionExists });

    const server = http.createServer((req, res) => {
        const reqPath = (req.url || '/').split('?')[0];
        const reqStart = Date.now();
        resetIdleTimer();

        // Log completed response (skip noisy polling/status/assets)
        res.on('finish', () => {
            const isQuiet = reqPath === '/api/status' || reqPath === '/api/events' || reqPath === '/api/sessions' ||
                reqPath === '/favicon.ico' || reqPath.startsWith('/assets/') ||
                reqPath.startsWith('/js/') || reqPath === '/styles.css';
            if (!isQuiet || res.statusCode >= 400) {
                const ms = Date.now() - reqStart;
                const entry = `${req.method} ${reqPath} ${res.statusCode} ${ms}ms`;
                if (res.statusCode >= 500) log.error(entry);
                else if (res.statusCode >= 400) log.warn(entry);
                else log(entry);
            }
        });

        if (dashboardRoutes.dispatchOssRoute(req.method, reqPath, req, res)) {
            return;
        }

        // Pro-owned routes (e.g. /api/insights, /api/insights/refresh) are
        // dispatched through the pro-bridge — see lib/pro-bridge.js. The
        // dashboard server has zero knowledge of which paths Pro owns.
        if (proBridge.dispatchProRoute(req.method, reqPath, req, res)) {
            return;
        }
        // When Pro is not installed, return a stable upgrade payload for the
        // known Pro path prefixes so the frontend can render the upgrade UI
        // without leaking endpoint names into the open-source dashboard.
        if (!isProAvailable() && reqPath.startsWith('/api/insights')) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ proRequired: true, error: 'AADE Insights requires @senlabsai/aigon-pro' }));
            return;
        }

        if (!isProAvailable() && reqPath.startsWith('/api/benchmarks')) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ proRequired: true, error: 'Performance benchmarks require @senlabsai/aigon-pro' }));
            return;
        }

        if (reqPath.startsWith('/assets/')) {
            const assetFile = path.join(ROOT_DIR, reqPath);
            if (fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
                const ext = path.extname(assetFile).toLowerCase();
                const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
                res.writeHead(200, { 'content-type': mime, 'cache-control': 'max-age=86400' });
                res.end(fs.readFileSync(assetFile));
            } else {
                res.writeHead(404);
                res.end();
            }
            return;
        }

        if (reqPath === '/favicon.ico') {
            const icoFile = path.join(ROOT_DIR, 'assets/icon/favicon.ico');
            if (fs.existsSync(icoFile)) {
                res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'max-age=86400' });
                res.end(fs.readFileSync(icoFile));
            } else {
                res.writeHead(204);
                res.end();
            }
            return;
        }

        // Dashboard static JS and CSS modules
        if (reqPath.startsWith('/js/') || reqPath === '/styles.css') {
            // Pro dashboard components: serve from @aigon/pro if available
            if (reqPath === '/js/pro-reports.js') {
                const proFile = dashboardProAssets.resolveProDashboardAsset('pro-reports.js');
                if (proFile) {
                    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(fs.readFileSync(proFile, 'utf8'));
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                res.end(dashboardProAssets.resolveProDashboardStub('pro-reports.js', { templateRoot }));
                return;
            }
            if (reqPath === '/js/insights-dashboard.js' || reqPath === '/js/amplification.js') {
                const proFile = dashboardProAssets.resolveProDashboardAsset('insights-dashboard.js');
                if (proFile) {
                    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(fs.readFileSync(proFile, 'utf8'));
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                res.end(dashboardProAssets.resolveProDashboardStub('insights-dashboard.js', { templateRoot }));
                return;
            }
            if (reqPath === '/js/benchmark-matrix.js') {
                const proFile = dashboardProAssets.resolveProDashboardAsset('benchmark-matrix.js');
                if (proFile) {
                    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(fs.readFileSync(proFile, 'utf8'));
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                res.end(dashboardProAssets.resolveProDashboardStub('benchmark-matrix.js', { templateRoot }));
                return;
            }
            if (reqPath === '/js/backup-sync.js') {
                const proFile = dashboardProAssets.resolveProDashboardAsset('backup-sync.js');
                if (proFile) {
                    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(fs.readFileSync(proFile, 'utf8'));
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                res.end(dashboardProAssets.resolveProDashboardStub('backup-sync.js', { templateRoot }));
                return;
            }
            if (reqPath === '/js/scheduled-features.js') {
                const proFile = dashboardProAssets.resolveProDashboardAsset('scheduled-features.js');
                if (proFile) {
                    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(fs.readFileSync(proFile, 'utf8'));
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                const proMissingSchedUi = isProAvailable();
                res.end(proMissingSchedUi ? `export function renderScheduledFeatures() {
  var c = document.getElementById('scheduled-features-view');
  if (!c) return;
  c.innerHTML = '<p class="settings-empty" style="margin-top:4px;font-size:12px;color:var(--text-tertiary)">' +
    'Pro is active but <code>dashboard/scheduled-features.js</code> is missing from your <code>@senlabsai/aigon-pro</code> install. Run <code>npm update -g @senlabsai/aigon-pro</code> to fix.</p>';
}
Object.assign(globalThis, { renderScheduledFeatures });` : `export function renderScheduledFeatures() {
  var c = document.getElementById('scheduled-features-view');
  if (!c) return;
  c.innerHTML = '<p class="settings-empty" style="margin-top:4px;font-size:12px;color:var(--text-tertiary)">' +
    'Install <code>@senlabsai/aigon-pro</code> for recurring batch scheduling details here.</p>';
}
Object.assign(globalThis, { renderScheduledFeatures });`);
                return;
            }
            if (reqPath === '/js/failover-dashboard.js') {
                const proFile = dashboardProAssets.resolveProDashboardAsset('failover-dashboard.js');
                if (proFile) {
                    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(fs.readFileSync(proFile, 'utf8'));
                    return;
                }
                // Pro not available — empty stub (no failover UI)
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                res.end('/* failover-dashboard: aigon-pro not installed */');
                return;
            }
            if (reqPath === '/styles.css') {
                try {
                    const css = dashboardStyles.concatDashboardStyles(templateRoot);
                    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(css);
                } catch (err) {
                    log.error(`styles.css concat failed: ${err.message || err}`);
                    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
                    res.end('styles.css unavailable');
                }
                return;
            }
            const dashFile = path.join(templateRoot, 'templates', 'dashboard', reqPath);
            if (fs.existsSync(dashFile) && fs.statSync(dashFile).isFile()) {
                const ext = path.extname(dashFile).toLowerCase();
                const mime = ext === '.css' ? 'text/css' : 'text/javascript';
                res.writeHead(200, { 'content-type': mime + '; charset=utf-8', 'cache-control': 'no-store' });
                res.end(fs.readFileSync(dashFile, 'utf8'));
            } else {
                res.writeHead(404);
                res.end();
            }
            return;
        }

        const html = buildDashboardHtml(
            buildDashboardBootstrapData(latestStatus),
            instanceName,
            isPreview ? templateRoot : null,
            { globalConfig }
        );
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
    });

    server.on('error', (err) => {
        log.error(`Server error: ${err.stack || err.message || err}`);
        if (err.code === 'EADDRINUSE') {
            // Port is already held by another process (often a stale server
            // process that wasn't cleaned up by `aigon server restart`). Staying alive
            // here is harmful — the process would have no HTTP server and no poll loop,
            // silently doing nothing. Exit so the caller knows the start failed.
            log.error(`Port ${port} already in use — exiting so the caller can retry`);
            process.exit(1);
        }
    });

    const registryServerId = serverId || '';

    const shutdown = (sig) => {
        log(`Dashboard shutting down (PID ${process.pid}, ppid=${process.ppid})${sig ? ` — ${sig}` : ''}`);
        try { dashboardFsWatch.stop(); } catch (_) { /* best-effort */ }
        // Caddy route is intentionally NOT removed on shutdown.
        // The route persists in the Caddyfile — Caddy returns 502 while the
        // dashboard is down and auto-recovers when it restarts.
        const exitTimer = setTimeout(() => { log('Forced exit after shutdown timeout'); process.exit(0); }, 3000);
        exitTimer.unref();
        server.close(() => process.exit(0));
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Crash logging — catch unhandled errors so they're written to the log file
    // instead of silently hanging or dying without a trace
    // Crash resilience — log errors but do NOT exit the process.
    // A proper daemon survives transient failures (missing dirs, bad polls, etc.)
    let uncaughtCount = 0;
    function logMemory(label) {
        const mem = process.memoryUsage();
        log(`${label} — rss=${Math.round(mem.rss / 1024 / 1024)}MB heap=${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB ext=${Math.round(mem.external / 1024 / 1024)}MB`);
    }

    process.on('uncaughtException', (err) => {
        // EPIPE = client disconnected mid-response — harmless, don't count it
        if (err && err.code === 'EPIPE') {
            log(`EPIPE (client disconnected) — suppressed`);
            return;
        }
        uncaughtCount++;
        log.error(`uncaughtException #${uncaughtCount}: ${err.stack || err.message || err}`);
        logMemory('ERROR memory at crash');
        // Don't use console.error here — if stderr is broken (EPIPE), it triggers
        // another uncaughtException, cascading to rapid shutdown.
        // Only exit if we're getting hammered (5+ crashes in rapid succession = something systemic)
        if (uncaughtCount >= 5) {
            log.error(`Too many uncaught exceptions (${uncaughtCount}), shutting down`);
            process.exit(1);
        }
    });
    process.on('unhandledRejection', (reason) => {
        const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
        log.error(`unhandledRejection: ${msg}`);
        logMemory('ERROR memory at rejection');
    });
    // Note: SIGINT and SIGTERM are already handled by the shutdown() function above.
    // Logging the signal name there keeps the shutdown sequence visible in the log.
    // Catch additional signals that could silently kill the process
    for (const sig of ['SIGHUP', 'SIGUSR1', 'SIGUSR2', 'SIGPIPE']) {
        try {
            process.on(sig, () => { log(`Signal received: ${sig} — ignoring`); });
        } catch (_) { /* some signals not supported on all platforms */ }
    }

    // Log memory every 5 minutes so we can spot leaks before a crash
    setInterval(() => logMemory('Heartbeat memory'), 5 * 60 * 1000).unref();

    // Log before any exit so there's always a trace in the file
    const _origExit = process.exit.bind(process);
    process.exit = (code) => {
        log(`──── Dashboard exiting (code=${code ?? 0}, pid=${process.pid}) ────`);
        logMemory('Exit memory');
        _origExit(code);
    };

    server.on('upgrade', (req, socket, head) => {
        const pathname = (req.url || '').split('?')[0];
        if (pathname.match(/^\/api\/session\/pty\//)) {
            ptyWss.handleUpgrade(req, socket, head, (ws) => {
                ptyWss.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    server.listen(port, host, () => {
        // Write the dashboard route to the Caddyfile (persistent — survives crashes)
        try {
            const hostname = buildCaddyHostname(appId, registryServerId || null);
            addCaddyRoute(hostname, port, registryServerId ? `Dashboard: ${registryServerId}` : 'Dashboard');
        } catch (_) { /* non-fatal if Caddy not installed */ }
        // Sweep stale scheduled-kickoff lock files from all registered repos on
        // startup. Locks older than 30s are guaranteed crash-orphans — no live
        // process holds them. Leaving them causes withStoreLockSync to busy-spin
        // the event loop for 8s per repo per poll cycle, pegging CPU at ~97%.
        try {
            const repos = readConductorReposFromGlobalConfig();
            for (const repo of repos) {
                const lockPath = path.join(repo.path || repo, '.aigon', 'state', 'scheduled-kickoffs.json.lock');
                try {
                    const stat = fs.statSync(lockPath);
                    if (Date.now() - stat.mtimeMs > 30_000) {
                        fs.rmSync(lockPath, { force: true });
                        log(`startup: removed stale lock ${lockPath}`);
                    }
                } catch (_) { /* file absent — fine */ }
            }
        } catch (_) { /* non-fatal */ }

        // Write runtime stamp so drift-notice can detect dashboard version lag.
        try {
            const { getDashboardRuntimePath } = require('./global-config-migration');
            const { resolveInstanceIdentity } = require('./instance-identity');
            const identity = resolveInstanceIdentity();
            const slotId = (identity.isPrimary || identity.isEphemeral)
                ? 'main'
                : (options.instanceId || identity.instanceId);
            const runtimePath = getDashboardRuntimePath(slotId);
            const runtimeDir = require('path').dirname(runtimePath);
            if (!require('fs').existsSync(runtimeDir)) require('fs').mkdirSync(runtimeDir, { recursive: true });
            require('fs').writeFileSync(runtimePath, JSON.stringify({
                version: (() => { try { return require('../package.json').version; } catch (_) { return null; } })(),
                pid: process.pid,
                port,
                instanceId: slotId,
                startedAt: new Date().toISOString(),
            }));
        } catch (_) { /* non-fatal */ }

        // F521: warn about stale user-scope keys in any registered project config.
        try {
            const { listStaleUserScopeProjectOverrides, loadProjectConfig } = require('./config');
            const repos = readConductorReposFromGlobalConfig();
            const seen = new Set();
            for (const repo of repos) {
                const repoPath = repo.path || repo;
                if (!repoPath || seen.has(repoPath)) continue;
                seen.add(repoPath);
                let projectConfig = {};
                try { projectConfig = loadProjectConfig(repoPath) || {}; } catch (_) { continue; }
                const stale = listStaleUserScopeProjectOverrides(projectConfig);
                if (stale.length) {
                    console.warn(`⚠️  ${repoPath}: ignoring stale per-repo user-scope keys: ${stale.join(', ')}`);
                }
            }
        } catch (_) { /* non-fatal */ }

        log(`Dashboard started (PID ${process.pid}, port ${port}${isPreview ? ', preview mode' : ''})`);
        const modeLabel = isPreview ? '🔀 Preview' : '🚀 Dashboard';
        if (proxyUrl) {
            console.log(`${modeLabel}: ${proxyUrl}  (also: ${localUrl})`);
        } else {
            console.log(`${modeLabel}: ${localUrl}`);
        }
        if (isPreview) {
            console.log(`   Templates: ${templateRoot}/templates/dashboard/`);
        }
        console.log('   Press Ctrl+C to stop');
        console.log(`   Log: ${DASHBOARD_LOG_FILE}`);
        function scheduleNextPoll() {
            if (pollLoopTimer) clearTimeout(pollLoopTimer);
            log(`Next safety-net poll in ${POLL_INTERVAL_SAFETY_MS / 1000}s`);
            pollLoopTimer = setTimeout(() => {
                pollStatus()
                    .catch(e => log.error(`Poll loop error: ${e && e.message}`))
                    .finally(() => scheduleNextPoll());
            }, POLL_INTERVAL_SAFETY_MS).unref();
        }
        // Warm the first snapshot asynchronously so HTTP can bind immediately.
        pollStatus()
            .catch(e => log.error(`Initial poll failed: ${e && e.message}`))
            .finally(() => {
                try { dashboardFsWatch.start(); } catch (e) { log(`[fs-watch] start failed: ${e && e.message}`); }
                scheduleNextPoll();
            });
        // Start supervisor loop if injected via serverOptions (zero-import contract)
        if (typeof options.startSupervisorLoop === 'function') {
            const { setSweepSkipGuard } = require('./supervisor');
            setSweepSkipGuard(() => !!pollInFlightPromise);
            options.startSupervisorLoop();
        }
        // Recurring-feature spawning, scheduled-kickoff polling, and scheduled
        // vault backup all moved to @aigon/pro with feature 236. Pro starts
        // those pollers inside its own register(api) hook (lib/pro-bridge.js
        // dispatches on server start), so OSS no longer auto-creates weekly
        // batches or pushes the vault on its own.
        try {
            agentQuotaPoller.startAgentQuotaPoller({
                repoPath: process.cwd(),
                log,
                onRefresh: emitServerEvent,
            });
        } catch (e) {
            log(`Agent quota poller failed to start: ${e && e.message}`);
        }
        try {
            storagePoller.startStoragePoller({ repoPath: process.cwd(), log });
        } catch (e) {
            log(`Storage poller failed to start: ${e && e.message}`);
        }
        resetIdleTimer();
        // Never auto-open the browser — the user already has it open or will
        // navigate there themselves. Auto-opening is especially disruptive when
        // launchd restarts the server or during `aigon apply`.
        // Use `aigon server open` to open explicitly.
    });
}

module.exports = {
    DASHBOARD_SETTINGS_SCHEMA: dashboardSettings.DASHBOARD_SETTINGS_SCHEMA,
    readConductorReposFromGlobalConfig,
    parseSimpleFrontMatter: dashboardDetail.parseSimpleFrontMatter,
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    safeTmuxSessionExists,
    collectDashboardStatusData,
    escapeForHtmlScript,
    buildDashboardHtml,
    buildDetailPayload: dashboardDetail.buildDetailPayload,
    captureDashboardScreenshot,
    writeRepoRegistry,
    sendMacNotification,
    DASHBOARD_INTERACTIVE_ACTIONS: dashboardActionCommand.DASHBOARD_INTERACTIVE_ACTIONS,
    resolveDashboardActionRepoPath: dashboardActionCommand.resolveDashboardActionRepoPath,
    parseDashboardActionRequest: dashboardActionCommand.parseDashboardActionRequest,
    buildDashboardActionCommandArgs: dashboardActionCommand.buildDashboardActionCommandArgs,
    verifyFeatureStartRegistration: dashboardActionCommand.verifyFeatureStartRegistration,
    runDashboardInteractiveAction: dashboardActions.runDashboardInteractiveAction,
    handleSpecReconcileApiRequest,
    resolveFeatureBranchForPrStatus,
    getFeaturePrStatusPayload,
    runDashboardServer,
};
