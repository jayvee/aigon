'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { readAgentStatus, getStateDir } = require('../agent-status');
const agentRegistry = require('../agent-registry');
const { runSecurityScan } = require('../security');
const telemetry = require('../telemetry');
const entity = require('../entity');
const { buildActionContext, assertActionAllowed } = require('../action-scope');
const featureSpecResolver = require('../feature-spec-resolver');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const wf = require('../workflow-core');
const { getSnapshotPath } = require('../workflow-core/paths');
const { parseFeatureSpecFileName } = require('../dashboard-status-helpers');
const { collectFeatureDeepStatus, writeStats } = require('../feature-status');
const { matchTmuxSessionByEntityId } = require('../worktree');

// ---------------------------------------------------------------------------
// Shared effect executor — handles all effect types across commands
// ---------------------------------------------------------------------------

async function defaultEffectExecutor(repoPath, featureId, effect) {
    const fsp = require('fs/promises');

    if (effect.type === 'move_spec') {
        const { fromPath, toPath } = effect.payload;
        await fsp.mkdir(path.dirname(toPath), { recursive: true });
        try { await fsp.access(fromPath); } catch { return; } // Source already moved
        try { await fsp.access(toPath); return; } catch {} // Target already exists
        await fsp.rename(fromPath, toPath);
        return;
    }

    if (effect.type === 'init_log') {
        const { agentId, num, desc } = effect.payload;
        const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
        await fsp.mkdir(logsDir, { recursive: true });
        const logName = agentId
            ? `feature-${num}-${agentId}-${desc}-log.md`
            : `feature-${num}-${desc}-log.md`;
        const logPath = path.join(logsDir, logName);
        try { await fsp.access(logPath); return; } catch {} // Already exists
        const logTemplate = `# Implementation Log: Feature ${num} - ${desc}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
        await fsp.writeFile(logPath, logTemplate, 'utf8');
        return;
    }

    if (effect.type === 'write_eval_stub') {
        return; // No-op — eval stub is optional
    }

    if (effect.type === 'write_close_note') {
        const { winnerAgentId } = effect.payload;
        const closePath = path.join(wf.getFeatureRoot(repoPath, featureId), 'closeout.md');
        await fsp.mkdir(path.dirname(closePath), { recursive: true });
        const body = [
            `# Feature ${featureId} Closeout`,
            '',
            `Winner: ${winnerAgentId || 'solo'}`,
            `Closed at: ${new Date().toISOString()}`,
            '',
        ].join('\n');
        await fsp.writeFile(closePath, body, 'utf8');
        return;
    }
}

// Helper: persist effect events and run them
async function persistAndRunEffects(repoPath, featureId, effects, options = {}) {
    if (effects.length > 0) {
        const now = new Date().toISOString();
        await wf.persistEvents(
            repoPath,
            featureId,
            effects.map((effect) => ({ type: 'effect.requested', effect, at: now })),
        );
    }
    const result = await wf.runPendingEffects(repoPath, featureId, defaultEffectExecutor, options);
    if (result.kind === 'busy') {
        return {
            kind: 'busy',
            message: 'Effects are being executed by another process. Re-run with --reclaim to force.',
        };
    }
    return { kind: 'complete', snapshot: result.snapshot };
}

// Helper: resolve FeatureMode from agent count
function resolveFeatureMode(agentIds) {
    if (agentIds.length > 1) return wf.FeatureMode.FLEET;
    if (agentIds.length === 1) return wf.FeatureMode.SOLO_WORKTREE;
    return wf.FeatureMode.SOLO_BRANCH;
}

function resolveMainRepoPath(repoPath, gitLib) {
    if (gitLib && typeof gitLib.getMainRepoPath === 'function') {
        return gitLib.getMainRepoPath(repoPath);
    }
    return repoPath;
}

function pathExists(targetPath) {
    try {
        fs.accessSync(targetPath);
        return true;
    } catch (_) {
        return false;
    }
}

function stagePaths(runGit, repoPath, paths) {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (uniquePaths.length === 0) return;
    const quoted = uniquePaths.map(p => JSON.stringify(path.relative(repoPath, p))).join(' ');
    runGit(`git add -- ${quoted}`);
}

function mapPathToCurrentCheckout(targetPath, repoPath, gitLib) {
    if (!targetPath) return null;
    const currentCheckoutPath = path.resolve(repoPath);
    const mainRepoPath = path.resolve(resolveMainRepoPath(repoPath, gitLib));
    if (currentCheckoutPath === mainRepoPath) return targetPath;
    if (!targetPath.startsWith(mainRepoPath + path.sep) && targetPath !== mainRepoPath) return targetPath;
    return path.join(currentCheckoutPath, path.relative(mainRepoPath, targetPath));
}

function resolveFeatureSpecInfo(repoPath, featureId, gitLib, options = {}) {
    const mainRepoPath = path.resolve(resolveMainRepoPath(repoPath, gitLib));
    const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(mainRepoPath, featureId);
    const resolved = featureSpecResolver.resolveFeatureSpec(mainRepoPath, featureId, { snapshot });
    const mappedPath = mapPathToCurrentCheckout(resolved.path, repoPath, gitLib);

    if (options.requireCurrentCheckout && mappedPath && !pathExists(mappedPath)) {
        return {
            ...resolved,
            path: null,
            source: 'missing-in-current-checkout',
            missingPath: mappedPath,
            mainRepoPath,
        };
    }

    return {
        ...resolved,
        path: mappedPath || resolved.path,
        mainRepoPath,
    };
}

function safeReadDir(dir) {
    try {
        return fs.readdirSync(dir);
    } catch (_) {
        return [];
    }
}

function listFeatureRecords(repoPath, gitLib) {
    const mainRepoPath = resolveMainRepoPath(repoPath, gitLib);
    const featuresRoot = path.join(mainRepoPath, 'docs', 'specs', 'features');
    const workflowRoot = path.join(mainRepoPath, '.aigon', 'workflows', 'features');
    const records = [];
    const activeIds = new Set();

    safeReadDir(workflowRoot)
        .filter(entry => /^\d+$/.test(entry))
        .forEach(featureId => {
            const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(mainRepoPath, featureId);
            const stage = workflowSnapshotAdapter.snapshotToStage(snapshot);
            if (!snapshot || !stage) return;
            const resolvedSpec = featureSpecResolver.resolveFeatureSpec(mainRepoPath, featureId, { snapshot });
            const parsed = resolvedSpec.path ? parseFeatureSpecFileName(path.basename(resolvedSpec.path)) : null;
            activeIds.add(String(featureId).padStart(2, '0'));
            records.push({
                id: String(featureId).padStart(2, '0'),
                name: parsed ? parsed.name : `feature-${featureId}`,
                stage,
                specPath: mapPathToCurrentCheckout(resolvedSpec.path, repoPath, gitLib),
                source: 'workflow-core',
            });
        });

    featureSpecResolver.VISIBLE_STAGE_DIRS.forEach(({ dir, stage }) => {
        const fullDir = path.join(featuresRoot, dir);
        safeReadDir(fullDir)
            .filter(file => /^feature-(\d+)-.+\.md$/.test(file))
            .forEach(file => {
                const parsed = parseFeatureSpecFileName(file);
                if (!parsed || activeIds.has(parsed.id)) return;
                records.push({
                    id: parsed.id,
                    name: parsed.name,
                    stage,
                    specPath: mapPathToCurrentCheckout(path.join(fullDir, file), repoPath, gitLib),
                    source: 'visible-spec',
                });
            });
    });

    return records.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
}

module.exports = function featureCommands(ctx) {
    const u = ctx.utils;
    const v = ctx.validation;
    const gitLib = ctx.git;

    const {
        PATHS,
        PROVIDER_FAMILIES,
        AGENT_CONFIGS,
        slugify,
        readTemplate,
        createSpecFile,
        findFile,
        findUnprioritizedFile,
        moveFile,
        getNextId,
        printError,
        printNextSteps,
        printAgentContextWarning,
        setupWorktreeEnvironment,
        loadAgentConfig,
        getWorktreeBase,
        findWorktrees,
        filterByFeatureId,
        buildAgentCommand,
        buildTmuxSessionName,
        buildResearchTmuxSessionName,
        getEffectiveConfig,
        assertTmuxAvailable,
        ensureAgentSessions,
        openTerminalAppWithCommand,
        openInWarpSplitPanes,
        openSingleWorktree,
        shellQuote,
        safeTmuxSessionExists,
        tmuxSessionExists,
        createDetachedTmuxSession,
        ensureTmuxSessionForWorktree,
        addWorktreePermissions,
        removeWorktreePermissions,
        presetWorktreeTrust,
        removeWorktreeTrust,
        parseCliOptions,
        getOptionValue,
        parseFrontMatter,
        serializeYamlScalar,
        getAvailableAgents,
        buildAgentAliasMap,
        getAgentCliConfig,
        getAgentLaunchFlagTokens,
        detectActiveAgentSession,
        setTerminalTitle,
        runPreHook,
        runPostHook,
        isSameProviderFamily,
        loadProjectConfig,
        loadGlobalConfig,
        readConductorReposFromGlobalConfig,
        runDeployCommand,
        safeWriteWithStatus,
        readBasePort,
        registerPort,
        gcDevServers,
        ensureAgentSessions: _ensureAgentSessions,
    } = u;

    const {
        runFeatureValidateCommand,
        runRalphCommand,
    } = v;

    const {
        getCurrentBranch,
        getDefaultBranch,
        assertOnDefaultBranch,
        branchExists,
        listBranches,
        runGit,
        detectWorktreeFeature,
        getFeatureGitSignals,
    } = ctx.git;

    const {
        getGitStatusPorcelain: gitStatusPorcelain,
        getChangedFilesInRange,
        getCommitSummariesInRange,
    } = v;

    const {
        loadBoardMapping,
    } = ctx.board;

    // Internal-only: parse log frontmatter for analytics backfill (NOT for status reads)
    function _parseLogFrontmatterForBackfill(content) {
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

    // Helper: collect incomplete feature eval agents
    function collectIncompleteFeatureEvalAgents({ featureNum, worktrees = [], engineSnapshot = null }) {
        const incompleteAgents = [];

        worktrees.forEach(w => {
            // Engine snapshot is authoritative — if the engine says ready, agent has submitted
            if (engineSnapshot && engineSnapshot.agents && engineSnapshot.agents[w.agent]?.status === 'ready') return;
            // Fall back to legacy status file
            const agentStatus = readAgentStatus(featureNum, w.agent);
            const status = agentStatus?.status || 'unknown';
            if (status !== 'submitted') {
                incompleteAgents.push({ agent: w.agent, name: w.name, status });
            }
        });

        return incompleteAgents;
    }

    function estimateExpectedScopeFiles(specPath) {
        try {
            if (!specPath || !fs.existsSync(specPath)) return 1;
            const raw = fs.readFileSync(specPath, 'utf8');
            const parsed = parseFrontMatter(raw);
            const body = parsed.body || raw;

            // Heuristic 1: explicit file paths in inline code.
            const pathLike = new Set();
            const inlineCodeMatches = body.match(/`[^`\n]+`/g) || [];
            inlineCodeMatches.forEach(token => {
                const value = token.slice(1, -1).trim();
                if (!value || /\s/.test(value) || /^https?:\/\//i.test(value)) return;
                if (value.includes('/')) pathLike.add(value);
            });

            // Heuristic 2: number of acceptance criteria as a simple scope baseline.
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

    function findAutoSessionNameByFeatureId(featureId) {
        try {
            assertTmuxAvailable();
            const result = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
            if (result.error || result.status !== 0) return null;
            const sessions = (result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
            const match = sessions.find(sessionName => {
                const parsed = matchTmuxSessionByEntityId(sessionName, featureId);
                return parsed && parsed.type === 'f' && parsed.role === 'auto';
            });
            return match || null;
        } catch (_) {
            return null;
        }
    }

    function runAigonCliCommand(mainRepoPath, args) {
        const cliPath = path.join(__dirname, '..', '..', 'aigon-cli.js');
        return spawnSync(process.execPath, [cliPath, ...args], {
            cwd: mainRepoPath,
            encoding: 'utf8',
            stdio: 'pipe'
        });
    }

    function upsertLogFrontmatterScalars(logPath, fields) {
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
            nextContent = frontmatter + content.replace(/^\uFEFF/, '');
        }

        if (nextContent === content) return false;
        safeWriteWithStatus(logPath, nextContent);
        return true;
    }

    const cmds = {
        'feature-create': (args) => {
            // Guard: warn if running from inside a feature worktree
            const wtFeature = detectWorktreeFeature();
            if (wtFeature) {
                console.error(`\n⚠️  You are in a worktree for feature ${wtFeature.featureId}.`);
                console.error(`   Creating a new feature here will commit to the wrong branch.`);
                console.error(`   Switch to the main repo first.\n`);
                return;
            }
            // Parse --description flag from args
            const descIdx = args.indexOf('--description');
            let description = '';
            let nameArgs = args;
            if (descIdx >= 0) {
                description = args.slice(descIdx + 1).join(' ');
                nameArgs = args.slice(0, descIdx);
            }
            entity.entityCreate(entity.FEATURE_DEF, nameArgs[0], ctx, { description });
        },

        'feature-pause': async (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-pause <id or name>");

            // Check if this is an inbox item (no ID) — just move the file
            const inboxDir = path.join(PATHS.features.root, '01-inbox');
            const isNumeric = /^\d+$/.test(id);
            if (!isNumeric) {
                // Name-based: find in inbox
                const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const candidates = fs.existsSync(inboxDir) ? fs.readdirSync(inboxDir).filter(f => f.includes(slug) && f.endsWith('.md')) : [];
                if (candidates.length === 0) return console.error(`❌ No inbox feature matching "${id}"`);
                const specFile = candidates[0];
                const targetDir = path.join(PATHS.features.root, '06-paused');
                fs.mkdirSync(targetDir, { recursive: true });
                fs.renameSync(path.join(inboxDir, specFile), path.join(targetDir, specFile));
                console.log(`✅ Paused: ${specFile} -> 06-paused/`);
                return;
            }

            // ID-based pause — engine path
            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const engineOpts = args.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};

            const snapshot = await wf.showFeature(repoPath, paddedId);

            if (snapshot.currentSpecState === 'paused') {
                const hasPending = snapshot.effects.some(e => e.status !== 'succeeded');
                if (!hasPending) {
                    console.log(`✅ Feature ${paddedId} is already paused.`);
                    return;
                }
                // Resume pending effects from interrupted pause
                const effectResult = await persistAndRunEffects(repoPath, paddedId, [], engineOpts);
                if (effectResult.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${effectResult.message}`); }
                console.log(`✅ Paused: completed pending effects for ${paddedId}`);
                return;
            }

            if (snapshot.currentSpecState !== 'implementing') {
                process.exitCode = 1;
                return console.error(`❌ Cannot pause feature ${paddedId} from state "${snapshot.currentSpecState}".`);
            }

            const found = findFile(PATHS.features, paddedId, ['03-in-progress', '06-paused']);
            if (!found) return console.error(`❌ Could not find feature "${paddedId}" in in-progress or paused.`);
            const specFromPath = path.join(PATHS.features.root, '03-in-progress', found.file);
            const specToPath = path.join(PATHS.features.root, '06-paused', found.file);

            await wf.pauseFeature(repoPath, paddedId);

            const pauseEffects = (specFromPath && specToPath && specFromPath !== specToPath)
                ? [{ id: 'pause.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } }]
                : [];
            const result = await persistAndRunEffects(repoPath, paddedId, pauseEffects, engineOpts);

            if (result.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${result.message}`); }
            if (result.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${result.message}`); }

            console.log(`✅ Paused: ${found.file} -> 06-paused/`);
        },

        'feature-resume': async (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-resume <id or name>");

            // Check if this is a name (no ID) — find in paused and move to inbox
            const isNumeric = /^\d+$/.test(id);
            const pausedDir = path.join(PATHS.features.root, '06-paused');
            if (!isNumeric) {
                const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const candidates = fs.existsSync(pausedDir) ? fs.readdirSync(pausedDir).filter(f => f.includes(slug) && f.endsWith('.md')) : [];
                if (candidates.length === 0) return console.error(`❌ No paused feature matching "${id}"`);
                const specFile = candidates[0];
                const targetDir = path.join(PATHS.features.root, '01-inbox');
                fs.renameSync(path.join(pausedDir, specFile), path.join(targetDir, specFile));
                console.log(`✅ Resumed: ${specFile} -> 01-inbox/`);
                return;
            }

            // ID-based resume — engine path
            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const engineOpts = args.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};

            const snapshot = await wf.showFeature(repoPath, paddedId);

            if (snapshot.currentSpecState === 'implementing') {
                const hasPending = snapshot.effects.some(e => e.status !== 'succeeded');
                if (!hasPending) {
                    console.log(`✅ Feature ${paddedId} is already implementing.`);
                    return;
                }
                const effectResult = await persistAndRunEffects(repoPath, paddedId, [], engineOpts);
                if (effectResult.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${effectResult.message}`); }
                console.log(`✅ Resumed: completed pending effects for ${paddedId}`);
                return;
            }

            if (snapshot.currentSpecState !== 'paused') {
                process.exitCode = 1;
                return console.error(`❌ Cannot resume feature ${paddedId} from state "${snapshot.currentSpecState}".`);
            }

            const found = findFile(PATHS.features, paddedId, ['06-paused', '03-in-progress']);
            if (!found) return console.error(`❌ Could not find feature "${paddedId}" in paused or in-progress.`);
            const specFromPath = path.join(PATHS.features.root, '06-paused', found.file);
            const specToPath = path.join(PATHS.features.root, '03-in-progress', found.file);

            await wf.resumeFeature(repoPath, paddedId);

            const resumeEffects = (specFromPath && specToPath && specFromPath !== specToPath)
                ? [{ id: 'resume.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } }]
                : [];
            const result = await persistAndRunEffects(repoPath, paddedId, resumeEffects, engineOpts);

            if (result.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${result.message}`); }
            if (result.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${result.message}`); }

            console.log(`✅ Resumed: ${found.file} -> 03-in-progress/`);
        },

        'feature-prioritise': (args) => {
            if (!args[0]) return console.error("Usage: aigon feature-prioritise <name or letter>");
            entity.entityPrioritise(entity.FEATURE_DEF, args[0], ctx);
        },

        'feature-now': (args) => {
            const actionCtx = buildActionContext(ctx.git);
            try {
                const result = assertActionAllowed('feature-now', actionCtx);
                if (result && result.delegate) {
                    console.log(`📡 Delegating 'feature-now' to main repo...`);
                    const argsStr = args.map(a => JSON.stringify(a)).join(' ');
                    execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" feature-now ${argsStr}`, { stdio: 'inherit', cwd: result.delegate });
                    return;
                }
            } catch (e) { return console.error(`❌ ${e.message}`); }
            const name = args.join(' ').trim();
            if (!name) return console.error("Usage: aigon feature-now <name>\nFast-track: create + prioritise + setup in one step (Drive mode)\nExample: aigon feature-now dark-mode");

            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

            // Check for existing feature with same slug
            const existing = findFile(PATHS.features, slug);
            if (existing) {
                return console.error(`❌ Feature already exists: ${existing.file} (in ${existing.folder})`);
            }

            // Assign ID
            const nextId = getNextId(PATHS.features);
            const paddedId = String(nextId).padStart(2, '0');
            const filename = `feature-${paddedId}-${slug}.md`;

            // Run pre-hook
            const hookContext = {
                featureId: paddedId,
                featureName: slug,
                mode: 'drive',
                agents: []
            };
            if (!runPreHook('feature-now', hookContext)) {
                return;
            }

            // Ensure in-progress directory exists
            const inProgressDir = path.join(PATHS.features.root, '03-in-progress');
            if (!fs.existsSync(inProgressDir)) {
                fs.mkdirSync(inProgressDir, { recursive: true });
            }

            // Create spec directly in 03-in-progress
            const template = readTemplate('specs/feature-template.md');
            const content = template.replace(/\{\{NAME\}\}/g, name);
            const specPath = path.join(inProgressDir, filename);
            fs.writeFileSync(specPath, content);
            console.log(`✅ Created spec: ./docs/specs/features/03-in-progress/${filename}`);

            // Create branch
            const branchName = `feature-${paddedId}-${slug}`;
            try {
                runGit(`git checkout -b ${branchName}`);
                console.log(`🌿 Created branch: ${branchName}`);
            } catch (e) {
                try {
                    runGit(`git checkout ${branchName}`);
                    console.log(`🌿 Switched to branch: ${branchName}`);
                } catch (e2) {
                    console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                    return;
                }
            }

            // Create log file
            const logsDir = path.join(PATHS.features.root, 'logs');
            if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
            const logName = `feature-${paddedId}-${slug}-log.md`;
            const logPath = path.join(logsDir, logName);
            if (!fs.existsSync(logPath)) {
                const logTemplate = `# Implementation Log: Feature ${paddedId} - ${slug}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                fs.writeFileSync(logPath, logTemplate);
                console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
            }

            // Single atomic commit
            try {
                runGit(`git add docs/specs/features/`);
                runGit(`git commit -m "chore: create and start feature ${paddedId} - ${slug}"`);
                console.log(`📝 Committed feature creation and setup`);
            } catch (e) {
                console.warn(`⚠️  Could not commit: ${e.message}`);
            }

            // Run post-hook
            runPostHook('feature-now', hookContext);

            console.log(`\n🚗 Feature ${paddedId} ready for implementation!`);
            console.log(`   Spec: ./docs/specs/features/03-in-progress/${filename}`);
            console.log(`   Log:  ./docs/specs/features/logs/${logName}`);
            console.log(`   Branch: ${branchName}`);
            console.log(`\n📝 Next: Write the spec, then implement.`);
            console.log(`   When done: aigon feature-close ${paddedId}`);
        },

        'feature-start': async (args) => {
            const actionCtx = buildActionContext(ctx.git);
            try {
                const result = assertActionAllowed('feature-start', actionCtx);
                if (result && result.delegate) {
                    console.log(`📡 Delegating 'feature-start' to main repo...`);
                    const argsStr = args.map(a => JSON.stringify(a)).join(' ');
                    execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" feature-start ${argsStr}`, { stdio: 'inherit', cwd: result.delegate });
                    return;
                }
            } catch (e) { process.exitCode = 1; return console.error(`❌ ${e.message}`); }
            const options = parseCliOptions(args);
            const name = options._[0];
            const agentIds = options._.slice(1);
            const mode = agentIds.length > 0 ? 'fleet' : 'drive';
            const backgroundRequested = getOptionValue(options, 'background') !== undefined;
            const foregroundRequested = getOptionValue(options, 'foreground') !== undefined;

            if (backgroundRequested && foregroundRequested) {
                return console.error('❌ Use either --background or --foreground (not both).');
            }

            const startupConfig = getEffectiveConfig();
            const backgroundByConfig = Boolean(startupConfig.backgroundAgents);
            const backgroundMode = backgroundRequested
                ? true
                : (foregroundRequested ? false : backgroundByConfig);

            if (!name) {
                process.exitCode = 1;
                return console.error("Usage: aigon feature-start <ID> [agents...] [--background|--foreground]\n\nExamples:\n  aigon feature-start 55                          # Drive mode (branch)\n  aigon feature-start 55 cc                       # Drive mode (worktree, for parallel development)\n  aigon feature-start 55 cc gg cx cu              # Fleet mode (multiple agents compete)\n  aigon feature-start 55 cc cx --background       # Fleet mode without opening terminals");
            }

            // Find the feature first to get context for hooks
            let found = findFile(PATHS.features, name, ['02-backlog', '03-in-progress']);
            if (!found) { process.exitCode = 1; return console.error(`❌ Could not find feature "${name}" in backlog or in-progress.`); }

            const preMatch = found.file.match(/^feature-(\d+)-(.*)\.md$/);
            const featureId = preMatch ? preMatch[1] : name;
            const featureName = preMatch ? preMatch[2] : '';

            // Run pre-hook (can abort the command)
            const hookContext = {
                featureId,
                featureName,
                mode,
                agents: agentIds
            };
            if (!runPreHook('feature-start', hookContext)) {
                return;
            }

            // Guard: already running — check engine state for resume
            if (found.folder === '03-in-progress') {
                const repoPath = process.cwd();
                const existingSnapshot = await wf.showFeatureOrNull(repoPath, featureId);
                if (existingSnapshot) {
                    if (existingSnapshot.lifecycle === 'implementing') {
                        const hasPending = (existingSnapshot.effects || []).some(e => e.status !== 'succeeded');
                        if (hasPending) {
                            console.log(`📋 Resuming interrupted feature-start (pending effects)...`);
                        } else {
                            console.log(`📋 Feature ${featureId} is already in progress; preserving existing engine agents.`);
                        }
                    }
                } else if (agentIds.length === 0) {
                    const runningId = String(parseInt(featureId, 10) || featureId);
                    console.log(`ℹ️  Feature ${runningId} is already running. Use \`feature-open ${runningId}\` to re-attach.`);
                    return;
                }
            }

            // Parse filename early — needed by both engine and legacy paths
            const earlyMatch = found.file.match(/^feature-(\d+)-(.*)\.md$/);
            if (!earlyMatch) return console.warn("⚠️  Could not parse filename for branch creation.");
            const [_, num, desc] = earlyMatch;

            {
                // ── Workflow-core engine path ──
                const repoPath = process.cwd();
                const specFromPath = found.folder === '02-backlog'
                    ? path.join(PATHS.features.root, '02-backlog', found.file)
                    : null;
                const specToPath = specFromPath
                    ? path.join(PATHS.features.root, '03-in-progress', found.file)
                    : null;

                try {
                    // Check for resume scenario via engine snapshot
                    const snapshot = await wf.showFeatureOrNull(repoPath, featureId);
                    let startResult;

                    if (snapshot && snapshot.lifecycle !== 'backlog') {
                        // Resume: run any pending effects
                        startResult = await persistAndRunEffects(repoPath, featureId, []);
                    } else {
                        // Fresh start: create engine state + effects
                        const engineMode = resolveFeatureMode(agentIds);
                        await wf.startFeature(repoPath, featureId, engineMode, agentIds);

                        const startEffects = [];
                        if (specFromPath && specToPath && specFromPath !== specToPath) {
                            startEffects.push({ id: 'start.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } });
                        }
                        for (const agentId of agentIds) {
                            startEffects.push({ id: `start.init_log_${agentId}`, type: 'init_log', payload: { agentId, num, desc } });
                        }
                        if (agentIds.length === 0) {
                            startEffects.push({ id: 'start.init_log', type: 'init_log', payload: { agentId: null, num, desc } });
                        }

                        startResult = await persistAndRunEffects(repoPath, featureId, startEffects);
                    }

                    if (startResult.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${startResult.message}`); }
                    if (startResult.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${startResult.message}`); }

                    console.log(`🔧 Feature ${featureId} started via workflow-core engine`);

                    // Initialize persistent stats record
                    try {
                        const engineMode = resolveFeatureMode(agentIds);
                        writeStats(repoPath, 'feature', featureId, {
                            startedAt: new Date().toISOString(),
                            mode: engineMode,
                            agents: agentIds.length > 0 ? agentIds : ['solo'],
                        });
                    } catch (e) {
                        console.warn(`⚠️  Could not initialize stats record: ${e.message}`);
                    }
                } catch (e) {
                    process.exitCode = 1;
                    console.error(`❌ Workflow-core start failed: ${e.message}`);
                    return;
                }

                // Re-find spec in in-progress (engine moved it)
                found = findFile(PATHS.features, name, ['03-in-progress']);
                if (!found) { process.exitCode = 1; return console.error(`❌ Could not find feature "${name}" in in-progress after engine start.`); }
                const movedFromBacklog = !!specFromPath;

                if (movedFromBacklog) {
                    try {
                        const graphResult = entity.refreshFeatureDependencyGraphs(PATHS.features, u);
                        if (graphResult.changedSpecs > 0) {
                            console.log(`🕸️  Updated dependency graphs in ${graphResult.changedSpecs} feature spec(s)`);
                        }
                    } catch (e) {
                        console.warn(`⚠️  Could not refresh dependency graphs: ${e.message}`);
                    }
                }

                // Commit the spec move (important for worktrees)
                if (movedFromBacklog) {
                    try {
                        runGit(`git add docs/specs/features/`);
                        runGit(`git commit -m "chore: start feature ${num} - move spec to in-progress"`);
                        console.log(`📝 Committed spec move to in-progress`);
                    } catch (e) {
                        if (mode !== 'drive') {
                            console.error(`❌ Could not commit spec move: ${e.message}`);
                            console.error(`   Worktrees require the spec move to be committed before creation.`);
                            console.error(`   Fix any uncommitted changes and try again.`);
                            return;
                        }
                        console.warn(`⚠️  Could not commit spec move: ${e.message}`);
                    }
                }
            }

            if (mode === 'drive') {
                // Drive mode: Create branch
                const branchName = `feature-${num}-${desc}`;
                try {
                    runGit(`git checkout -b ${branchName}`);
                    console.log(`🌿 Created branch: ${branchName}`);
                } catch (e) {
                    // Branch may already exist
                    try {
                        runGit(`git checkout ${branchName}`);
                        console.log(`🌿 Switched to branch: ${branchName}`);
                    } catch (e2) {
                        console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                        return;
                    }
                }

                // Log already created by init_log effect

                console.log(`\n🚗 Drive mode. Ready to implement in current directory.`);
                console.log(`   When done: aigon feature-close ${num}`);
            } else {
                // Fleet/worktree mode: Create worktrees
                const wtBase = getWorktreeBase();
                if (!fs.existsSync(wtBase)) {
                    fs.mkdirSync(wtBase, { recursive: true });
                }
                const effectiveConfig = getEffectiveConfig();
                const terminalPreference = effectiveConfig.terminal || 'warp';
                const useTmux = terminalPreference === 'tmux';
                if (useTmux || backgroundMode) {
                    try {
                        assertTmuxAvailable();
                    } catch (e) {
                        console.error(`❌ ${e.message}`);
                        console.error(`   ${backgroundMode ? 'Background mode' : 'tmux terminal mode'} requires tmux. Install: brew install tmux`);
                        return;
                    }
                }

                const profile = u.getActiveProfile();
                if (profile.devServer.enabled && !readBasePort()) {
                    console.warn(`\n⚠️  No PORT found in .env.local or .env — using default ports`);
                    console.warn(`   💡 Add PORT=<number> to .env.local to avoid clashes with other projects`);
                }

                // Auto-register in global port registry
                if (profile.devServer.enabled) {
                    const portResult = readBasePort();
                    if (portResult) {
                        registerPort(path.basename(process.cwd()), portResult.port, process.cwd());
                    }
                }

                const createdWorktrees = [];
                agentIds.forEach(agentId => {
                    const branchName = `feature-${num}-${agentId}-${desc}`;
                    const worktreePath = `${wtBase}/feature-${num}-${agentId}-${desc}`;

                    // Check for a valid worktree (has .git file), not just an existing directory
                    const isValidWorktree = fs.existsSync(worktreePath) && fs.existsSync(path.join(worktreePath, '.git'));
                    if (fs.existsSync(worktreePath) && !isValidWorktree) {
                        // Stale empty directory — remove it so git worktree add can succeed
                        fs.rmSync(worktreePath, { recursive: true, force: true });
                        console.log(`🧹 Removed stale directory: ${worktreePath}`);
                    }
                    if (isValidWorktree) {
                        console.warn(`⚠️  Worktree ${worktreePath} already exists. Skipping.`);
                        if (useTmux || backgroundMode) {
                            try {
                                const wtConfig = {
                                    path: worktreePath,
                                    featureId: num,
                                    agent: agentId,
                                    desc
                                };
                                const agentCommand = buildAgentCommand(wtConfig);
                                const { sessionName, created } = ensureTmuxSessionForWorktree(wtConfig, agentCommand);
                                console.log(`   🧵 tmux: ${sessionName}${created ? ' (created)' : ' (already exists)'}`);
                            } catch (tmuxErr) {
                                console.warn(`   ⚠️  Could not create tmux session: ${tmuxErr.message}`);
                            }
                        }
                    } else {
                        try {
                            runGit(`git worktree add ${worktreePath} -b ${branchName}`);
                            console.log(`📂 Worktree: ${worktreePath}`);
                            createdWorktrees.push({ agentId, worktreePath });

                            // Verify spec exists in the worktree
                            const wtSpecDir = path.join(worktreePath, 'docs', 'specs', 'features', '03-in-progress');
                            const specExistsInWt = fs.existsSync(wtSpecDir) &&
                                fs.readdirSync(wtSpecDir).some(f => f.startsWith(`feature-${num}-`) && f.endsWith('.md'));
                            if (!specExistsInWt) {
                                console.warn(`⚠️  Spec not found in worktree 03-in-progress.`);
                                console.warn(`   The spec move may not have been committed. Run from the worktree:`);
                                console.warn(`   git checkout main -- docs/specs/features/03-in-progress/`);
                                console.warn(`   git commit -m "chore: sync spec to worktree branch"`);
                            }

                            setupWorktreeEnvironment(worktreePath, {
                                featureId: num,
                                agentId,
                                desc,
                                profile,
                                logsDirPath: path.join(worktreePath, 'docs/specs/features/logs')
                            });

                            if (useTmux || backgroundMode) {
                                try {
                                    const wtConfig = {
                                        path: worktreePath,
                                        featureId: num,
                                        agent: agentId,
                                        desc
                                    };
                                    const agentCommand = buildAgentCommand(wtConfig);
                                    const { sessionName, created } = ensureTmuxSessionForWorktree(wtConfig, agentCommand);
                                    console.log(`   🧵 tmux: ${sessionName}${created ? ' (created)' : ' (already exists)'}`);
                                } catch (tmuxErr) {
                                    console.warn(`   ⚠️  Could not create tmux session: ${tmuxErr.message}`);
                                }
                            }
                        } catch (e) {
                            console.error(`❌ Failed to create worktree for ${agentId}: ${e.message}`);
                        }
                    }
                    // Engine tracks its own effects — no legacy completePendingOp needed
                });

                // Add read permissions for all worktrees to Claude settings
                const allWorktreePaths = agentIds.map(agentId => `${wtBase}/feature-${num}-${agentId}-${desc}`);
                addWorktreePermissions(allWorktreePaths);
                // Pre-seed trust for conductor (cc) and all fleet agents
                agentRegistry.ensureAgentTrust('cc', allWorktreePaths);
                for (const id of agentIds) {
                    agentRegistry.ensureAgentTrust(id, allWorktreePaths);
                }

                // Create tmux sessions if terminal is configured as tmux
                const fleetEffectiveConfig = getEffectiveConfig();
                const fleetTerminal = fleetEffectiveConfig.terminal;
                if (fleetTerminal === 'tmux' && createdWorktrees.length > 0) {
                    console.log(`\n🖥️  Creating tmux sessions...`);
                    const worktreeByAgent = new Map(createdWorktrees.map(wt => [wt.agentId, wt.worktreePath]));
                    const sessionResults = ensureAgentSessions(num, createdWorktrees.map(wt => wt.agentId), {
                        sessionNameBuilder: (featureId, agent) => buildTmuxSessionName(featureId, agent, { desc, role: 'do' }),
                        cwdBuilder: (_, agent) => worktreeByAgent.get(agent),
                        commandBuilder: (featureId, agent) => {
                            const wt = {
                                featureId,
                                agent,
                                path: worktreeByAgent.get(agent),
                                desc
                            };
                            return buildAgentCommand(wt);
                        }
                    });
                    sessionResults.forEach(result => {
                        if (result.error) {
                            console.warn(`   ⚠️  Could not create tmux session ${result.sessionName}: ${result.error.message}`);
                        } else {
                            console.log(`   ✓ ${result.sessionName}${result.created ? ' → started' : ' (already exists)'}`);
                        }
                    });
                    const repoName = path.basename(process.cwd());
                    console.log(`\n   Attach: tmux attach -t ${repoName}-f${parseInt(num, 10)}-<agent>-${desc}`);
                    console.log(`   List:   tmux ls`);
                }

                if (agentIds.length === 1) {
                    const portSuffix = profile.devServer.enabled
                        ? ` (PORT=${profile.devServer.ports[agentIds[0]] || AGENT_CONFIGS[agentIds[0]]?.port})`
                        : '';
                    console.log(`\n🚗 Drive worktree created for parallel development!`);
                    console.log(`\n📂 Worktree: ${wtBase}/feature-${num}-${agentIds[0]}-${desc}${portSuffix}`);
                    if (backgroundMode) {
                        console.log(`\n🟡 Background mode enabled — agent session started without opening a terminal window.`);
                        console.log(`   View anytime: aigon feature-open ${num} ${agentIds[0]}`);
                    } else {
                        console.log(`\n🚀 Starting agent terminal...`);
                        cmds['feature-open']([num, agentIds[0]]);
                    }
                    console.log(`   When done: aigon feature-close ${num}`);
                } else {
                    console.log(`\n🏁 Fleet started with ${agentIds.length} agents!`);
                    console.log(`\n📂 Worktrees created:`);
                    agentIds.forEach(agentId => {
                        const portSuffix = profile.devServer.enabled
                            ? ` (PORT=${profile.devServer.ports[agentId] || AGENT_CONFIGS[agentId]?.port})`
                            : '';
                        console.log(`   ${agentId}: ${wtBase}/feature-${num}-${agentId}-${desc}${portSuffix}`);
                    });
                    if (backgroundMode) {
                        console.log(`\n🟡 Background mode enabled — all agent sessions started without opening terminal windows.`);
                        console.log(`   View all: aigon feature-open ${num} --all`);
                    } else {
                        console.log(`\n🚀 Starting agent terminals...`);
                        cmds['feature-open']([num, '--all']);
                    }
                    console.log(`   When done: aigon feature-eval ${num}`);
                }
            }

            // Run post-hook (won't fail the command)
            runPostHook('feature-start', hookContext);
        },

        'feature-do': (args) => {
            const options = parseCliOptions(args);
            const id = options._[0];
            const ralphRequested = getOptionValue(options, 'autonomous') || getOptionValue(options, 'ralph');
            if (ralphRequested) {
                return runRalphCommand(args);
            }
            printAgentContextWarning('feature-do', id);
            if (!id) return console.error(
                "Usage: aigon feature-do <ID> [--agent=<cc|gg|cx|cu>]\n\n" +
                "Run this after 'aigon feature-start <ID>'\n\n" +
                "Examples:\n" +
                "  aigon feature-do 55             # Launch default agent (cc) from shell\n" +
                "  aigon feature-do 55 --agent=cx  # Launch Codex from shell\n" +
                "  aigon feature-do 55 --autonomous # Run autonomous retry loop\n" +
                "  /aigon:feature-do 55            # Inside agent session: show instructions"
            );

            const mainRepoPath = resolveMainRepoPath(process.cwd(), gitLib);
            const activeSnapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(mainRepoPath, String(id).padStart(2, '0'));
            if (!activeSnapshot) return printError('feature', id, `Run 'aigon feature-start ${id}' first.`);
            const activeSpec = resolveFeatureSpecInfo(process.cwd(), String(id).padStart(2, '0'), gitLib, { requireCurrentCheckout: true });
            let found = activeSpec.path
                ? {
                    file: path.basename(activeSpec.path),
                    fullPath: activeSpec.path,
                    folder: activeSpec.stage,
                }
                : null;
            if (!found) {
                if (activeSpec.source === 'missing-in-current-checkout') {
                    process.exitCode = 1;
                    return console.error(`❌ Active spec for feature "${id}" is missing in this checkout.\n\nExpected: ./${path.relative(process.cwd(), activeSpec.missingPath)}\nSync the worktree or restart the feature.`);
                }
                return printError('feature', id, `Run 'aigon feature-start ${id}' first.`);
            }

            const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
            if (!match) return console.warn("⚠️  Could not parse filename.");
            const [_, num, desc] = match;

            // Detect mode based on current location
            const cwd = process.cwd();
            const dirName = path.basename(cwd);
            const worktreeMatch = dirName.match(/^feature-(\d+)-(\w+)-(.+)$/);

            let mode, agentId;
            if (worktreeMatch) {
                agentId = worktreeMatch[2];

                // Block if in a worktree for a different feature
                const [__, wtNum] = worktreeMatch;
                if (wtNum !== num && wtNum !== String(num).padStart(2, '0')) {
                    console.error(`\n❌ You are in a worktree for feature ${wtNum} but trying to work on feature ${num}.`);
                    console.error(`   Switch to the correct worktree or the main repo.\n`);
                    return;
                }

                // Count worktrees for this feature to distinguish drive-wt from fleet
                let featureWorktreeCount = 0;
                try {
                    featureWorktreeCount = filterByFeatureId(findWorktrees(), num).length;
                } catch (e) {
                    // Default to fleet if we can't count
                    featureWorktreeCount = 2;
                }

                mode = featureWorktreeCount > 1 ? 'fleet' : 'drive-wt';
            } else {
                mode = 'drive';
            }

            // Resolve the agent to use, taking worktree context into account
            const availableAgents = getAvailableAgents();
            const agentArgRaw = getOptionValue(options, 'agent');
            const agentAliasMap = buildAgentAliasMap();
            let resolvedAgent;

            if (agentId) {
                // Inside a worktree: default to the worktree's own agent
                if (agentArgRaw) {
                    const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
                    if (normalized !== agentId) {
                        console.error(`❌ Agent mismatch: this worktree belongs to agent '${agentId}', but --agent='${normalized}' was requested.`);
                        console.error(`   Remove --agent to use '${agentId}', or open the correct worktree.`);
                        process.exitCode = 1;
                        return;
                    }
                    resolvedAgent = normalized;
                } else {
                    resolvedAgent = agentId;
                }
            } else {
                // Drive branch mode: default to cc
                if (agentArgRaw) {
                    const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
                    if (!availableAgents.includes(normalized)) {
                        console.error(`❌ Unknown agent '${agentArgRaw}'. Supported agents: ${availableAgents.join(', ')}`);
                        process.exitCode = 1;
                        return;
                    }
                    resolvedAgent = normalized;
                } else {
                    resolvedAgent = 'cc';
                }
            }

            if (!availableAgents.includes(resolvedAgent)) {
                console.error(`❌ Unknown agent '${resolvedAgent}'. Supported agents: ${availableAgents.join(', ')}`);
                process.exitCode = 1;
                return;
            }

            // Display header (common to both launch mode and instruction mode)
            const paddedNum = String(num).padStart(2, '0');
            if (agentId) {
                const agentConfig = AGENT_CONFIGS[agentId] || {};
                const agentName = agentConfig.name || agentId;
                if (mode === 'fleet') {
                    setTerminalTitle(`🚛 Feature #${paddedNum} - ${agentName}`);
                    console.log(`\n🚛 Fleet Mode - Agent: ${agentId}`);
                } else {
                    setTerminalTitle(`🚗 Feature #${paddedNum} - ${agentName}`);
                    console.log(`\n🚗 Drive Mode (worktree) - Agent: ${agentId}`);
                }
                console.log(`   Feature: ${num} - ${desc}`);
                console.log(`   Worktree: ${dirName}`);
            } else {
                setTerminalTitle(`🚗 Feature #${paddedNum}`);
                try {
                    const currentBranch = getCurrentBranch();
                    const expectedBranch = `feature-${num}-${desc}`;
                    if (currentBranch !== expectedBranch) {
                        console.warn(`⚠️  Warning: Current branch (${currentBranch}) doesn't match expected (${expectedBranch})`);
                        console.warn(`    Run 'aigon feature-start ${num}' first.`);
                    }
                    console.log(`\n🚗 Drive Mode`);
                    console.log(`   Feature: ${num} - ${desc}`);
                    console.log(`   Branch: ${currentBranch}`);
                } catch (e) {
                    console.error(`❌ Could not determine git branch: ${e.message}`);
                    return;
                }
            }

            // Detect whether we're already inside an active agent session
            const sessionInfo = detectActiveAgentSession();

            if (!sessionInfo.detected) {
                // --- LAUNCH MODE: spawn the selected agent in this context ---
                const cliConfig = getAgentCliConfig(resolvedAgent);
                const featureId = paddedNum;
                const prompt = cliConfig.implementPrompt.replace('{featureId}', featureId);
                const model = cliConfig.models?.['implement'];

                if (!agentRegistry.supportsModelFlag(resolvedAgent) && model) {
                    const _agentName = agentRegistry.getAgent(resolvedAgent)?.displayName || resolvedAgent;
                    console.warn(`⚠️  Model config ignored for ${_agentName} — model selection is not supported via CLI flag`);
                }
                const modelTokens = (model && agentRegistry.supportsModelFlag(resolvedAgent)) ? ['--model', model] : [];
                const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
                const spawnArgs = [...flagTokens, ...modelTokens, prompt];

                const agentDisplayName = AGENT_CONFIGS[resolvedAgent]?.name || resolvedAgent;
                console.log(`\n🚀 Launching ${agentDisplayName}...`);
                console.log(`   Agent:   ${resolvedAgent}`);
                console.log(`   Command: ${cliConfig.command} ${spawnArgs.join(' ')}`);
                console.log(`   Dir:     ${cwd}\n`);

                const env = { ...process.env };
                if (cliConfig.command === 'claude') {
                    // Unset CLAUDECODE to prevent "nested session" error
                    delete env.CLAUDECODE;
                }

                const result = spawnSync(cliConfig.command, spawnArgs, { stdio: 'inherit', env, cwd });
                if (result.error) {
                    console.error(`❌ Failed to launch agent: ${result.error.message}`);
                    process.exitCode = 1;
                } else if (result.status !== 0) {
                    process.exitCode = result.status || 1;
                }
                return;
            }

            // --- INSTRUCTION MODE: already inside an agent session, show next steps ---
            console.log(`\nℹ️  Running inside ${sessionInfo.agentName} session — showing instructions (nested launch prevented).`);

            // Check if spec exists and print content inline (saves agent a file read)
            const resolvedSpec = resolveFeatureSpecInfo(cwd, num, gitLib);
            if (resolvedSpec.path) {
                console.log(`\n📋 Spec: ./${path.relative(cwd, resolvedSpec.path)}`);
                try {
                    const specContent = fs.readFileSync(resolvedSpec.path, 'utf8');
                    console.log(`\n--- SPEC CONTENT (already in context — no need to read the file) ---`);
                    console.log(specContent);
                    console.log(`--- END SPEC ---`);
                } catch (e) {
                    // Fall back to letting the agent read it
                }
            }

            // Show log file location
            const logDir = './docs/specs/features/logs/';
            const logPattern = (mode === 'fleet' || mode === 'drive-wt') ? `feature-${num}-${agentId}-*-log.md` : `feature-${num}-*-log.md`;
            console.log(`📝 Log: ${logDir}${logPattern}`);

            console.log(`\n📝 Next Steps:`);
            console.log(`   1. Implement the feature according to the spec above`);
            console.log(`   2. Commit your code with conventional commits (feat:, fix:, chore:)`);
            console.log(`   3. Update the implementation log`);
            console.log(`   4. Commit the log file`);

            if (mode === 'fleet') {
                console.log(`\n⚠️  IMPORTANT:`);
                console.log(`   - Do NOT run 'aigon feature-close' from a worktree`);
                console.log(`   - Return to main repo when done`);
                console.log(`   - Run 'aigon feature-eval ${num}' to compare implementations`);
            } else if (mode === 'drive-wt') {
                console.log(`\n⚠️  IMPORTANT:`);
                console.log(`   - Do NOT run 'aigon feature-close' from a worktree`);
                console.log(`   - Return to main repo when done`);
                console.log(`   - Run 'aigon feature-close ${num}' from the main repo`);
            } else {
                console.log(`\n   When done: aigon feature-close ${num}`);
            }
        },

        'feature-spec': (args) => {
            const options = parseCliOptions(args);
            const id = options._[0];
            const asJson = getOptionValue(options, 'json') !== undefined;
            if (!id) {
                process.exitCode = 1;
                return console.error('Usage: aigon feature-spec <ID> [--json]');
            }

            const resolved = resolveFeatureSpecInfo(process.cwd(), String(id).padStart(2, '0'), gitLib, { requireCurrentCheckout: true });
            if (!resolved.path) {
                process.exitCode = 1;
                if (resolved.source === 'missing-in-current-checkout') {
                    return console.error(`❌ Active spec for feature "${id}" is missing in this checkout.\n\nExpected: ./${path.relative(process.cwd(), resolved.missingPath)}\nSync the worktree or restart the feature.`);
                }
                return printError('feature', id, 'No visible spec path could be resolved.');
            }

            if (asJson) {
                console.log(JSON.stringify(resolved, null, 2));
                return;
            }

            console.log(`./${path.relative(process.cwd(), resolved.path)}`);
        },

        'feature-status': (args) => {
            const options = parseCliOptions(args);
            const id = options._[0];
            const asJson = getOptionValue(options, 'json') !== undefined;
            if (!id) {
                process.exitCode = 1;
                return console.error('Usage: aigon feature-status <ID> [--json]');
            }

            const padded = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const deepStatus = collectFeatureDeepStatus(repoPath, padded);

            if (asJson) {
                console.log(JSON.stringify(deepStatus, null, 2));
                return;
            }

            // Formatted grid output
            const s = deepStatus.session || {};
            const p = deepStatus.progress || {};
            const c = deepStatus.cost || {};
            const sp = deepStatus.spec || {};

            const line = (label, value) => console.log(`  ${label.padEnd(18)} ${value}`);

            console.log(`\n  Feature ${deepStatus.id} — ${deepStatus.name}`);
            console.log(`  ${'─'.repeat(50)}`);

            console.log('\n  SESSION');
            line('Status', s.tmuxAlive ? '🟢 Alive' : '🔴 Dead');
            if (s.sessionName) line('Session', s.sessionName);
            if (s.uptimeSeconds != null) {
                const h = Math.floor(s.uptimeSeconds / 3600);
                const m = Math.floor((s.uptimeSeconds % 3600) / 60);
                line('Uptime', h ? `${h}h ${m}m` : `${m}m`);
            }

            console.log('\n  PROGRESS');
            line('Commits', String(p.commitCount || 0));
            if (p.lastCommitAt) line('Last commit', p.lastCommitAt);
            if (p.lastCommitMessage) line('Message', p.lastCommitMessage);
            line('Files changed', String(p.filesChanged || 0));
            line('Lines', `+${p.linesAdded || 0} / -${p.linesRemoved || 0}`);

            console.log('\n  COST');
            line('Input tokens', String(c.inputTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            line('Output tokens', String(c.outputTokens || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
            if (c.estimatedUsd) line('Estimated', `$${c.estimatedUsd}`);
            if (c.model) line('Model', c.model);
            if (c.sessions) line('Sessions', String(c.sessions));

            console.log('\n  SPEC');
            line('Criteria', sp.criteriaTotal ? `${sp.criteriaDone}/${sp.criteriaTotal}` : 'n/a');
            if (sp.specPath) line('Spec', `./${path.relative(repoPath, sp.specPath)}`);
            if (sp.logPath) line('Log', `./${path.relative(repoPath, sp.logPath)}`);

            console.log('\n  IDENTITY');
            line('Lifecycle', deepStatus.lifecycle || 'unknown');
            line('Mode', deepStatus.mode || 'unknown');
            line('Primary agent', deepStatus.primaryAgent || 'none');
            if (deepStatus.worktreePath) line('Worktree', deepStatus.worktreePath);
            console.log('');
        },

        'feature-list': (args) => {
            const options = parseCliOptions(args);
            const asJson = getOptionValue(options, 'json') !== undefined;
            const activeOnly = getOptionValue(options, 'active') !== undefined;
            const includeDone = getOptionValue(options, 'all') !== undefined;
            let records = listFeatureRecords(process.cwd(), gitLib);

            if (activeOnly) {
                records = records.filter(record => ['in-progress', 'in-review', 'in-evaluation'].includes(record.stage));
            } else if (!includeDone) {
                records = records.filter(record => record.stage !== 'done');
            }

            if (asJson) {
                console.log(JSON.stringify(records, null, 2));
                return;
            }

            records.forEach(record => {
                const specLabel = record.specPath ? ` ./${path.relative(process.cwd(), record.specPath)}` : '';
                console.log(`${record.id}  ${record.stage.padEnd(13)} ${record.name}${specLabel}`);
            });
        },

        'feature-validate': (args) => {
            return runFeatureValidateCommand(args);
        },

        'feature-eval': async (args) => {
            const actionCtx = buildActionContext(ctx.git);
            try {
                const result = assertActionAllowed('feature-eval', actionCtx);
                if (result && result.delegate) {
                    console.log(`📡 Delegating 'feature-eval' to main repo...`);
                    const argsStr = args.map(a => JSON.stringify(a)).join(' ');
                    execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" feature-eval ${argsStr}`, { stdio: 'inherit', cwd: result.delegate });
                    return;
                }
            } catch (e) { return console.error(`❌ ${e.message}`); }
            const options = parseCliOptions(args);
            const allowSameModel = args.includes('--allow-same-model-judge');
            const forceEval = args.includes('--force');
            const setupOnly = args.includes('--setup-only');
            const noLaunch = args.includes('--no-launch');
            // Strip flags so positional arg parsing is unaffected
            const positionalArgs = args.filter(a => a !== '--allow-same-model-judge' && a !== '--force' && a !== '--setup-only' && a !== '--no-launch' && !a.startsWith('--agent'));
            const name = positionalArgs[0];
            if (!name) return console.error("Usage: aigon feature-eval <ID> [--agent=<agent>] [--allow-same-model-judge] [--force]\n\nExamples:\n  aigon feature-eval 55            # Auto-launches agent to evaluate\n  aigon feature-eval 55 --agent=gg # Launch specific agent\n  aigon feature-eval 55 --allow-same-model-judge  # Skip bias warning\n  aigon feature-eval 55 --force                    # Skip agent completion check");

            // --- Solo mode guard: evaluation is Fleet-only ---
            {
                const featureWorktrees = filterByFeatureId(findWorktrees(), name);
                if (featureWorktrees.length <= 1) {
                    console.error(`\n❌ feature-eval is for Fleet mode only (comparing multiple implementations).`);
                    console.error(`   Feature ${name} is a solo/Drive feature.`);
                    console.error(`\n   To close a solo feature, run:`);
                    console.error(`   aigon feature-close ${name}`);
                    return;
                }
            }

            // Detect whether we're already inside an active agent session
            const sessionInfo = detectActiveAgentSession();

            if (!sessionInfo.detected && !noLaunch) {
                // --- LAUNCH MODE: spawn the selected agent to perform the evaluation ---
                const agentArgRaw = getOptionValue(options, 'agent');
                const agentAliasMap = buildAgentAliasMap();
                const availableAgents = getAvailableAgents();
                let resolvedAgent = 'cc'; // default evaluator

                if (agentArgRaw) {
                    const normalized = agentAliasMap[agentArgRaw.toLowerCase()] || agentArgRaw.toLowerCase();
                    if (!availableAgents.includes(normalized)) {
                        console.error(`❌ Unknown agent '${agentArgRaw}'. Supported agents: ${availableAgents.join(', ')}`);
                        process.exitCode = 1;
                        return;
                    }
                    resolvedAgent = normalized;
                }

                const cliConfig = getAgentCliConfig(resolvedAgent);
                const evalPrompt = (cliConfig.evalPrompt || '/aigon:feature-eval {featureId}').replace('{featureId}', name);
                // Pass through flags to the eval prompt
                const flagSuffix = [
                    allowSameModel ? ' --allow-same-model-judge' : '',
                    forceEval ? ' --force' : '',
                ].join('');
                const prompt = evalPrompt + flagSuffix;
                const model = cliConfig.models?.['evaluate'];

                if (!agentRegistry.supportsModelFlag(resolvedAgent) && model) {
                    const _agentName = agentRegistry.getAgent(resolvedAgent)?.displayName || resolvedAgent;
                    console.warn(`⚠️  Model config ignored for ${_agentName} — model selection is not supported via CLI flag`);
                }
                const modelTokens = (model && agentRegistry.supportsModelFlag(resolvedAgent)) ? ['--model', model] : [];
                const flagTokens = getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
                const spawnArgs = [...flagTokens, ...modelTokens, prompt];

                const agentDisplayName = AGENT_CONFIGS[resolvedAgent]?.name || resolvedAgent;

                // --setup-only: just do the state transition, don't spawn the agent
                // (used by dashboard which opens its own tmux session)
                if (setupOnly) {
                    console.log(`📊 Evaluation setup complete for F${name}`);
                    return;
                }

                console.log(`\n📊 Launching ${agentDisplayName} for evaluation...`);
                console.log(`   Agent:   ${resolvedAgent}`);
                console.log(`   Command: ${cliConfig.command} ${spawnArgs.join(' ')}`);
                console.log('');

                const env = { ...process.env };
                if (cliConfig.command === 'claude') {
                    delete env.CLAUDECODE;
                }

                const result = spawnSync(cliConfig.command, spawnArgs, { stdio: 'inherit', env });
                if (result.error) {
                    console.error(`❌ Failed to launch agent: ${result.error.message}`);
                    process.exitCode = 1;
                } else if (result.status !== 0) {
                    process.exitCode = result.status || 1;
                }
                return;
            }

            // --- State transition: workflow-core engine ---
            const evalFeatureId = name;
            const repoPath = process.cwd();

            // Synthesize agent-ready signals from agent status files
            const snapshot = await wf.showFeature(repoPath, evalFeatureId);
            for (const [agId, agState] of Object.entries(snapshot.agents)) {
                if (agState.status === 'ready') continue;
                const legacyStatus = readAgentStatus(evalFeatureId, agId);
                if (legacyStatus && legacyStatus.status === 'submitted') {
                    await wf.signalAgentReady(repoPath, evalFeatureId, agId);
                }
            }

            if (forceEval) {
                const forcedSnapshot = await wf.showFeature(repoPath, evalFeatureId);
                for (const [agId, agState] of Object.entries(forcedSnapshot.agents)) {
                    if (agState.status === 'ready') continue;
                    await wf.signalAgentReady(repoPath, evalFeatureId, agId);
                }
            }

            const specFrom = findFile(PATHS.features, name, ['03-in-progress']);
            const specTo = specFrom
                ? path.join(PATHS.features.root, '04-in-evaluation', specFrom.file)
                : null;

            // Check current engine state for resume
            const evalSnapshot = await wf.showFeature(repoPath, evalFeatureId);

            if (evalSnapshot.currentSpecState === 'evaluating') {
                // Resume: run pending effects
                const resumeResult = await persistAndRunEffects(repoPath, evalFeatureId, []);
                if (resumeResult.kind === 'busy') { console.error(`⏳ ${resumeResult.message}`); return; }
                console.log(`🔧 Eval transition resumed via workflow-core engine`);
            } else if (evalSnapshot.currentSpecState === 'implementing') {
                // Request eval transition — XState enforces allAgentsReady guard
                try {
                    await wf.requestFeatureEval(repoPath, evalFeatureId);
                } catch (err) {
                    if (err.message && err.message.includes('is invalid')) {
                        console.error(`❌ Cannot eval feature ${evalFeatureId}: not all agents are ready.`);
                        return;
                    }
                    throw err;
                }

                // Register and run eval effects
                const evalEffects = [];
                if (specFrom && specTo) {
                    evalEffects.push({ id: 'eval.move_spec', type: 'move_spec', payload: { fromPath: specFrom.fullPath, toPath: specTo } });
                }
                evalEffects.push({ id: 'eval.write_eval_stub', type: 'write_eval_stub', payload: {} });

                const evalResult = await persistAndRunEffects(repoPath, evalFeatureId, evalEffects);
                if (evalResult.kind === 'error') { console.error(`❌ ${evalResult.message}`); return; }
                if (evalResult.kind === 'busy') { console.error(`⏳ ${evalResult.message}`); return; }

                console.log(`🔧 Eval transition completed via workflow-core engine`);
            } else {
                console.error(`❌ Cannot eval feature ${evalFeatureId} from state "${evalSnapshot.currentSpecState}".`);
                return;
            }

            // Re-find spec in evaluation (engine moved it via effects)
            let found = findFile(PATHS.features, name, ['04-in-evaluation']);
            if (!found) {
                // Idempotent fallback: try to move manually if effect didn't cover it
                found = findFile(PATHS.features, name, ['03-in-progress']);
                if (found) {
                    moveFile(found, '04-in-evaluation', null, { actor: 'cli/feature-eval' });
                    found = findFile(PATHS.features, name, ['04-in-evaluation']);
                }
                if (!found) return console.error(`❌ Could not find feature "${name}" in in-progress or in-evaluation.`);
            }

            const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
            if (!match) return console.warn("⚠️  Could not parse filename.");
            const [_, num, desc] = match;

            // Detect mode: Find all worktrees for this feature
            const featureWorktreesForEval = filterByFeatureId(findWorktrees(), num);
            const worktrees = featureWorktreesForEval.map(wt => {
                const agentConfig = loadAgentConfig(wt.agent);
                return { path: wt.path, agent: wt.agent, name: agentConfig ? agentConfig.name : wt.agent };
            });

            const evalMode = worktrees.length > 1 ? 'fleet' : 'drive';

            // --- Agent completion check ---
            if (worktrees.length > 0 && !forceEval) {
                const incompleteAgents = collectIncompleteFeatureEvalAgents({ featureNum: num, worktrees, engineSnapshot: evalSnapshot });
                if (incompleteAgents.length > 0) {
                    console.log('');
                    console.log(`⚠️  ${incompleteAgents.length} agent(s) not yet submitted:`);
                    incompleteAgents.forEach(a => {
                        console.log(`   ${a.agent} (${a.name}) — status: ${a.status}`);
                        const reconnectCmd = a.agent ? `aigon terminal-focus ${num} ${a.agent}` : `aigon terminal-focus ${num}`;
                        console.log(`     → ${reconnectCmd}`);
                    });
                    console.log('');
                    console.log(`   To proceed anyway: aigon feature-eval ${num} --force`);
                    console.log('');
                    return;
                }
            }

            // --- Cross-provider bias detection ---
            const evalSession = detectActiveAgentSession();
            const evalAgent = evalSession.detected ? evalSession.agentId : null;
            const evalCliConfig = evalAgent ? getAgentCliConfig(evalAgent) : null;
            const evalModel = evalCliConfig?.models?.['evaluate'] || null;

            if (!allowSameModel && evalAgent) {
                if (evalMode === 'fleet') {
                    // Fleet: warn if evaluator matches ANY implementer's family
                    const sameFamily = worktrees.filter(w => isSameProviderFamily(evalAgent, w.agent));
                    if (sameFamily.length > 0) {
                        const evalFamily = PROVIDER_FAMILIES[evalAgent] || evalAgent;
                        const implAgents = sameFamily.map(w => w.agent).join(', ');
                        const altAgents = Object.keys(PROVIDER_FAMILIES)
                            .filter(a => !isSameProviderFamily(evalAgent, a) && PROVIDER_FAMILIES[a] !== 'varies')
                            .slice(0, 2);
                        console.log('');
                        console.log('⚠️  Self-evaluation bias warning:');
                        console.log(`   Evaluator:    ${evalAgent} (${evalFamily})`);
                        console.log(`   Implementer(s) same family: ${implAgents}`);
                        console.log('');
                        console.log('   Same-family evaluation inflates win rates by ~25% (MT-Bench, 2023).');
                        if (altAgents.length > 0) {
                            const alt = altAgents[0];
                            console.log(`   Consider:  aigon feature-eval ${num} --agent=${alt}`);
                        }
                        console.log(`   Or suppress: aigon feature-eval ${num} --allow-same-model-judge`);
                        console.log('');
                    }
                } else {
                    // Solo: detect implementer from worktree or branch
                    let implAgent = null;
                    if (worktrees.length === 1) {
                        implAgent = worktrees[0].agent;
                    } else {
                        // Try to infer from branch name
                        try {
                            const branch = getCurrentBranch();
                            const branchMatch = branch.match(/^feature-\d+-([a-z]{2})-/);
                            if (branchMatch) implAgent = branchMatch[1];
                        } catch (_) { /* ignore */ }
                    }

                    if (implAgent && isSameProviderFamily(evalAgent, implAgent)) {
                        const evalFamily = PROVIDER_FAMILIES[evalAgent] || evalAgent;
                        const altAgents = Object.keys(PROVIDER_FAMILIES)
                            .filter(a => !isSameProviderFamily(evalAgent, a) && PROVIDER_FAMILIES[a] !== 'varies')
                            .slice(0, 2);
                        console.log('');
                        console.log('⚠️  Self-evaluation bias warning:');
                        console.log(`   Implementer: ${implAgent} (${PROVIDER_FAMILIES[implAgent] || implAgent})`);
                        console.log(`   Evaluator:   ${evalAgent} (${evalFamily})`);
                        console.log('');
                        console.log('   Same-family evaluation inflates win rates by ~25% (MT-Bench, 2023).');
                        if (altAgents.length > 0) {
                            const alt = altAgents[0];
                            console.log(`   Consider:  aigon feature-eval ${num} --agent=${alt}`);
                        }
                        console.log(`   Or suppress: aigon feature-eval ${num} --allow-same-model-judge`);
                        console.log('');
                    }
                }
            }

            // Create evaluation template
            const evalsDir = path.join(PATHS.features.root, 'evaluations');
            if (!fs.existsSync(evalsDir)) fs.mkdirSync(evalsDir, { recursive: true });

            const evalFile = path.join(evalsDir, `feature-${num}-eval.md`);
            if (!fs.existsSync(evalFile)) {
                let evalTemplate;

                if (evalMode === 'fleet') {
                    // Fleet mode: comparison template
                    const agentList = worktrees.map(w => `- [ ] **${w.agent}** (${w.name}): \`${w.path}\``).join('\n');

                    evalTemplate = `# Evaluation: Feature ${num} - ${desc}

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: \`./docs/specs/features/04-in-evaluation/${found.file}\`

## Implementations to Compare

${agentList}

## Evaluation Criteria

| Criteria | ${worktrees.map(w => w.agent).join(' | ')} |
|----------|${worktrees.map(() => '---').join('|')}|
| Code Quality | ${worktrees.map(() => '').join(' | ')} |
| Spec Compliance | ${worktrees.map(() => '').join(' | ')} |
| Performance | ${worktrees.map(() => '').join(' | ')} |
| Maintainability | ${worktrees.map(() => '').join(' | ')} |

## Summary

### Strengths & Weaknesses

${worktrees.map(w => `#### ${w.agent} (${w.name})
- Strengths:
- Weaknesses:
`).join('\n')}

## Recommendation

**Winner:** (to be determined after review)

**Rationale:**

`;
                } else {
                    // Drive mode: code review template
                    const soloBranch = worktrees.length === 1
                        ? `feature-${num}-${worktrees[0].agent}-${desc}`
                        : `feature-${num}-${desc}`;
                    evalTemplate = `# Evaluation: Feature ${num} - ${desc}

**Mode:** Drive (Code review)

## Spec
See: \`./docs/specs/features/04-in-evaluation/${found.file}\`

## Implementation
Branch: \`${soloBranch}\`

## Code Review Checklist

### Spec Compliance
- [ ] All requirements from spec are met
- [ ] Feature works as described
- [ ] Edge cases are handled

### Code Quality
- [ ] Follows project coding standards
- [ ] Code is readable and maintainable
- [ ] Proper error handling
- [ ] No obvious bugs or issues

### Testing
- [ ] Feature has been tested manually
- [ ] Tests pass (if applicable)
- [ ] Edge cases are tested

### Documentation
- [ ] Code is adequately commented where needed
- [ ] README updated (if needed)
- [ ] Breaking changes documented (if any)

### Security
- [ ] No obvious security vulnerabilities
- [ ] Input validation where needed
- [ ] No hardcoded secrets or credentials

## Review Notes

### Strengths


### Areas for Improvement


## Decision

- [ ] **Approved** - Ready to merge
- [ ] **Needs Changes** - Issues must be addressed before merging

**Rationale:**

`;
                }

                fs.writeFileSync(evalFile, evalTemplate);
                console.log(`📝 Created: ./docs/specs/features/evaluations/feature-${num}-eval.md`);
            } else {
                console.log(`ℹ️  Evaluation file already exists: feature-${num}-eval.md`);
            }

            console.log(`\n📋 Feature ${num} ready for evaluation`);
            console.log(`   Mode: ${evalMode === 'fleet' ? '🚛 Fleet (comparison)' : '🚗 Drive (code review)'}`);
            if (evalAgent) {
                const modelDisplay = evalModel ? evalModel : '(default)';
                console.log(`   Evaluator: ${evalAgent} (${PROVIDER_FAMILIES[evalAgent] || 'unknown'}) — model: ${modelDisplay}`);
            }

            if (evalMode === 'fleet') {
                console.log(`\n📂 Worktrees to compare:`);
                worktrees.forEach(w => console.log(`   ${w.agent}: ${w.path}`));
                console.log(`\n🔍 Review each implementation, then pick a winner.`);
                console.log(`\n⚠️  TO MERGE THE WINNER INTO MAIN, run:`);
                worktrees.forEach(w => {
                    console.log(`   aigon feature-close ${num} ${w.agent}    # merge ${w.name}'s implementation`);
                });
            } else {
                console.log(`\n🔍 Review the implementation and complete the evaluation checklist.`);
                console.log(`\n⚠️  TO MERGE INTO MAIN, run:`);
                console.log(`   aigon feature-close ${num}`);
            }
        },

        'feature-review': (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-review <ID>\n\nLaunches a review agent in the feature's worktree.\nMust be run from the main repo, not from inside a worktree.");

            // Resolve the worktree — review MUST run in the worktree, never main
            const worktrees = filterByFeatureId(findWorktrees(), id);
            if (worktrees.length === 0) {
                return console.error(`❌ No worktree found for feature ${id}.\n   Reviews require a worktree. Was this feature started with a worktree?`);
            }
            // Pick the first worktree (solo) or the one matching the implementing agent
            const wt = worktrees[0];
            const currentBranch = ctx.git.getCurrentBranch();
            if (currentBranch === 'main' || currentBranch === 'master') {
                console.log(`📂 Worktree found: ${wt.path}`);
                console.log(`   Review will run in the worktree, not on ${currentBranch}.`);
            }
            // The actual review is driven by the slash command template.
            // This handler just validates and prints context — the agent
            // is launched by feature-open (dashboard) or the slash command.
            printAgentContextWarning('feature-review', id);
        },

        'feature-close': async (args) => {
            const close = require('../feature-close');

            // Phase 1: Resolve target (args, spec, mode, branch)
            const target = close.resolveCloseTarget(args, {
                PATHS, findFile, getWorktreeBase, findWorktrees, filterByFeatureId,
                branchExists, resolveFeatureSpecInfo, gitLib,
            });
            if (!target.ok) {
                if (target.delegate) {
                    console.log(`📡 Delegating 'feature-close' to main repo...`);
                    const argsStr = args.map(a => JSON.stringify(a)).join(' ');
                    execSync(`node "${path.join(target.delegate, 'aigon-cli.js')}" feature-close ${argsStr}`, { stdio: 'inherit', cwd: target.delegate });
                    return;
                }
                return console.error(target.error);
            }

            // Phase 2: Resume check — detect interrupted close
            const resumeState = await close.checkResumeState(target.repoPath, target.name, persistAndRunEffects);
            if (resumeState === 'done') return;
            if (resumeState === 'busy' || resumeState === 'error') return;
            const isResume = resumeState === 'resumed';

            // Phase 3: Pre-hook
            if (!runPreHook('feature-close', target.hookContext)) return;

            // Phase 4: Auto-commit and push (skip on resume — merge already done)
            if (!isResume) {
                const commitResult = close.autoCommitAndPush(target, {
                    getCurrentBranch, runGit,
                    getGitStatusPorcelain: u.getGitStatusPorcelain,
                    getWorktreeStatus: u.getWorktreeStatus,
                });
                if (!commitResult.ok) return console.error(commitResult.error);
            }

            // Phase 5: Merge (skip on resume)
            let mergeResult;
            if (!isResume) {
                mergeResult = close.mergeFeatureBranch(target, { getDefaultBranch, runGit });
                if (!mergeResult.ok) return console.error(mergeResult.error);
            } else {
                mergeResult = { ok: true, defaultBranch: getDefaultBranch(), preMergeBaseRef: getDefaultBranch() };
            }

            // Phase 6: Telemetry
            const allAgents = await close.resolveAllAgents(target.repoPath, target.name, target.agentId);
            close.recordCloseTelemetry(target, mergeResult, allAgents, {
                PATHS, getWorktreeBase, getFeatureGitSignals,
                estimateExpectedScopeFiles, upsertLogFrontmatterScalars,
            });

            // Phase 6.5: Snapshot final stats (before worktree is deleted)
            close.snapshotFinalStats(target, {
                getDefaultBranch,
                preMergeBaseRef: mergeResult.preMergeBaseRef,
            });

            // Phase 7: Engine state transition
            const engineResult = await close.closeEngineState(target, allAgents, {
                PATHS, findFile, defaultEffectExecutor, persistAndRunEffects,
                resolveFeatureMode, safeWriteWithStatus: u.safeWriteWithStatus,
            });
            if (!engineResult.ok) return console.error(engineResult.error);
            if (engineResult.alreadyClosed) return;

            // Phase 8: Commit spec move
            close.commitSpecMove(target, engineResult, { PATHS, findFile, runGit, stagePaths });

            // Phase 9: Cleanup worktree and branch
            close.cleanupWorktreeAndBranch(target, {
                runGit, safeRemoveWorktree: u.safeRemoveWorktree,
                getWorktreeStatus: u.getWorktreeStatus,
            });

            // Phase 10: Fleet adoption (multi-agent only)
            close.handleFleetAdoption(target, {
                listBranches, findWorktrees, filterByFeatureId,
                safeRemoveWorktree: u.safeRemoveWorktree,
                removeWorktreePermissions, removeWorktreeTrust,
            });

            // Phase 11: Post-close actions
            close.postCloseActions(target, {
                gcDevServers, runPostHook, loadProjectConfig, runDeployCommand,
            });
        },

        'feature-cleanup': (args) => {
            const actionCtx = buildActionContext(ctx.git);
            try {
                const result = assertActionAllowed('feature-cleanup', actionCtx);
                if (result && result.delegate) {
                    console.log(`📡 Delegating 'feature-cleanup' to main repo...`);
                    const argsStr = args.map(a => JSON.stringify(a)).join(' ');
                    execSync(`node "${path.join(result.delegate, 'aigon-cli.js')}" feature-cleanup ${argsStr}`, { stdio: 'inherit', cwd: result.delegate });
                    return;
                }
            } catch (e) { return console.error(`❌ ${e.message}`); }
            const id = args[0];
            const pushFlag = args.includes('--push');
            if (!id) return console.error("Usage: aigon feature-cleanup <ID> [--push]\n\nRemoves all worktrees and branches for a feature.\n\nOptions:\n  --push  Push branches to origin before deleting locally\n\nExample: aigon feature-cleanup 55");

            const paddedId = String(id).padStart(2, '0');
            const unpaddedId = String(parseInt(id, 10));

            // Build hook context
            const hookContext = {
                featureId: paddedId
            };

            // Run pre-hook (can abort the command)
            if (!runPreHook('feature-cleanup', hookContext)) {
                return;
            }

            // Remove worktrees and collect paths for permission cleanup
            let worktreeCount = 0;
            const removedWorktreePaths = [];
            try {
                filterByFeatureId(findWorktrees(), id).forEach(wt => {
                    const wtStatus = u.getWorktreeStatus(wt.path);
                    if (wtStatus) {
                        console.warn(`   ⚠️  Worktree has uncommitted changes — moving to Trash: ${wt.path}`);
                    }
                    console.log(`   Removing worktree: ${wt.path}`);
                    removedWorktreePaths.push(wt.path);
                    if (u.safeRemoveWorktree(wt.path)) { worktreeCount++; }
                    else { console.error(`   ❌ Failed to remove ${wt.path}`); }
                });
            } catch (e) { console.error("❌ Error reading git worktrees."); }

            // Clean up worktree permissions and trust from Claude settings
            if (removedWorktreePaths.length > 0) {
                removeWorktreePermissions(removedWorktreePaths);
                removeWorktreeTrust(removedWorktreePaths);
            }

            // Find and handle branches
            const featureBranches = [];
            try {
                listBranches().forEach(branch => {
                    if (branch.startsWith(`feature-${paddedId}-`) || branch.startsWith(`feature-${unpaddedId}-`)) {
                        featureBranches.push(branch);
                    }
                });
            } catch (e) {
                // Ignore errors
            }

            let branchCount = 0;
            if (featureBranches.length > 0) {
                featureBranches.forEach(branch => {
                    if (pushFlag) {
                        try {
                            execSync(`git push -u origin ${branch}`, { stdio: 'pipe' });
                            console.log(`   📤 Pushed: ${branch}`);
                        } catch (e) {
                            console.warn(`   ⚠️  Could not push ${branch} (may already exist on remote)`);
                        }
                    }
                    try {
                        execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
                        console.log(`   🗑️  Deleted local branch: ${branch}`);
                        branchCount++;
                    } catch (e) {
                        console.error(`   ❌ Failed to delete ${branch}`);
                    }
                });
            }

            // Clean up stale dev-proxy entries
            try {
                const gcRemoved = gcDevServers();
                if (gcRemoved > 0) {
                    console.log(`🧹 Cleaned ${gcRemoved} stale dev-proxy entr${gcRemoved === 1 ? 'y' : 'ies'}`);
                }
            } catch (e) { /* non-fatal */ }

            console.log(`\n✅ Cleanup complete: ${worktreeCount} worktree(s), ${branchCount} branch(es) removed.`);
            if (!pushFlag && branchCount > 0) {
                console.log(`💡 Tip: Use 'aigon feature-cleanup ${id} --push' to push branches to origin before deleting.`);
            }

            // Run post-hook (won't fail the command)
            runPostHook('feature-cleanup', hookContext);
        },

        'feature-reset': (args) => {
            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-reset <ID>\n\nFully resets a feature: removes worktrees, branches, state, and moves spec back to backlog.\n\nExample: aigon feature-reset 01");

            const paddedId = String(id).padStart(2, '0');
            const unpaddedId = String(parseInt(id, 10));

            // 1. Run feature-cleanup (worktrees + branches)
            console.log(`\n🔄 Resetting feature ${paddedId}...\n`);

            // Remove worktrees
            let worktreeCount = 0;
            const removedWorktreePaths = [];
            try {
                filterByFeatureId(findWorktrees(), id).forEach(wt => {
                    console.log(`   Removing worktree: ${wt.path}`);
                    removedWorktreePaths.push(wt.path);
                    if (u.safeRemoveWorktree(wt.path)) { worktreeCount++; }
                    else { console.error(`   ❌ Failed to remove ${wt.path}`); }
                });
            } catch (e) { /* ignore */ }

            if (removedWorktreePaths.length > 0) {
                removeWorktreePermissions(removedWorktreePaths);
                removeWorktreeTrust(removedWorktreePaths);
            }

            // Remove branches
            let branchCount = 0;
            try {
                listBranches().forEach(branch => {
                    if (branch.startsWith(`feature-${paddedId}-`) || branch.startsWith(`feature-${unpaddedId}-`)) {
                        try {
                            execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
                            console.log(`   🗑️  Deleted branch: ${branch}`);
                            branchCount++;
                        } catch (e) { /* ignore */ }
                    }
                });
            } catch (e) { /* ignore */ }

            // 2. Remove manifest state files
            let stateCount = 0;
            const stateDir = getStateDir();
            if (fs.existsSync(stateDir)) {
                const stateFiles = fs.readdirSync(stateDir).filter(f =>
                    f.startsWith(`feature-${paddedId}`) || f.startsWith(`feature-${unpaddedId}-`)
                );
                stateFiles.forEach(f => {
                    try {
                        fs.unlinkSync(path.join(stateDir, f));
                        console.log(`   🗑️  Removed state: ${f}`);
                        stateCount++;
                    } catch (e) { /* ignore */ }
                });
            }

            // 3. Move spec back to backlog
            let specMoved = false;
            const found = findFile(PATHS.features, id, ['03-in-progress', '04-in-evaluation', '05-done', '06-paused']);
            if (found) {
                const targetDir = path.join(PATHS.features.root, '02-backlog');
                const specBasename = path.basename(found.fullPath);
                const targetPath = path.join(targetDir, specBasename);
                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                fs.renameSync(found.fullPath, targetPath);
                console.log(`   📂 Moved spec to backlog: ${specBasename}`);
                specMoved = true;
            }

            // 4. Clean stale dev-proxy entries
            try { gcDevServers(); } catch (e) { /* non-fatal */ }

            console.log(`\n✅ Reset complete: ${worktreeCount} worktree(s), ${branchCount} branch(es), ${stateCount} state file(s) removed${specMoved ? ', spec moved to backlog' : ''}.`);
        },

        'feature-backfill-timestamps': (args) => {
            const dryRun = args.includes('--dry-run');
            const repoArg = args.find(a => a.startsWith('--repo='));
            const targetRepo = repoArg ? repoArg.slice('--repo='.length) : null;
            const excludeAboveArg = args.find(a => a.startsWith('--exclude-above='));
            const excludeAboveHours = excludeAboveArg ? parseFloat(excludeAboveArg.slice('--exclude-above='.length)) : null;
            // Active hours: 08:00 – 23:00 local → anything outside = "autonomous"
            const activeHourStart = 8;
            const activeHourEnd = 23;

            const repos = readConductorReposFromGlobalConfig();
            if (!repos || repos.length === 0) {
                return console.error('❌ No repos registered in global config. Add repos to ~/.aigon/config.json first.');
            }

            // repos is an array of path strings
            const repoPaths = repos.map(r => (typeof r === 'string' ? r : r.path)).filter(Boolean);

            const filteredPaths = targetRepo
                ? repoPaths.filter(p => p.includes(targetRepo))
                : repoPaths;

            if (filteredPaths.length === 0) {
                return console.error(`❌ No repos matched --repo=${targetRepo}`);
            }

            let totalPatched = 0;
            let totalSkipped = 0;
            let totalErrors = 0;

            filteredPaths.forEach(repoPath => {
                if (!repoPath || !fs.existsSync(repoPath)) return;

                const logsDir = path.join(repoPath, 'docs/specs/features/logs');
                if (!fs.existsSync(logsDir)) return;

                const logFiles = fs.readdirSync(logsDir)
                    .filter(f => f.endsWith('-log.md') && !fs.lstatSync(path.join(logsDir, f)).isDirectory())
                    .sort();

                console.log(`\n📁 ${repoPath} (${logFiles.length} logs)`);

                logFiles.forEach(logFile => {
                    const logPath = path.join(logsDir, logFile);
                    let content;
                    try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { totalErrors++; return; }

                    const { fields, events } = _parseLogFrontmatterForBackfill(content);
                    const patches = {};

                    // --- Infer startedAt ---
                    if (!fields.startedAt) {
                        let startedAt = null;
                        try {
                            const gitOut = execSync(
                                `git -C "${repoPath}" log --follow --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                { encoding: 'utf8', timeout: 8000 }
                            ).trim();
                            if (gitOut) startedAt = gitOut.split('\n').pop().trim(); // oldest = last line
                        } catch (_) {}

                        // Also try logs/ root (before selected/)
                        if (!startedAt) {
                            try {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log --follow --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) startedAt = gitOut.split('\n').pop().trim();
                            } catch (_) {}
                        }

                        if (startedAt) patches.setStartedAt = startedAt;
                    }

                    // --- Infer completedAt ---
                    if (!fields.completedAt) {
                        let completedAt = null;
                        try {
                            const gitOut = execSync(
                                `git -C "${repoPath}" log --diff-filter=A --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                { encoding: 'utf8', timeout: 8000 }
                            ).trim();
                            if (gitOut) completedAt = gitOut.split('\n')[0].trim(); // newest = first line
                        } catch (_) {}

                        if (!completedAt) {
                            try {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log -1 --format="%aI" -- "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) completedAt = gitOut.trim();
                            } catch (_) {}
                        }

                        if (completedAt) patches.forceCompletedAt = completedAt;
                    }

                    // --- Auto-set cycleTimeExclude if --exclude-above threshold exceeded ---
                    if (excludeAboveHours !== null && !isNaN(excludeAboveHours) && fields.cycleTimeExclude === undefined) {
                        const startTs = patches.setStartedAt || fields.startedAt;
                        const endTs = patches.forceCompletedAt || fields.completedAt;
                        if (startTs && endTs) {
                            const durationHours = (new Date(endTs).getTime() - new Date(startTs).getTime()) / 3600000;
                            if (durationHours > excludeAboveHours) {
                                patches.setCycleTimeExclude = true;
                            }
                        }
                    }

                    // --- Infer autonomyRatio ---
                    if (fields.autonomyRatio === undefined) {
                        let autonomyRatio = null;
                        try {
                            const featureMatch = logFile.match(/^feature-(\d+)-/);
                            if (featureMatch) {
                                const gitOut = execSync(
                                    `git -C "${repoPath}" log --format="%aI" -- "docs/specs/features/logs/${logFile}" "docs/specs/features/logs/${logFile}" 2>/dev/null`,
                                    { encoding: 'utf8', timeout: 8000 }
                                ).trim();
                                if (gitOut) {
                                    const commitTimes = gitOut.split('\n').map(s => s.trim()).filter(Boolean);
                                    if (commitTimes.length > 0) {
                                        const autonomous = commitTimes.filter(ts => {
                                            const d = new Date(ts);
                                            const hour = d.getHours(); // local time
                                            return hour < activeHourStart || hour >= activeHourEnd;
                                        });
                                        autonomyRatio = (autonomous.length / commitTimes.length).toFixed(2);
                                    }
                                }
                            }
                        } catch (_) {}

                        if (autonomyRatio !== null) patches.setAutonomyRatio = autonomyRatio;
                    }

                    const patchCount = Object.keys(patches).length;
                    if (patchCount === 0) {
                        totalSkipped++;
                        return;
                    }

                    const patchDesc = Object.entries(patches).map(([k, v]) => {
                        const name = k.replace('set', '').replace('force', '').toLowerCase();
                        const val = typeof v === 'string' ? v.slice(0, 10) : v;
                        return `${name}=${val}`;
                    }).join(', ');

                    console.log(`  ${dryRun ? '[dry-run] ' : ''}${logFile}: ${patchDesc}`);

                    if (!dryRun) {
                        // NOTE: Log frontmatter writes removed — timestamps now live in manifests.
                        // This command is now dry-run only (reports what would change).
                        console.log(`    ⚠️  Skipped write — log frontmatter is deprecated. Use manifests for timestamps.`);
                        totalSkipped++;
                    } else {
                        totalPatched++;
                    }
                });
            });

            console.log(`\n${dryRun ? '[dry-run] ' : ''}✅ Done: ${totalPatched} patched, ${totalSkipped} skipped (already set), ${totalErrors} errors`);
            if (dryRun) console.log('   Run without --dry-run to apply patches.');
        },

        'feature-autonomous-start': async (args) => {
            const options = parseCliOptions(args);
            const subcommand = options._[0];
            const mainRepo = resolveMainRepoPath(process.cwd(), gitLib);
            const selfCommands = module.exports(ctx);

            if (subcommand === '__run-loop') {
                const featureNum = String(options._[1] || '').trim();
                if (!featureNum || !/^\d+$/.test(featureNum)) {
                    console.error('Usage: aigon feature-autonomous-start __run-loop <feature-id> --agents=<agent,agent> --stop-after=<implement|eval|close> [--eval-agent=<agent>]');
                    process.exitCode = 1;
                    return;
                }

                const agentsRaw = String(getOptionValue(options, 'agents') || '').trim();
                const agentIds = agentsRaw.split(',').map(v => v.trim()).filter(Boolean);
                if (agentIds.length === 0) {
                    console.error('❌ Missing --agents for AutoConductor loop.');
                    process.exitCode = 1;
                    return;
                }
                const stopAfter = String(getOptionValue(options, 'stop-after') || 'close').trim();
                if (!['implement', 'eval', 'close'].includes(stopAfter)) {
                    console.error(`❌ Invalid --stop-after value: ${stopAfter}`);
                    process.exitCode = 1;
                    return;
                }
                const evalAgent = String(getOptionValue(options, 'eval-agent') || '').trim() || null;
                const pollSeconds = Math.max(5, parseInt(String(getOptionValue(options, 'poll-seconds') || '30'), 10) || 30);
                const isFleet = agentIds.length > 1;
                const effectiveStopAfter = isFleet
                    ? (stopAfter === 'close' ? 'eval' : stopAfter)
                    : (stopAfter === 'eval' ? 'close' : stopAfter);
                const effectiveEvalAgent = isFleet ? (evalAgent || agentIds[0]) : null;
                let evalTriggered = false;
                let expectedEvalSessionName = null;
                let closeTriggered = false;
                let postTriggerPolls = 0;
                const MAX_POST_TRIGGER_POLLS = 10;

                console.log(`🤖 AutoConductor started for feature ${featureNum}`);
                console.log(`   agents: ${agentIds.join(', ')}`);
                console.log(`   stop-after: ${effectiveStopAfter}`);
                if (isFleet && stopAfter === 'close') {
                    console.log('   note: fleet --stop-after=close is not supported yet; using --stop-after=eval');
                }
                if (isFleet) {
                    console.log(`   evaluator: ${effectiveEvalAgent}`);
                }
                console.log(`   poll interval: ${pollSeconds}s`);
                console.log('');

                while (true) {
                    const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(mainRepo, 'feature', featureNum);
                    if (!snapshot) {
                        console.error(`❌ No workflow snapshot found for feature ${featureNum}.`);
                        process.exitCode = 1;
                        return;
                    }
                    const stage = snapshot.currentSpecState || snapshot.lifecycle || 'unknown';
                    const allReady = agentIds.every(agent => {
                        const status = snapshot.agents && snapshot.agents[agent] ? snapshot.agents[agent].status : null;
                        return status === 'ready' || status === 'submitted';
                    });

                    if (effectiveStopAfter === 'implement' && allReady) {
                        console.log('✅ Implementation complete. AutoConductor stopping at implement.');
                        if (isFleet) {
                            console.log(`➡️  Next step: aigon feature-eval ${featureNum} --agent=${effectiveEvalAgent}`);
                        } else {
                            console.log(`➡️  Next step: aigon feature-close ${featureNum}`);
                        }
                        return;
                    }

                    if (!isFleet) {
                        if (effectiveStopAfter === 'close' && allReady && !closeTriggered) {
                            console.log(`🚀 Triggering: aigon feature-close ${featureNum}`);
                            const closeResult = runAigonCliCommand(mainRepo, ['feature-close', featureNum]);
                            if (closeResult.stdout) process.stdout.write(closeResult.stdout);
                            if (closeResult.stderr) process.stderr.write(closeResult.stderr);
                            if (closeResult.error || closeResult.status !== 0) {
                                console.error(`❌ feature-close failed for feature ${featureNum}.`);
                                process.exitCode = 1;
                                return;
                            }
                            closeTriggered = true;
                            postTriggerPolls = 0;
                        }
                        if (closeTriggered) {
                            postTriggerPolls++;
                            const next = workflowSnapshotAdapter.readWorkflowSnapshotSync(mainRepo, 'feature', featureNum);
                            if (next && (next.currentSpecState === 'done' || next.lifecycle === 'done')) {
                                console.log('✅ Feature closed. AutoConductor finished.');
                                return;
                            }
                            if (postTriggerPolls >= MAX_POST_TRIGGER_POLLS) {
                                console.error(`❌ feature-close succeeded but state did not reach 'done' after ${MAX_POST_TRIGGER_POLLS} polls. Exiting.`);
                                process.exitCode = 1;
                                return;
                            }
                        }
                    } else {
                        if (effectiveStopAfter === 'eval' && allReady && !evalTriggered) {
                            // Spawn the eval agent session directly — the agent does the
                            // state transition itself (feature-eval --no-launch from inside
                            // the session). Pre-calling feature-eval here would double-transition.
                            const evalSessionName = buildTmuxSessionName(featureNum, effectiveEvalAgent, {
                                repo: path.basename(mainRepo),
                                desc: featureDesc,
                                entityType: 'f',
                                role: 'eval'
                            });
                            expectedEvalSessionName = evalSessionName;
                            const evalCommand = buildAgentCommand({
                                agent: effectiveEvalAgent,
                                featureId: featureNum,
                                path: mainRepo,
                                desc: featureDesc,
                                repoPath: mainRepo
                            }, 'evaluate');

                            if (tmuxSessionExists(evalSessionName)) {
                                console.log(`ℹ️  Eval session already running: ${evalSessionName}`);
                            } else {
                                createDetachedTmuxSession(evalSessionName, mainRepo, evalCommand);
                                if (!tmuxSessionExists(evalSessionName)) {
                                    console.error(`❌ Eval session did not start: ${evalSessionName}`);
                                    process.exitCode = 1;
                                    return;
                                }
                                console.log(`✅ Started eval session: ${evalSessionName}`);
                            }

                            evalTriggered = true;
                            postTriggerPolls = 0;
                        }
                        if (evalTriggered) {
                            postTriggerPolls++;
                            const next = workflowSnapshotAdapter.readWorkflowSnapshotSync(mainRepo, 'feature', featureNum);
                            const evalSessionRunning = expectedEvalSessionName ? tmuxSessionExists(expectedEvalSessionName) : false;
                            if (next && next.currentSpecState === 'evaluating' && evalSessionRunning) {
                                console.log('✅ Evaluation started. AutoConductor finished.');
                                console.log('➡️  Next step: choose winner, then run aigon feature-close <id> <winner-agent>');
                                return;
                            }
                            if (postTriggerPolls >= MAX_POST_TRIGGER_POLLS) {
                                if (next && next.currentSpecState === 'evaluating' && !evalSessionRunning) {
                                    console.error(`❌ feature-eval moved feature ${featureNum} into evaluating, but no eval tmux session is running.`);
                                } else {
                                    console.error(`❌ feature-eval succeeded but state did not reach 'evaluating' after ${MAX_POST_TRIGGER_POLLS} polls. Exiting.`);
                                }
                                process.exitCode = 1;
                                return;
                            }
                        }
                    }

                    console.log(`[${new Date().toLocaleTimeString()}] waiting... state=${stage} allReady=${allReady ? 'yes' : 'no'}`);
                    spawnSync('sleep', [String(pollSeconds)], { stdio: 'ignore' });
                }
            }

            if (subcommand === 'status') {
                const idArg = String(options._[1] || '').trim();
                if (!idArg) {
                    console.error('Usage: aigon feature-autonomous-start status <feature-id>');
                    process.exitCode = 1;
                    return;
                }
                const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(mainRepo, 'feature', idArg);
                const autoSessionName = findAutoSessionNameByFeatureId(idArg);
                const autoSessionRunning = Boolean(autoSessionName);

                console.log(`Feature ${String(idArg).padStart(2, '0')} autonomous status`);
                console.log(`AutoConductor: ${autoSessionRunning ? 'running' : 'not running'}`);
                if (autoSessionName) console.log(`Session: ${autoSessionName}`);
                console.log(`Workflow state: ${snapshot ? (snapshot.currentSpecState || snapshot.lifecycle || 'unknown') : 'unknown (snapshot missing)'}`);
                if (snapshot && snapshot.agents) {
                    const agents = Object.keys(snapshot.agents).sort((a, b) => a.localeCompare(b));
                    if (agents.length > 0) {
                        console.log(`Agents: ${agents.map(agent => `${agent}:${snapshot.agents[agent].status || 'unknown'}`).join(', ')}`);
                    }
                }
                return;
            }

            const featureId = subcommand;
            if (!featureId || featureId.startsWith('-')) {
                console.error('Usage: aigon feature-autonomous-start <feature-id> <agents...> [--eval-agent=<agent>] [--stop-after=implement|eval|close]');
                console.error('       aigon feature-autonomous-start status <feature-id>');
                console.error('\nExamples:');
                console.error('  aigon feature-autonomous-start 42 cc');
                console.error('  aigon feature-autonomous-start 42 cc gg --eval-agent=gg --stop-after=eval');
                console.error('  aigon feature-autonomous-start status 42');
                process.exitCode = 1;
                return;
            }

            const positionalAgents = options._.slice(1);
            if (positionalAgents.length === 0) {
                console.error('❌ At least one implementation agent is required.');
                process.exitCode = 1;
                return;
            }
            const stopAfter = String(getOptionValue(options, 'stop-after') || 'close').trim();
            if (!['implement', 'eval', 'close'].includes(stopAfter)) {
                console.error('❌ --stop-after must be one of: implement, eval, close');
                process.exitCode = 1;
                return;
            }
            const evalAgentOption = String(getOptionValue(options, 'eval-agent') || '').trim() || null;
            let agentIds = positionalAgents;

            const availableAgents = getAvailableAgents();
            const invalidAgents = agentIds.filter(a => !availableAgents.includes(a));
            if (invalidAgents.length > 0) {
                console.error(`❌ Unknown agent(s): ${invalidAgents.join(', ')}. Available: ${availableAgents.join(', ')}`);
                process.exitCode = 1;
                return;
            }

            let existingWorktrees = [];
            try {
                existingWorktrees = filterByFeatureId(findWorktrees(), featureId);
            } catch (e) { /* no worktrees */ }

            let found = findFile(PATHS.features, featureId, ['02-backlog', '03-in-progress']);
            if (!found) {
                console.error(`❌ Could not find feature "${featureId}" in backlog or in-progress.`);
                process.exitCode = 1;
                return;
            }

            const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
            if (!match) {
                console.error('❌ Could not parse feature filename.');
                process.exitCode = 1;
                return;
            }
            const [, featureNum, featureDesc] = match;

            if (existingWorktrees.length > 0) {
                agentIds = existingWorktrees.map(wt => wt.agent);
                console.log(`ℹ️  Feature ${featureNum} already has worktrees; using existing agents: ${agentIds.join(', ')}`);
            } else {
                console.log(`🚀 Running feature-start for feature ${featureNum} with agents: ${agentIds.join(', ')}`);
                await selfCommands['feature-start']([featureId, ...agentIds]);

                try {
                    existingWorktrees = filterByFeatureId(findWorktrees(), featureId);
                } catch (e) { /* ignore */ }

                if (existingWorktrees.length === 0) {
                    console.error('❌ Feature setup failed — no worktrees created.');
                    process.exitCode = 1;
                    return;
                }
                agentIds = existingWorktrees.map(wt => wt.agent);
            }

            const isFleet = agentIds.length > 1;
            let effectiveStopAfter = stopAfter;
            if (!isFleet && effectiveStopAfter === 'eval') {
                console.log('ℹ️  Solo mode has no eval stage; treating --stop-after=eval as --stop-after=close.');
                effectiveStopAfter = 'close';
            }
            if (isFleet && effectiveStopAfter === 'close') {
                console.log('ℹ️  Fleet --stop-after=close is not supported in v1; falling back to --stop-after=eval.');
                effectiveStopAfter = 'eval';
            }
            const evalAgent = isFleet ? (evalAgentOption || agentIds[0]) : null;
            if (isFleet && evalAgent && !availableAgents.includes(evalAgent)) {
                console.error(`❌ Unknown eval agent: ${evalAgent}. Available: ${availableAgents.join(', ')}`);
                process.exitCode = 1;
                return;
            }
            if (!isFleet && evalAgentOption) {
                console.log('ℹ️  --eval-agent is ignored in solo mode.');
            }

            try {
                assertTmuxAvailable();
            } catch (e) {
                console.error(`❌ ${e.message}\n   feature-autonomous-start requires tmux.`);
                process.exitCode = 1;
                return;
            }

            const existingAuto = findAutoSessionNameByFeatureId(featureNum);
            if (existingAuto) {
                console.error(`❌ AutoConductor already running: ${existingAuto}`);
                console.error(`   Check status: aigon feature-autonomous-start status ${featureNum}`);
                process.exitCode = 1;
                return;
            }

            const autoSessionName = buildTmuxSessionName(featureNum, null, { role: 'auto', desc: featureDesc, repo: path.basename(mainRepo) });
            const loopCmdParts = [
                'aigon', 'feature-autonomous-start', '__run-loop', featureNum,
                `--agents=${agentIds.join(',')}`,
                `--stop-after=${effectiveStopAfter}`,
                '--poll-seconds=30'
            ];
            if (isFleet && evalAgent) loopCmdParts.push(`--eval-agent=${evalAgent}`);
            const loopCmd = loopCmdParts.join(' ');

            createDetachedTmuxSession(autoSessionName, mainRepo, loopCmd);
            console.log(`✅ AutoConductor started: ${autoSessionName}`);
            console.log(`   Attach: tmux attach -t ${autoSessionName}`);
            console.log(`   Status: aigon feature-autonomous-start status ${featureNum}`);
        },

        'feature-autopilot': async () => {
            console.error('❌ feature-autopilot has been removed.');
            console.error('   Use: aigon feature-autonomous-start <id> <agents...> [--eval-agent=<agent>] [--stop-after=implement|eval|close]');
            process.exitCode = 1;
        },

        'feature-open': (args) => {
            // Parse arguments: collect feature IDs, flags, and optional agent code
            const featureIds = [];
            let agentCode = null;
            let terminalOverride = null;
            let allFlag = false;

            args.forEach(arg => {
                if (arg.startsWith('--terminal=')) {
                    terminalOverride = arg.split('=')[1];
                } else if (arg.startsWith('-t=')) {
                    terminalOverride = arg.split('=')[1];
                } else if (arg.startsWith('--agent=')) {
                    agentCode = arg.split('=')[1];
                } else if (arg === '--all') {
                    allFlag = true;
                } else if (/^\d+$/.test(arg)) {
                    featureIds.push(arg);
                } else if (!arg.startsWith('-')) {
                    // Legacy: positional agent code (e.g. `feature-open 55 cc`)
                    agentCode = arg;
                }
            });

            if (featureIds.length === 0) {
                console.error(`❌ Feature ID is required.\n`);
                console.error(`Usage:`);
                console.error(`  aigon feature-open <ID> [agent]          Open single worktree`);
                console.error(`  aigon feature-open <ID> --all           Open all Fleet worktrees side-by-side`);
                console.error(`  aigon feature-open <ID> <ID>... [--agent=<code>]`);
                console.error(`                                           Open multiple features side-by-side`);
                return;
            }

            // Find all worktrees
            let allWorktrees;
            try {
                allWorktrees = findWorktrees();
            } catch (e) {
                return console.error(`❌ Could not list worktrees: ${e.message}`);
            }

            if (allWorktrees.length === 0) {
                return console.error(`❌ No worktrees found.\n\n   Create one with: aigon feature-start <ID> <agent>`);
            }

            // Determine terminal (project config > global config > default)
            const effectiveConfig = getEffectiveConfig();
            const requestedTerminal = terminalOverride || effectiveConfig.terminal;
            const terminal = process.platform === 'linux' && ['warp', 'terminal'].includes(requestedTerminal)
                ? 'tmux'
                : requestedTerminal;

            if (process.platform === 'linux' && terminal !== requestedTerminal) {
                console.log(`⚠️  Terminal "${requestedTerminal}" is not supported on Linux for feature-open. Falling back to tmux.`);
            }

            // Determine mode
            if (featureIds.length > 1) {
                // --- PARALLEL MODE: multiple features side-by-side ---
                const worktreeConfigs = [];
                const errors = [];

                for (const fid of featureIds) {
                    let matches = filterByFeatureId(allWorktrees, fid);

                    if (agentCode) {
                        const agentMap = buildAgentAliasMap();
                        const normalizedAgent = agentMap[agentCode.toLowerCase()] || agentCode.toLowerCase();
                        matches = matches.filter(wt => wt.agent === normalizedAgent);
                    }

                    if (matches.length === 0) {
                        errors.push(`Feature ${fid}: no worktree found${agentCode ? ` for agent ${agentCode}` : ''}`);
                    } else if (matches.length > 1 && !agentCode) {
                        const agents = matches.map(wt => wt.agent).join(', ');
                        errors.push(`Feature ${fid}: multiple worktrees (${agents}). Use --agent=<code> to specify.`);
                    } else {
                        const wt = matches[0];
                        worktreeConfigs.push({ ...wt, agentCommand: buildAgentCommand(wt) });
                    }
                }

                if (errors.length > 0) {
                    console.error(`❌ Cannot open parallel worktrees:\n`);
                    errors.forEach(err => console.error(`   ${err}`));
                    return;
                }

                const idsLabel = featureIds.join(', ');

                if (terminal === 'warp') {
                    const configName = `parallel-features-${featureIds.join('-')}`;
                    const title = `Parallel: Features ${idsLabel}`;

                    try {
                        const configFile = openInWarpSplitPanes(worktreeConfigs, configName, title);

                        console.log(`\n🚀 Opening ${worktreeConfigs.length} features side-by-side in Warp:`);
                        console.log(`   Features: ${idsLabel}\n`);
                        worktreeConfigs.forEach(wt => {
                            console.log(`   ${wt.featureId.padEnd(4)} ${wt.agent.padEnd(8)} → ${wt.path}`);
                        });
                        console.log(`\n   Warp config: ${configFile}`);
                    } catch (e) {
                        console.error(`❌ Failed to open Warp: ${e.message}`);
                    }
                } else if (terminal === 'tmux') {
                    console.log(`\n🚀 Opening ${worktreeConfigs.length} features via tmux sessions:`);
                    worktreeConfigs.forEach(wt => {
                        openSingleWorktree(wt, wt.agentCommand, terminal);
                    });
                } else {
                    console.log(`\n📋 Parallel worktrees for features ${idsLabel}:`);
                    console.log(`   (Side-by-side launch requires Warp terminal. Use --terminal=warp)\n`);
                    worktreeConfigs.forEach(wt => {
                        console.log(`   Feature ${wt.featureId} (${wt.agent}):`);
                        console.log(`     cd ${wt.path}`);
                        console.log(`     ${wt.agentCommand}\n`);
                    });
                }
            } else if (allFlag) {
                // --- ARENA MODE: all agents for one feature side-by-side ---
                const featureId = featureIds[0];
                const paddedId = String(featureId).padStart(2, '0');
                let worktrees = filterByFeatureId(allWorktrees, featureId);

                if (worktrees.length === 0) {
                    return console.error(`❌ No worktrees found for feature ${featureId}.\n\n   Create worktrees with: aigon feature-start ${featureId} cc gg`);
                }

                if (worktrees.length < 2) {
                    return console.error(`❌ Only 1 worktree found for feature ${featureId}. Use \`aigon feature-open ${featureId}\` for single worktrees.\n\n   To add more agents: aigon feature-start ${featureId} cc gg cx`);
                }

                // Sort by port offset order (cc=+1, gg=+2, cx=+3, cu=+4)
                const agentOrder = agentRegistry.getSortedAgentIds();
                worktrees.sort((a, b) => {
                    const aIdx = agentOrder.indexOf(a.agent);
                    const bIdx = agentOrder.indexOf(b.agent);
                    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
                });

                const profile = u.getActiveProfile();
                const worktreeConfigs = worktrees.map(wt => {
                    const agentMeta = AGENT_CONFIGS[wt.agent] || {};
                    const port = profile.devServer.enabled ? (profile.devServer.ports[wt.agent] || agentMeta.port) : null;
                    const portLabel = port ? `🔌 ${agentMeta.name || wt.agent} — Port ${port}` : null;
                    return {
                        ...wt,
                        agentCommand: buildAgentCommand(wt),
                        portLabel
                    };
                });

                if (terminal === 'warp') {
                    const configName = `arena-feature-${paddedId}`;
                    const desc = worktreeConfigs[0].desc;
                    const title = `Arena: Feature ${paddedId} - ${desc}`;

                    try {
                        const configFile = openInWarpSplitPanes(worktreeConfigs, configName, title, 'cyan');

                        console.log(`\n🚀 Opening ${worktreeConfigs.length} worktrees side-by-side in Warp:`);
                        console.log(`   Feature: ${paddedId} - ${desc}\n`);
                        worktreeConfigs.forEach(wt => {
                            console.log(`   ${wt.agent.padEnd(8)} → ${wt.path}`);
                        });
                        console.log(`\n   Warp config: ${configFile}`);
                    } catch (e) {
                        console.error(`❌ Failed to open Warp: ${e.message}`);
                    }
                } else if (terminal === 'tmux') {
                    console.log(`\n🚀 Opening ${worktreeConfigs.length} Fleet worktrees via tmux sessions:`);
                    worktreeConfigs.forEach(wt => {
                        openSingleWorktree(wt, wt.agentCommand, terminal);
                    });
                } else {
                    const desc = worktreeConfigs[0].desc;
                    console.log(`\n📋 Fleet worktrees for feature ${paddedId} - ${desc}:`);
                    console.log(`   (Side-by-side launch requires Warp terminal. Use --terminal=warp)\n`);
                    worktreeConfigs.forEach(wt => {
                        console.log(`   ${wt.agent}:`);
                        console.log(`     cd ${wt.path}`);
                        console.log(`     ${wt.agentCommand}\n`);
                    });
                }
            } else {
                // --- SINGLE MODE: open one worktree ---
                const featureId = featureIds[0];
                let worktrees = filterByFeatureId(allWorktrees, featureId);

                if (worktrees.length === 0) {
                    return console.error(`❌ No worktrees found for feature ${featureId}`);
                }

                // Filter by agent if provided
                if (agentCode) {
                    const agentMap = buildAgentAliasMap();
                    const normalizedAgent = agentMap[agentCode.toLowerCase()] || agentCode.toLowerCase();
                    worktrees = worktrees.filter(wt => wt.agent === normalizedAgent);

                    if (worktrees.length === 0) {
                        return console.error(`❌ No worktree found for feature ${featureId} with agent ${agentCode}`);
                    }
                }

                // Select worktree: if multiple, pick most recently modified
                let selectedWt;
                if (worktrees.length === 1) {
                    selectedWt = worktrees[0];
                } else {
                    worktrees.sort((a, b) => b.mtime - a.mtime);
                    selectedWt = worktrees[0];
                    console.log(`ℹ️  Multiple worktrees found, opening most recent:`);
                    worktrees.forEach((wt, i) => {
                        const marker = i === 0 ? '→' : ' ';
                        console.log(`   ${marker} ${wt.featureId}-${wt.agent}: ${wt.path}`);
                    });
                }

                const agentCommand = buildAgentCommand(selectedWt);
                openSingleWorktree(selectedWt, agentCommand, terminal);
            }
        },

        'sessions-close': (args) => {
            const id = args.find(a => !a.startsWith('--'));

            if (!id) {
                console.error('Usage: aigon sessions-close <ID>');
                console.error('\n  aigon sessions-close 05   # Kill all agents, tmux sessions + close Warp tab for #05');
                return;
            }

            const paddedId = String(parseInt(id, 10)).padStart(2, '0');

            // Kill agent processes for this ID across all agent types and command types
            const killPatterns = [
                `aigon:feature-do ${paddedId}`,
                `aigon:feature-review ${paddedId}`,
                `aigon:research-do ${paddedId}`,
            ];

            console.log(`\nClosing all agent sessions for #${paddedId}...\n`);

            let foundAny = false;
            killPatterns.forEach(pattern => {
                try {
                    // SIGTERM (default) — graceful exit; agents flush buffers and close connections
                    execSync(`pkill -f "${pattern}"`, { stdio: 'ignore' });
                    foundAny = true;
                    console.log(`   ✓ ${pattern}`);
                } catch (e) {
                    // pkill exits 1 when no processes match — that's fine
                }
            });

            // Brief wait for processes to exit cleanly, then SIGKILL any stragglers
            if (foundAny) {
                try { execSync('sleep 1', { stdio: 'ignore' }); } catch (e) { /* ignore */ }
                killPatterns.forEach(pattern => {
                    try {
                        execSync(`pkill -9 -f "${pattern}"`, { stdio: 'ignore' });
                    } catch (e) {
                        // Already exited — this is the expected path
                    }
                });
            }

            if (!foundAny) {
                console.log('   (no running agent processes found for this ID)');
            }

            // Kill tmux sessions for this feature ID
            let closedTmuxSessions = 0;
            const killedAgentIds = [];
            try {
                const tmuxList = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8' });
                if (!tmuxList.error && tmuxList.status === 0) {
                    const sessions = tmuxList.stdout
                        .split('\n')
                        .map(line => line.trim())
                        .filter(Boolean);
                    sessions.forEach(sessionName => {
                        const matched = u.matchTmuxSessionByEntityId(sessionName, id);
                        if (!matched) return;

                        const kill = spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
                        if (!kill.error && kill.status === 0) {
                            closedTmuxSessions++;
                            console.log(`   ✓ tmux ${sessionName}`);
                            // Track agent IDs for engine signal emission
                            if (matched.agent && matched.type === 'f' && !killedAgentIds.includes(matched.agent)) {
                                killedAgentIds.push(matched.agent);
                            }
                        }
                    });
                }
            } catch (e) {
                // No tmux server running or tmux not installed.
            }

            // Emit signal.session_lost for each killed agent (when engine state exists)
            if (killedAgentIds.length > 0) {
                const snapshotPath = getSnapshotPath(process.cwd(), paddedId);
                if (fs.existsSync(snapshotPath)) {
                    killedAgentIds.forEach(agentId => {
                        wf.emitSignal(process.cwd(), paddedId, 'session-lost', agentId)
                            .then(() => console.log(`   ✓ engine signal: session_lost (${agentId})`))
                            .catch((err) => {
                                console.error(`   ⚠️  Engine signal session_lost failed for ${agentId}: ${err.message}`);
                            });
                    });
                }
            }

            // Kill preview dashboard processes for this feature ID
            // serverIds are "{agent}-{featureId}" (e.g., "cc-156", "gg-156")
            let closedPreviews = 0;
            try {
                const { loadProxyRegistry, deregisterDevServer, isProcessAlive, getAppId } = require('../proxy');
                const registry = loadProxyRegistry();
                const appId = getAppId();
                const appServers = registry[appId] || {};
                const featureNum = parseInt(id, 10);
                for (const [sid, info] of Object.entries(appServers)) {
                    // Match serverIds like "cc-156", "gg-156" for the feature ID
                    const sidMatch = sid.match(/^([a-z]{2})-(\d+)$/);
                    if (!sidMatch || parseInt(sidMatch[2], 10) !== featureNum) continue;
                    if (info.pid && isProcessAlive(info.pid)) {
                        try {
                            process.kill(info.pid, 'SIGTERM');
                            console.log(`   ✓ preview dashboard ${sid} (PID ${info.pid})`);
                            closedPreviews++;
                        } catch (e) { /* process already gone */ }
                    }
                    deregisterDevServer(appId, sid);
                }
            } catch (e) {
                // Non-fatal — proxy module may not be available
            }

            // Try to close the Warp arena tab/window
            const warpTitleHints = [
                `Arena Research: ${paddedId}`,
                `Arena: Feature ${paddedId}`,
            ];

            let warpClosed = false;
            for (const hint of warpTitleHints) {
                if (u.closeWarpWindow(hint)) {
                    warpClosed = true;
                }
            }

            if (warpClosed) {
                console.log('\n✅ Warp Fleet tab closed.');
            } else {
                const tmuxSuffix = closedTmuxSessions > 0 ? ` Closed ${closedTmuxSessions} tmux session(s).` : '';
                console.log(`\n✅ Done. (Close the Warp tab manually if still open.)${tmuxSuffix}`);
            }
        },
    };

    return cmds;
};

// Backward-compat wrapper
function createFeatureCommands(overrides = {}) {
    const utils = require('../utils');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const ctx = {
        utils: { ...utils, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
    };
    const allCmds = module.exports(ctx);
    const names = [
        'feature-create', 'feature-prioritise', 'feature-now', 'feature-start',
        'feature-do', 'feature-spec', 'feature-status', 'feature-list', 'feature-validate', 'feature-eval', 'feature-review',
        'feature-close', 'feature-cleanup', 'feature-reset', 'feature-backfill-timestamps',
        'feature-autonomous-start', 'feature-autopilot', 'feature-open', 'feature-pause', 'feature-resume',
        'sessions-close'
    ];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createFeatureCommands = createFeatureCommands;
