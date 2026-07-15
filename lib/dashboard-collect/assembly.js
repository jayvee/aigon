'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getCachedUpdateCheck, checkForUpdate } = require('../npm-update-check');
const { isProAvailable, getProStatus } = require('../pro');
const { readDashboardPollRepos, getProjectConfigPath, getConfigValueWithProvenance } = require('../config');
const { getAppId, parseCaddyRoutes } = require('../proxy');
const probeTtlCache = require('../probe-ttl-cache');
const {
    buildRepoStorageStatus,
    buildRepoStorageActions,
    attachActiveLeasesToEntities,
} = require('../dashboard-storage');
const { PROBE_TTLS_MS } = require('./constants');
const { getTierCache, clearTierCache } = require('./tier-cache');
const {
    detectGitHubRemote,
    applyPendingScheduleMetadata,
    applySpecReviewFromSnapshots,
    getDevServerState,
} = require('./infra-probes');
const { collectFeatures } = require('./feature-poll');
const { collectResearch } = require('./collect-research');
const { collectFeedback } = require('./collect-feedback');
const { readRedMainCondition } = require('../red-main-condition');

function nowMs() {
    return Number(process.hrtime.bigint()) / 1e6;
}

function beginCollectRepoStatus(absRepoPath, options = {}) {
    const perfEnabled = options.collectPerf === true;
    const perfStart = perfEnabled ? nowMs() : 0;
    const perfSteps = [];
    const markPerf = perfEnabled
        ? (step, startMs) => { perfSteps.push({ step, ms: Math.round((nowMs() - startMs) * 100) / 100 }); }
        : null;
    if (!fs.existsSync(absRepoPath)) return null;

    const { getActiveProfile } = require('../config');
    let profile;
    try {
        profile = getActiveProfile(absRepoPath);
    } catch (_) {
        return null;
    }

    const devServerEnabled = profile.devServer.enabled;
    const repoAppId = getAppId(absRepoPath);
    const caddyRoutes = devServerEnabled
        ? probeTtlCache.getOrCompute(
            `caddy-routes:${absRepoPath}`,
            PROBE_TTLS_MS.caddyRoutes,
            () => parseCaddyRoutes()
        )
        : [];
    const mainDevServer = getDevServerState(caddyRoutes, repoAppId, '');
    const stateDir = path.join(absRepoPath, '.aigon', 'state');
    const closingFeatureIdsByRepo = options.closingFeatureIdsByRepo;
    const repoClosingFeatureIds = closingFeatureIdsByRepo && typeof closingFeatureIdsByRepo.get === 'function'
        ? closingFeatureIdsByRepo.get(path.resolve(absRepoPath))
        : null;
    const repoContext = {
        absRepoPath,
        stateDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
        closingFeatureIds: repoClosingFeatureIds || null,
    };

    return {
        perfEnabled,
        perfStart,
        perfSteps,
        markPerf,
        devServerEnabled,
        mainDevServer,
        repoContext,
    };
}

function assembleRepoStatusAfterFeatures(absRepoPath, response, options, assemblyCtx) {
    const {
        featureStatus,
        repoContext,
        perfEnabled,
        perfStart,
        perfSteps,
        markPerf,
        devServerEnabled,
        mainDevServer,
    } = assemblyCtx;
    let t = perfEnabled ? nowMs() : 0;
    const researchStatus = collectResearch(repoContext, response);
    if (markPerf) markPerf('research', t);
    try {
        const { getPro } = require('../pro');
        const pro = getPro();
        const buildPendingScheduleIndex = pro && pro.scheduledKickoff && pro.scheduledKickoff.buildPendingScheduleIndex;
        if (typeof buildPendingScheduleIndex !== 'function') throw new Error('no-pro-scheduler');
        const schedIdx = probeTtlCache.getOrCompute(
            `schedule-index:${absRepoPath}`,
            PROBE_TTLS_MS.scheduleIndex,
            () => buildPendingScheduleIndex(absRepoPath)
        );
        (featureStatus.features || []).forEach((f) => {
            const hit = schedIdx.lookupFeature(f.id);
            if (hit) applyPendingScheduleMetadata(f, hit);
        });
        (researchStatus.research || []).forEach((r) => {
            const hit = schedIdx.lookupResearch(r.id);
            if (hit) applyPendingScheduleMetadata(r, hit);
        });
        if (typeof schedIdx.lookupSet === 'function') {
            (featureStatus.sets || []).forEach((set) => {
                const hit = schedIdx.lookupSet(set.slug);
                if (hit) applyPendingScheduleMetadata(set, hit, 'set_autonomous');
            });
        }
    } catch (_) { /* non-fatal: schedule store optional */ }
    t = perfEnabled ? nowMs() : 0;
    applySpecReviewFromSnapshots(absRepoPath, [
        ...featureStatus.features.map(item => ({ item, entityType: 'feature' })),
        ...researchStatus.research.map(item => ({ item, entityType: 'research' })),
    ]);
    if (markPerf) markPerf('spec-review-snapshots', t);
    t = perfEnabled ? nowMs() : 0;
    const feedbackStatus = collectFeedback(absRepoPath);
    if (markPerf) markPerf('feedback', t);
    const tierCache = getTierCache(absRepoPath);
    t = perfEnabled ? nowMs() : 0;
    tierCache.cold.githubRemote = probeTtlCache.getOrCompute(
        `github-remote:${absRepoPath}`,
        PROBE_TTLS_MS.gitRemote,
        () => {
            let ghEnabled = detectGitHubRemote(absRepoPath);
            if (ghEnabled) {
                try {
                    const projectCfg = JSON.parse(require('fs').readFileSync(getProjectConfigPath(absRepoPath), 'utf8'));
                    if (projectCfg && projectCfg.github && projectCfg.github.prCheck === false) ghEnabled = false;
                } catch (_) { /* no project config — keep auto-detected value */ }
            }
            return ghEnabled;
        }
    );
    if (markPerf) markPerf('github-remote', t);

    const storage = probeTtlCache.getOrCompute(
        `storage-status:${absRepoPath}`,
        PROBE_TTLS_MS.storageStatus,
        () => buildRepoStorageStatus(absRepoPath),
    );
    attachActiveLeasesToEntities(absRepoPath, featureStatus.features, 'feature');
    attachActiveLeasesToEntities(absRepoPath, researchStatus.research, 'research');

    // F679: temporary preview switch for the contract-driven card renderer
    // (dashboard.contractCards, default off — removed by F682). Resolved fresh
    // each collect so a settings toggle repaints on the next poll.
    let contractCardsPreview = false;
    try {
        contractCardsPreview = getConfigValueWithProvenance('dashboard.contractCards', absRepoPath).value === true;
    } catch (_) { /* unreadable config — keep the default-off renderer */ }

    const result = {
        path: absRepoPath,
        displayPath: absRepoPath.replace(os.homedir(), '~'),
        name: path.basename(absRepoPath),
        githubRemote: tierCache.cold.githubRemote,
        contractCardsPreview,
        redMainCondition: readRedMainCondition(absRepoPath),
        storage,
        validActions: buildRepoStorageActions(storage),
        ...featureStatus,
        ...researchStatus,
        ...feedbackStatus,
        mainDevServerEligible: Boolean(devServerEnabled),
        mainDevServerRunning: mainDevServer.running,
        mainDevServerUrl: mainDevServer.url
    };
    if (perfEnabled) {
        result._perf = {
            name: result.name,
            totalMs: Math.round((nowMs() - perfStart) * 100) / 100,
            steps: perfSteps,
            featureCount: (featureStatus.features || []).length,
            researchCount: (researchStatus.research || []).length,
        };
    }
    return result;
}

function collectRepoStatus(absRepoPath, response, options = {}) {
    const begin = beginCollectRepoStatus(absRepoPath, options);
    if (!begin) return null;

    let t = begin.perfEnabled ? nowMs() : 0;
    const featureStatus = collectFeatures(begin.repoContext, response);
    if (begin.markPerf) begin.markPerf('features', t);
    return assembleRepoStatusAfterFeatures(absRepoPath, response, options, {
        ...begin,
        featureStatus,
    });
}

async function collectRepoStatusAsync(absRepoPath, response, options = {}) {
    const begin = beginCollectRepoStatus(absRepoPath, options);
    if (!begin) return null;

    let t = begin.perfEnabled ? nowMs() : 0;
    const featureStatus = await collectFeatures(
        { ...begin.repoContext, yieldDuringWorkflowScan: true },
        response
    );
    if (begin.markPerf) begin.markPerf('features', t);
    return assembleRepoStatusAfterFeatures(absRepoPath, response, options, {
        ...begin,
        featureStatus,
    });
}

function collectAllFeaturesLean(absRepoPath) {
    if (!fs.existsSync(absRepoPath)) return [];
    const stateDir = path.join(absRepoPath, '.aigon', 'state');
    const repoContext = {
        absRepoPath,
        stateDir,
        devServerEnabled: false,
        caddyRoutes: [],
        repoAppId: getAppId(absRepoPath),
        includeAllFeatures: true,
    };
    const throwaway = { summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 } };
    const featureStatus = collectFeatures(repoContext, throwaway);
    return featureStatus.allFeatures || [];
}

let _npmCheckScheduled = false;
function scheduleNpmUpdateCheck() {
    if (_npmCheckScheduled) return;
    _npmCheckScheduled = true;
    checkForUpdate().catch(() => {}).finally(() => { _npmCheckScheduled = false; });
}

function collectDashboardStatusData(options = {}) {
    const perfEnabled = options.collectPerf === true;
    const perfStart = perfEnabled ? nowMs() : 0;
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 },
        proAvailable: isProAvailable(),
        proStatus: getProStatus(),
        updateCheck: getCachedUpdateCheck(),
    };

    readDashboardPollRepos().forEach(repoPath => {
        const repoStatus = collectRepoStatus(path.resolve(repoPath), response, options);
        if (!repoStatus) return;
        if (perfEnabled && repoStatus._perf) {
            if (!response._perf) response._perf = { totalMs: 0, repos: [] };
            response._perf.repos.push(repoStatus._perf);
            delete repoStatus._perf;
        }
        response.repos.push(repoStatus);
    });

    scheduleNpmUpdateCheck();
    if (perfEnabled) {
        response._perf = response._perf || { repos: [] };
        response._perf.totalMs = Math.round((nowMs() - perfStart) * 100) / 100;
    }

    return response;
}

async function collectDashboardStatusDataAsync(options = {}) {
    const perfEnabled = options.collectPerf === true;
    const perfStart = perfEnabled ? nowMs() : 0;
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 },
        proAvailable: isProAvailable(),
        proStatus: getProStatus(),
        updateCheck: getCachedUpdateCheck(),
    };

    const repoPaths = readDashboardPollRepos();
    for (const repoPath of repoPaths) {
        await new Promise(resolve => setImmediate(resolve));
        const repoStatus = await collectRepoStatusAsync(path.resolve(repoPath), response, options);
        if (!repoStatus) continue;
        if (perfEnabled && repoStatus._perf) {
            if (!response._perf) response._perf = { totalMs: 0, repos: [] };
            response._perf.repos.push(repoStatus._perf);
            delete repoStatus._perf;
        }
        response.repos.push(repoStatus);
    }

    scheduleNpmUpdateCheck();
    if (perfEnabled) {
        response._perf = response._perf || { repos: [] };
        response._perf.totalMs = Math.round((nowMs() - perfStart) * 100) / 100;
    }

    return response;
}

function collectDashboardHealth() {
    const startedAt = new Date().toISOString();
    const status = collectDashboardStatusData();
    return {
        ok: true,
        startedAt,
        completedAt: new Date().toISOString(),
        repoCount: Array.isArray(status.repos) ? status.repos.length : 0,
    };
}

function rebuildDashboardSummary(repos) {
    const summary = { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 };
    const completeStatuses = new Set([
        'implementation-complete',
        'revision-complete',
        'research-complete',
        'review-complete',
        'spec-review-complete',
    ]);
    for (const repo of repos || []) {
        for (const feature of repo.features || []) {
            for (const agent of feature.agents || []) {
                summary.total++;
                if (completeStatuses.has(agent.status)) {
                    summary.complete = (summary.complete || 0) + 1;
                } else {
                    summary[agent.status] = (summary[agent.status] || 0) + 1;
                }
            }
        }
        for (const research of repo.research || []) {
            for (const agent of research.agents || []) {
                summary.total++;
                if (completeStatuses.has(agent.status)) {
                    summary.complete = (summary.complete || 0) + 1;
                } else {
                    summary[agent.status] = (summary[agent.status] || 0) + 1;
                }
            }
        }
    }
    return summary;
}

function refreshRepoInDashboardStatus(currentStatus, repoPath, options = {}) {
    const { clearRepoSpecIndexCache } = require('../dashboard-spec-index');
    const absPath = path.resolve(repoPath);
    clearTierCache(absPath);
    clearRepoSpecIndexCache(absPath);

    const summaryScratch = { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 };
    const repoStatus = collectRepoStatus(absPath, { summary: summaryScratch }, options);

    const repos = [...((currentStatus && currentStatus.repos) || [])];
    const idx = repos.findIndex(r => path.resolve(String(r.path || '')) === absPath);
    if (repoStatus) {
        if (idx >= 0) repos[idx] = repoStatus;
        else repos.push(repoStatus);
    } else if (idx >= 0) {
        repos.splice(idx, 1);
    }

    return {
        ...(currentStatus || {}),
        generatedAt: new Date().toISOString(),
        repos,
        summary: rebuildDashboardSummary(repos),
    };
}

module.exports = {
    collectDashboardStatusData,
    collectDashboardStatusDataAsync,
    collectDashboardHealth,
    collectRepoStatus,
    collectRepoStatusAsync,
    collectAllFeaturesLean,
    clearTierCache,
    rebuildDashboardSummary,
    refreshRepoInDashboardStatus,
};
