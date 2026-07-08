'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const agentRegistry = require('../../agent-registry');
const installManifestLib = require('../../install-manifest');
const { loadProjectConfig } = require('../../config');
const seedReset = require('./seed-reset');
const worktreeCleanup = require('./worktree-cleanup');
const gitignoreAndHooks = require('./gitignore-and-hooks');
const pidUtils = require('./pid-utils');
const agentTrust = require('./agent-trust');
const { runInitBootstrap, printFirstTimeNextStepHint } = require('./init-bootstrap');

const {
    WORKING_REPO_REGISTRY,
    SEED_REGISTRY,
    rebuildSeedFeatureManifests,
    validateSeedProvisionCommits,
    collectSeedResetRemoteUrls,
    stripSeedResetStaleConfigKeys,
    applySeedStateFixtures,
} = seedReset;

const { expandHomePath, listExistingAigonWorktrees } = worktreeCleanup;

const {
    wrapAigonCommand,
    migrateAigonHookCommand,
    ensureEnvLocalGitignore,
    ensureLocalGitExclude,
    getStandardLocalGitExcludeEntries,
    ensurePreCommitHook,
    ensureHooksPathConfigured,
    getEnvLocalGitignoreStatus,
    getTrackedEnvLocalFiles,
    gitAddPathsFromPorcelain,
} = gitignoreAndHooks;

const { listRepoRelatedPids, killPidsHard } = pidUtils;

const {
    findEntitiesMissingWorkflowState,
    bootstrapMissingWorkflowSnapshots,
} = agentTrust;

module.exports = function checkVersionCommand(ctx, getCommand) {
    const u = ctx.utils;
    const versionLib = ctx.version;
    const {
        PATHS,
        SPECS_ROOT,
        MARKER_START,
        MARKER_END,
        COMMAND_ALIASES,
        COMMAND_ALIAS_REVERSE,
        showPortSummary,
        getActiveProfile,
        getAvailableAgents,
        loadAgentConfig,
        buildAgentAliasMap,
        resolveAgentCommands,
        readTemplate,
        readGenericTemplate,
        processTemplate,
        safeWrite,
        safeWriteWithStatus,
        upsertMarkedContent,
        extractDescription,
        formatCommandOutput,
        getProfilePlaceholders,
        computeInstructionsConfigHash,
        computeAppliedDigest,
        computeAppliedDigestDetailed,
        readAppliedDigest,
        writeAppliedDigest,
        buildDriftSummary,
        removeDeprecatedCommands,
        removeDeprecatedSkillDirs,
        renderSkillMd,
        getStatusRaw,
    } = u;
    const {
        getAigonVersion,
        getInstalledVersion,
        setInstalledVersion,
        compareVersions,
        getChangelogEntriesSince,
        checkAigonCliOrigin,
    } = versionLib;
    const { ensureBoardMapInGitignore } = ctx.board;

    return async (args) => {
            // --notice-only: read-only drift notice for hooks/launchers. No mutations.
            if (args.includes('--notice-only')) {
                const { getRepoVersionStatus, formatDriftNotice } = require('../../version-status');
                const status = getRepoVersionStatus();
                const notice = formatDriftNotice(status);
                if (notice) process.stdout.write(notice);
                return;
            }

            const jsonOutput = args.includes('--json');
            const collectedMessages = [];
            let origLog, origWarn;
            if (jsonOutput) {
                origLog = console.log.bind(console);
                origWarn = console.warn.bind(console);
                console.log = (...a) => collectedMessages.push(a.map(String).join(' '));
                console.warn = (...a) => collectedMessages.push(a.map(String).join(' '));
            }
            const currentVersion = getAigonVersion();
            const installedVersion = getInstalledVersion();
            const runGlobalConfigMigrations = async () => {
                const { runPendingGlobalConfigMigrations } = require('../../global-config-migration');
                return runPendingGlobalConfigMigrations(installedVersion || '0.0.0', {
                    log: (message) => console.log(message),
                });
            };

            if (!currentVersion) {
                console.error('❌ Could not determine Aigon CLI version');
                process.exit(1);
            }

            // Start npm registry check early (async — collect result later)
            const { checkForUpdate, formatUpdateNotice } = require('../../npm-update-check');
            const npmCheckPromise = checkForUpdate().catch(() => null);

            // Check if aigon CLI source is behind origin
            const { behind, error: originError } = checkAigonCliOrigin();
            if (behind > 0) {
                console.log(`⬆️  Aigon CLI is ${behind} commit${behind === 1 ? '' : 's'} behind origin. Run \`npm update -g @senlabsai/aigon\` to upgrade the CLI, then \`aigon apply\` to sync this project.`);
            } else if (originError) {
                console.warn(`⚠️  Could not check for a CLI upgrade from origin: ${originError}`);
            }

            // Digest-based drift detection (F497): compare content hashes, not semver.
            // .aigon/version is human-readable provenance only.
            let drifted = false;
            let driftReason = '';
            try {
                const storedDigest = readAppliedDigest(process.cwd());
                if (!storedDigest) {
                    // No applied-digest: could be pre-F497 repo or never applied
                    const hasLegacyHash = fs.existsSync(path.join(process.cwd(), '.aigon', 'config-hash'));
                    const hasVersion = Boolean(installedVersion);
                    if (hasVersion || hasLegacyHash) {
                        // Repo has been applied before but with old semver-only tracking — treat as drift
                        drifted = true;
                        driftReason = 'upgrade required';
                    } else {
                        // Fresh repo, never applied
                        drifted = true;
                        driftReason = 'not applied';
                    }
                } else {
                    const current = computeAppliedDigestDetailed(process.cwd());
                    if (storedDigest.digest !== current.digest) {
                        drifted = true;
                        const summary = buildDriftSummary(storedDigest, current);
                        driftReason = summary || 'templates changed';
                    }
                }
            } catch (e) {
                // Non-fatal — fall back to advisory
                console.warn(`⚠️  Could not check applied digest: ${e.message}`);
            }

            if (drifted) {
                const appliedAt = installedVersion ? ` (applied: v${installedVersion})` : '';
                console.log(`🔄 Project out of date${appliedAt} — ${driftReason}. Run \`aigon apply\` to sync.`);
            } else if (behind === 0) {
                try {
                    await runGlobalConfigMigrations();
                } catch (e) {
                    console.warn(`⚠️  Global config migration check failed: ${e.message}`);
                }
                const appliedAt = installedVersion ? ` (applied: v${installedVersion})` : '';
                console.log(`✅ Aigon is current and up to date${appliedAt}`);
            }

            // Show npm registry notice (non-blocking — collected after sync work)
            try {
                const npmResult = await npmCheckPromise;
                const notice = formatUpdateNotice(npmResult);
                if (notice) console.log(notice);
            } catch (_) {
                // npm check is advisory only — never fail check-version over it
            }
            if (jsonOutput) {
                console.log = origLog;
                console.warn = origWarn;
                const msg = collectedMessages.join('\n').trim();
                process.stdout.write(msg ? JSON.stringify({ systemMessage: msg }) : '{}');
            }
    };
};
