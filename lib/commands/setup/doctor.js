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
    SECURITY_HOOKS_PATH,
    PRE_COMMIT_HOOK_NAME,
    wrapAigonCommand,
    migrateAigonHookCommand,
    ensureEnvLocalGitignore,
    ensureLocalGitExclude,
    getStandardLocalGitExcludeEntries,
    ensurePreCommitHook,
    ensureHooksPathConfigured,
    isHooksPathConfigured,
    getEnvLocalGitignoreStatus,
    getTrackedEnvLocalFiles,
    untrackFiles,
    gitAddPathsFromPorcelain,
} = gitignoreAndHooks;

const { listRepoRelatedPids, killPidsHard } = pidUtils;

const {
    findSpecsWithInvalidAgentField,
    repairInvalidAgentField,
    findEntitiesMissingWorkflowState,
    bootstrapMissingWorkflowSnapshots,
} = agentTrust;

const { loadGlobalConfig } = require('../../config');
const { LIFECYCLE_TO_FEATURE_DIR, LIFECYCLE_TO_RESEARCH_DIR, STAGE_FOLDERS } = require('../../workflow-core');


const signalHealth = require('../../signal-health');
module.exports = function doctorCommand(ctx, getCommand) {
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
            const {
                loadPortRegistry,
                scanPortsFromFilesystem,
                getActiveProfile: getActiveProfileFn,
                readBasePort: readBasePortFn,
                registerPort: registerPortFn,
                proxyDiagnostics: proxyDiagnosticsFn,
                isCaddyInstalled: isCaddyInstalledFn,
                parseCaddyRoutes: parseCaddyRoutesFn,
                getAvailableAgents: getAvailableAgentsFn,
                loadAgentConfig: loadAgentConfigFn,
                getAgentCliConfig: getAgentCliConfigFn,
                getModelProvenance: getModelProvenanceFn,
            } = u;

            const { parseDoctorScopes, sectionInScope, scopeUsageLine } = require('../../doctor/scopes');
            const { runFixDispatch, printFixSummary, printManualIssues } = require('../../doctor/fix-dispatch');
            const scopeParsed = parseDoctorScopes(args);
            if (scopeParsed.unknownScopeFlags.length > 0) {
                console.error(`Unknown flag(s): ${scopeParsed.unknownScopeFlags.join(', ')}`);
                console.error(scopeUsageLine());
                process.exitCode = 1;
                return;
            }

            const doRegister = args.includes('--register');
            const doFix = args.includes('--fix');
            const doGc = args.includes('--gc');
            const doRebuildStats = args.includes('--rebuild-stats');
            const doReapOrphans = args.includes('--reap-orphans');
            const doFixTemplates = args.includes('--fix-templates');
            const doAuthOnly = scopeParsed.authOnly;
            const doctorScope = scopeParsed.scope;
            const doFull = scopeParsed.full;
            const doVerbose = scopeParsed.verbose;
            const yesFlag = args.includes('--yes') || args.includes('-y');
            const sweepReposFlag = args.includes('--sweep-repos');
            const batchFix = doFix && yesFlag;
            const deferFix = doFix && !yesFlag;
            const fixQueue = [];

            // F550: structured collector for the triage digest.
            const { DoctorReport } = require('../../doctor/report');
            const report = new DoctorReport({ mode: doFull ? 'full' : 'default' });
            const AUTO_FIX = { label: 'auto-fix', command: 'aigon doctor --fix', autoFixable: true };

            function queueFix(item) {
                if (doctorScope && item.section && !sectionInScope(item.section, doctorScope)) return;
                fixQueue.push(item);
            }

            // F551: section-buffering wrapper. In default mode, sections that
            // end with status === 'pass' collapse to a single "✅ <Title> — <summary>"
            // line; warn/fail sections expand to their full body. In --full mode
            // every section expands. `verboseOnly` sections (Port Health table,
            // Agent install paths) summarise even when degraded — the full table
            // is only available via --full.
            async function withSection(opts, fn) {
                if (!fn) return;
                const { id, title, verboseOnly = false } = opts;
                if (!sectionInScope(id, doctorScope)) return;
                const buf = [];
                const origLog = console.log;
                console.log = (...a) => buf.push(a.map(v => (typeof v === 'string' ? v : String(v))).join(' '));
                let result;
                try {
                    result = await fn();
                } finally {
                    console.log = origLog;
                }
                const sec = report.section(id, title);
                const summaryText = (typeof opts.summary === 'function' ? opts.summary(result) : opts.summary)
                    || result || sec.summaryLine || 'OK';
                if (doFull) {
                    buf.forEach(l => origLog(l));
                    return;
                }
                const expand = typeof opts.expandWhen === 'function'
                    ? opts.expandWhen(result)
                    : sec.status !== 'pass';
                if (!expand) {
                    origLog(`✅ ${title} — ${summaryText}`);
                    return;
                }
                if (verboseOnly && !doFull && !doVerbose) {
                    const glyph = sec.status === 'fail' ? '❌' : '⚠️ ';
                    const hint = doFull ? '' : ' (run `aigon doctor --full` for all sections, or --verbose for debug rows)';
                    origLog(`${glyph} ${title} — ${summaryText}${hint}`);
                    return;
                }
                buf.forEach(l => origLog(l));
            }

            if (doFixTemplates) {
                const driftLib = require('../../template-drift');
                const driftRepoRoot = process.cwd();
                let driftManifest;
                try {
                    driftManifest = installManifestLib.readManifest(driftRepoRoot);
                } catch (e) {
                    console.error(`❌ Could not read install manifest: ${e.message}`);
                    process.exitCode = 1;
                    return;
                }
                if (!driftManifest) {
                    console.error('❌ No install manifest found. Run `aigon install-agent <id>` first.');
                    process.exitCode = 1;
                    return;
                }

                const { byAgent } = driftLib.classifyManifestEntries(driftManifest, driftRepoRoot);
                const allRows = [];
                for (const [agentId, rows] of Object.entries(byAgent)) {
                    for (const r of rows) allRows.push({ agentId, ...r });
                }

                if (allRows.length === 0) {
                    console.log('✅ No template-vs-installed drift detected.');
                    return;
                }

                let ok = 0, stale = 0, edited = 0;
                const drifted = allRows.filter(r => r.status !== 'OK');
                for (const r of allRows) {
                    if (r.status === 'OK') { ok++; }
                    else if (r.status === 'STALE_TEMPLATE') stale++;
                    else if (r.status === 'HAND_EDITED') edited++;
                }
                if (drifted.length === 0) {
                    console.log(`✅ No drift across ${allRows.length} tracked files.`);
                } else {
                    console.log(`\n📋 Template-vs-installed status (${drifted.length} drifted, ${allRows.length} total)\n`);
                    console.log('STATUS          AGENT  PATH');
                    console.log('------          -----  ----');
                    for (const r of drifted) {
                        console.log(`${r.status.padEnd(15)} ${r.agentId.padEnd(6)} ${r.path}`);
                    }
                    console.log(`\n  ${ok} OK   ${stale} STALE_TEMPLATE   ${edited} HAND_EDITED`);
                }

                if (!doFix) {
                    if (stale > 0 || edited > 0) {
                        console.log('\n💡 Run `aigon doctor --fix-templates --fix` to refresh stale files.');
                    }
                    return;
                }

                // --fix path: refresh STALE_TEMPLATE automatically; for
                // HAND_EDITED, prompt interactively unless --yes / piped stdin.
                const interactive = !yesFlag && process.stdin.isTTY;
                const handEditedRows = allRows.filter(r => r.status === 'HAND_EDITED');
                const staleRows = allRows.filter(r => r.status === 'STALE_TEMPLATE');

                // Refresh stale: delete drifted installed files, then re-run
                // install-agent for each affected agent. install-agent's
                // sha256 == manifest.sha256 invariant protects HAND_EDITED
                // files from clobber.
                const agentsToRefresh = new Set(staleRows.map(r => r.agentId));
                if (agentsToRefresh.size > 0) {
                    console.log(`\n🔄 Refreshing ${staleRows.length} stale template(s) for: ${[...agentsToRefresh].join(', ')}`);
                    for (const r of staleRows) {
                        const abs = path.join(driftRepoRoot, r.path);
                        try { fs.unlinkSync(abs); } catch (_) { /* missing is fine */ }
                    }
                    await getCommand('install-agent')([...agentsToRefresh]);
                }

                // Hand-edited handling
                if (handEditedRows.length === 0) return;

                if (!interactive) {
                    console.log(`\n⚠️  Skipped ${handEditedRows.length} hand-edited file(s) (run with --fix in a TTY to review):`);
                    handEditedRows.forEach(r => console.log(`   - ${r.path}`));
                    return;
                }

                // Interactive prompt: r/k/d per file. Use a tiny readline
                // wrapper to avoid pulling in inquirer just for this.
                const readline = require('readline');
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                const ask = q => new Promise(res => rl.question(q, ans => res(ans.trim().toLowerCase())));
                for (const r of handEditedRows) {
                    let action = '';
                    while (!['r', 'k', 'd'].includes(action)) {
                        action = await ask(`\n${r.path}\n  [r]efresh / [k]eep / [d]iff: `);
                        if (action === 'd') {
                            // Show diff against template if available
                            try {
                                const tpl = r.templatePath ? fs.readFileSync(path.join(driftRepoRoot, r.templatePath), 'utf8') : '(template not found)';
                                const cur = fs.readFileSync(path.join(driftRepoRoot, r.path), 'utf8');
                                console.log('\n--- TEMPLATE ---');
                                console.log(tpl.split('\n').slice(0, 20).join('\n'));
                                console.log('--- INSTALLED ---');
                                console.log(cur.split('\n').slice(0, 20).join('\n'));
                            } catch (e) { console.log(`(diff unavailable: ${e.message})`); }
                            action = ''; // re-prompt
                        }
                    }
                    if (action === 'r') {
                        try { fs.unlinkSync(path.join(driftRepoRoot, r.path)); } catch (_) { /* nop */ }
                        await getCommand('install-agent')([r.agentId]);
                    }
                    // 'k' is no-op
                }
                rl.close();
                return;
            }

            if (doReapOrphans) {
                const dryRun = args.includes('--dry-run');
                const minAgeArg = args.find(a => a.startsWith('--min-age='));
                let minAgeSecs = minAgeArg ? parseInt(minAgeArg.split('=')[1], 10) : 3600;
                if (!Number.isFinite(minAgeSecs) || minAgeSecs < 0) minAgeSecs = 3600;

                // Parse etime format [[DD-]HH:]MM:SS → seconds
                function parseEtime(etime) {
                    const s = (etime || '').trim();
                    let days = 0, hours = 0, mins = 0, secs = 0;
                    let rest = s;
                    const dashIdx = s.indexOf('-');
                    if (dashIdx !== -1) {
                        days = parseInt(s.slice(0, dashIdx), 10) || 0;
                        rest = s.slice(dashIdx + 1);
                    }
                    const parts = rest.split(':');
                    if (parts.length === 3) {
                        hours = parseInt(parts[0], 10) || 0;
                        mins = parseInt(parts[1], 10) || 0;
                        secs = parseInt(parts[2], 10) || 0;
                    } else if (parts.length === 2) {
                        mins = parseInt(parts[0], 10) || 0;
                        secs = parseInt(parts[1], 10) || 0;
                    }
                    return days * 86400 + hours * 3600 + mins * 60 + secs;
                }

                // Collect all processes visible to the current user
                const psResult = spawnSync('ps', ['-axo', 'pid,ppid,etime,args'], { encoding: 'utf8' }); // nosemgrep
                if (psResult.error || psResult.status !== 0) {
                    console.error('❌ Could not run ps:', psResult.error?.message || 'non-zero exit');
                    process.exitCode = 1;
                    return;
                }
                const psLines = (psResult.stdout || '').split('\n').slice(1);
                const procs = [];
                for (const line of psLines) {
                    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)/);
                    if (!m) continue;
                    const [, pidStr, ppidStr, etime, cmd] = m;
                    procs.push({
                        pid: parseInt(pidStr, 10),
                        ppid: parseInt(ppidStr, 10),
                        ageSecs: parseEtime(etime),
                        cmd,
                    });
                }

                const orphanPids = new Set();
                const reasons = new Map();

                // Primary candidates: wrapper shells orphaned to init (PPID=1) with aigon env
                for (const proc of procs) {
                    if (proc.ppid === 1 && proc.cmd.includes('AIGON_ENTITY_TYPE=') && proc.ageSecs >= minAgeSecs) {
                        orphanPids.add(proc.pid);
                        reasons.set(proc.pid, `wrapper shell (PPID=1, age=${Math.round(proc.ageSecs / 60)}m)`);
                    }
                }

                // Hanging agent-status invocations older than minAgeSecs
                for (const proc of procs) {
                    if (!orphanPids.has(proc.pid) && proc.cmd.includes('aigon agent-status') && proc.ageSecs >= minAgeSecs) {
                        orphanPids.add(proc.pid);
                        reasons.set(proc.pid, `hanging agent-status (age=${Math.round(proc.ageSecs / 60)}m)`);
                    }
                }

                // Recursively collect descendants of wrapper shells and hanging agent-status roots
                function collectDescendants(parentPid) {
                    for (const proc of procs) {
                        if (proc.ppid === parentPid && !orphanPids.has(proc.pid)) {
                            orphanPids.add(proc.pid);
                            reasons.set(proc.pid, `descendant of PID ${parentPid}`);
                            collectDescendants(proc.pid);
                        }
                    }
                }
                const rootPids = [...orphanPids].filter((pid) => {
                    const r = reasons.get(pid) || '';
                    return r.startsWith('wrapper') || r.startsWith('hanging');
                });
                for (const pid of rootPids) {
                    collectDescendants(pid);
                }

                if (orphanPids.size === 0) {
                    console.log(`✅ No orphaned agent processes found (min-age=${minAgeSecs}s).`);
                    return;
                }

                console.log(`\n🔍 Found ${orphanPids.size} orphaned process(es) (min-age=${minAgeSecs}s):\n`);
                for (const pid of [...orphanPids].sort((a, b) => a - b)) {
                    const proc = procs.find(p => p.pid === pid);
                    const cmdTrunc = (proc?.cmd || '').slice(0, 100);
                    console.log(`  PID ${pid}  [${reasons.get(pid)}]`);
                    console.log(`    ${cmdTrunc}`);
                }
                console.log('');

                if (dryRun) {
                    console.log('ℹ️  Dry run — no processes killed. Re-run without --dry-run to proceed.');
                    return;
                }

                // SIGTERM first
                console.log('📤 Sending SIGTERM...');
                for (const pid of orphanPids) {
                    try { process.kill(pid, 'SIGTERM'); } catch (_) { /* already gone */ }
                }

                // Grace period, then SIGKILL stragglers
                await new Promise(r => setTimeout(r, 3000));
                let sigkillCount = 0;
                for (const pid of orphanPids) {
                    try {
                        process.kill(pid, 0); // throws if gone
                        process.kill(pid, 'SIGKILL');
                        sigkillCount++;
                    } catch (_) { /* already terminated */ }
                }
                const sigtermedCount = orphanPids.size - sigkillCount;
                console.log(`✅ Cleaned up ${orphanPids.size} process(es) — ${sigtermedCount} exited on SIGTERM, ${sigkillCount} needed SIGKILL.`);
                return;
            }

            if (doRebuildStats) {
                // Feature 230: force-rebuild the stats aggregate cache for every
                // registered repo (and cwd as a fallback).
                const statsAggregate = require('../../stats-aggregate');
                const { readConductorReposFromGlobalConfig } = require('../../config');
                const repoList = readConductorReposFromGlobalConfig();
                const repos = (Array.isArray(repoList) && repoList.length > 0) ? repoList : [process.cwd()];
                console.log('\n🧮 Rebuilding stats aggregate cache...');
                for (const repoPath of repos) {
                    const abs = require('path').resolve(repoPath);
                    try {
                        const a = statsAggregate.rebuildAggregate(abs);
                        console.log(`   ✔ ${require('path').basename(abs)}: ${a.recordCount} records (${a.totals.features}f / ${a.totals.research}r) → ${statsAggregate.cachePath(abs)}`);
                    } catch (e) {
                        console.log(`   ✖ ${abs}: ${e.message}`);
                    }
                }
                console.log('');
                return;
            }
            const { reallocatePort: reallocatePortFn, PORT_BLOCK_SIZE: blockSize } = u;
            const registry = loadPortRegistry();
            const scanned = scanPortsFromFilesystem();

            // Merge: registry entries + discovered projects (dedup by path)
            const byPath = new Map();

            // Add registry entries first
            for (const [name, entry] of Object.entries(registry)) {
                byPath.set(entry.path, {
                    name,
                    basePort: entry.basePort,
                    path: entry.path,
                    registered: true
                });
            }

            // Add scanned entries (don't overwrite registered ones, but update port if different)
            for (const project of scanned) {
                if (byPath.has(project.path)) {
                    const existing = byPath.get(project.path);
                    existing.scanned = true;
                    existing.source = project.source;
                } else {
                    byPath.set(project.path, {
                        name: project.name,
                        basePort: project.basePort,
                        path: project.path,
                        registered: false,
                        scanned: true,
                        source: project.source
                    });
                }
            }

            const allProjects = Array.from(byPath.values());

            // Register current project if --register
            if (doRegister) {
                const profile = getActiveProfileFn();
                if (profile.devServer.enabled) {
                    const result = readBasePortFn();
                    const basePort = result ? result.port : 3000;
                    const name = path.basename(process.cwd());
                    registerPortFn(name, basePort, process.cwd());
                    console.log(`✅ Registered ${name} (port ${basePort}) in global port registry.`);

                    // Refresh the data for display
                    const updatedEntry = byPath.get(process.cwd());
                    if (updatedEntry) {
                        updatedEntry.registered = true;
                    } else {
                        allProjects.push({
                            name,
                            basePort,
                            path: process.cwd(),
                            registered: true,
                            scanned: true
                        });
                    }
                } else {
                    console.log(`ℹ️  Dev server not enabled for this project profile — nothing to register.`);
                }
            }

            // --- Prerequisites Check ---
            const { isBinaryAvailable: isBinAvailable } = require('../../security');
            const _doctorRegistry = require('../../agent-registry');
            const agentBinMap = _doctorRegistry.getAgentBinMap();
            const agentInstallHints = _doctorRegistry.getAgentInstallHints();

            if (!doAuthOnly && doctorScope !== 'ports') await withSection({
                id: 'prerequisites',
                title: 'Prerequisites',
            }, () => {
                console.log('\nPrerequisites\n─────────────');

                // Node.js version check
                const nodeVersion = process.versions.node;
                const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
                if (nodeMajor < 18) {
                    console.log(`  ⚠️  Node.js ${nodeVersion} — version 18+ recommended`);
                    console.log('     Install: https://nodejs.org/ or use nvm/fnm');
                    report.issue({
                        section: 'prerequisites',
                        sectionTitle: 'Prerequisites',
                        check: 'prereq-node-too-old',
                        message: `Node.js ${nodeVersion} — version 18+ required`,
                        fix: { label: 'install Node 18+', command: 'https://nodejs.org/', autoFixable: false },
                    });
                } else {
                    console.log(`  ✅ Node.js ${nodeVersion}`);
                }

                // Git check
                try {
                    const gitVersion = execSync('git --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
                    console.log(`  ✅ ${gitVersion}`);
                } catch {
                    console.log('  ❌ git not found — required');
                    console.log('     Install: https://git-scm.com/downloads');
                    report.issue({
                        section: 'prerequisites',
                        sectionTitle: 'Prerequisites',
                        check: 'prereq-git-missing',
                        message: 'git not found — required',
                        fix: { label: 'install git', command: 'https://git-scm.com/downloads', autoFixable: false },
                    });
                }

                // tmux check
                if (isBinAvailable('tmux')) {
                    try {
                        const tmuxVersion = execSync('tmux -V', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        console.log(`  ✅ ${tmuxVersion}`);
                    } catch {
                        console.log('  ✅ tmux is installed');
                    }
                } else {
                    console.log('  ⚠️  tmux not found — required for Fleet/worktree mode, optional for single-agent Drive mode');
                    if (process.platform === 'darwin') {
                        console.log('     Install: brew install tmux');
                    } else {
                        console.log('     Install: sudo apt install tmux  (or dnf/pacman equivalent)');
                    }
                    report.issue({
                        section: 'prerequisites',
                        sectionTitle: 'Prerequisites',
                        check: 'prereq-tmux-missing',
                        message: 'tmux not found — required for Fleet/worktree mode',
                        fix: { label: 'install tmux', command: process.platform === 'darwin' ? 'brew install tmux' : 'sudo apt install tmux', autoFixable: false },
                    });
                }

                // Agent CLI checks
                const agentAvailability = require('../../agent-availability');
                const disabledByUser = [];
                let foundAgents = 0;
                for (const [agentId, binary] of Object.entries(agentBinMap)) {
                    const avail = agentAvailability.getAgentAvailability(agentId, process.cwd());
                    if (avail.state === 'disabled') {
                        disabledByUser.push(agentId);
                        console.log(`  ⏸  ${binary} (${agentId}) — disabled by user${avail.reason ? ` (${avail.reason})` : ''}`);
                        continue;
                    }
                    if (avail.state === 'retired') {
                        console.log(`  🚫 ${binary} (${agentId}) — retired`);
                        continue;
                    }
                    if (isBinAvailable(binary)) {
                        console.log(`  ✅ ${binary} (${agentId})`);
                        foundAgents++;
                    } else {
                        console.log(`  ·  ${binary} (${agentId}) — not installed`);
                        console.log(`     Install: ${agentInstallHints[agentId]}`);
                    }
                }
                if (disabledByUser.length > 0) {
                    console.log(`  ℹ️  ${disabledByUser.length} agent(s) disabled by preference (not a repair issue). Re-enable with: aigon agent enable <id>`);
                }
                if (foundAgents === 0) {
                    console.log('  ⚠️  No agent CLIs found — install at least one to use aigon');
                    report.issue({
                        section: 'prerequisites',
                        sectionTitle: 'Prerequisites',
                        check: 'prereq-no-agents-installed',
                        message: 'No agent CLIs found — install at least one to use aigon',
                    });
                }
                const tmuxNote = isBinAvailable('tmux') ? 'tmux' : 'no tmux';
                const nodeShort = `node ${nodeVersion.split('.')[0]}`;
                return `${nodeShort}, git, ${tmuxNote} + ${foundAgents} agent${foundAgents === 1 ? '' : 's'}`;
            });

            const checkDefaultAgentConfig = (label, config, repoPath = null) => {
                const configuredDefault = String(config?.defaultAgent || '').trim().toLowerCase();
                if (!configuredDefault) return;
                if (!agentRegistry.getAllAgentIds().includes(configuredDefault)) {
                    console.log(`  ⚠️  ${label} defaultAgent is set to '${configuredDefault}' but that agent is not registered`);
                    return;
                }
                const agentAvailability = require('../../agent-availability');
                const avail = agentAvailability.getAgentAvailability(configuredDefault, repoPath || process.cwd());
                if (avail.state === 'disabled') {
                    console.log(`  ⚠️  ${label} defaultAgent is set to '${configuredDefault}' but that agent is disabled`);
                    console.log(`     Re-enable with: aigon agent enable ${configuredDefault}`);
                    return;
                }
                const agentBin = agentBinMap[configuredDefault];
                if (!agentBin || isBinAvailable(agentBin)) return;
                const displayName = agentRegistry.getAgent(configuredDefault)?.displayName || configuredDefault;
                console.log(`  ⚠️  ${label} defaultAgent is set to '${configuredDefault}' but ${displayName} is not installed (${agentBin} not found in PATH)`);
                if (repoPath) {
                    console.log(`     Repo: ${repoPath}`);
                }
                report.issue({
                    section: 'prerequisites',
                    sectionTitle: 'Prerequisites',
                    check: 'default-agent-misconfigured',
                    message: `${label} defaultAgent='${configuredDefault}' but ${agentBin} not in PATH`,
                });
            };
            if (!doAuthOnly && doctorScope !== 'ports') {
                checkDefaultAgentConfig('Global config', loadGlobalConfig());
                checkDefaultAgentConfig('Project config', loadProjectConfig(process.cwd()), process.cwd());
            }

            // Agent install paths — where install-agent writes per-agent commands.
            // Helps users (and us) verify that codex now installs Skills locally,
            // not deprecated prompts under ~/.codex/prompts/.
            if (!doAuthOnly && doctorScope !== 'ports') await withSection({
                id: 'agent-install-paths',
                title: 'Agent install paths',
                verboseOnly: true,
            }, () => {
                let count = 0;
                try {
                    const installPathLines = [];
                    for (const agentId of getAvailableAgentsFn()) {
                        const cfg = loadAgentConfigFn(agentId);
                        if (!cfg || !cfg.output || !cfg.output.commandDir) continue;
                        let label;
                        if (cfg.output.format === 'skill-md') {
                            const skillFile = cfg.output.skillFileName || 'SKILL.md';
                            label = `${cfg.output.commandDir}/${cfg.output.commandFilePrefix}*/${skillFile}`;
                        } else if (cfg.output.global) {
                            label = `${cfg.output.commandDir} (global)`;
                        } else {
                            label = `${cfg.output.commandDir}/${cfg.output.commandFilePrefix}*${cfg.output.commandFileExtension}`;
                        }
                        installPathLines.push(`  ·  ${cfg.id} → ${label}`);
                    }
                    count = installPathLines.length;
                    if (installPathLines.length > 0) {
                        console.log('\nAgent install paths\n───────────────────');
                        installPathLines.forEach(line => console.log(line));
                    }
                } catch (_) { /* best-effort */ }
                return `${count} agent${count === 1 ? '' : 's'} configured`;
            });

            // Warn about stale legacy ~/.codex/prompts/aigon-*.md files
            // (left over from a pre-skills install). install-agent cx
            // cleans these up; doctor surfaces them in case the user has
            // an older copy lying around.
            if (!doAuthOnly) try {
                const legacyDir = path.join(os.homedir(), '.codex', 'prompts');
                if (fs.existsSync(legacyDir)) {
                    const stale = fs.readdirSync(legacyDir).filter(f => f.startsWith('aigon-') && f.endsWith('.md'));
                    if (stale.length > 0) {
                        console.log(`  ⚠️  Found ${stale.length} stale aigon prompt file(s) under ~/.codex/prompts/ — run \`aigon install-agent cx\` to remove them.`);
                        report.issue({
                            section: 'prerequisites',
                            sectionTitle: 'Prerequisites',
                            check: 'legacy-codex-prompts',
                            message: `${stale.length} stale aigon prompt file(s) under ~/.codex/prompts/`,
                            fix: { label: 'reinstall cx', command: 'aigon install-agent cx', autoFixable: false },
                        });
                    }
                }
            } catch (_) { /* best-effort */ }

            const doctorShortenPath = (p) => p && p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : (p || '(unknown)');
            const installedAgentIds = Object.entries(agentBinMap)
                .filter(([, binary]) => isBinAvailable(binary))
                .map(([agentId]) => agentId);

            function getAuthEnvNames(authCheck = {}) {
                if (Array.isArray(authCheck.envVarNames)) return authCheck.envVarNames.filter(Boolean);
                if (authCheck.envVarName) return [authCheck.envVarName];
                return [];
            }

            function getJsonPathValue(value, dottedPath) {
                return String(dottedPath || '').split('.').filter(Boolean)
                    .reduce((acc, key) => acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined, value);
            }

            function runAgentAuthCheck(agentConfig) {
                const authCheck = agentConfig?.authCheck || { method: 'none' };
                const method = authCheck.method || 'none';
                if (method === 'none') {
                    return { status: 'external', message: authCheck.loginHint || 'auth managed externally' };
                }
                if (method === 'envVar') {
                    const names = getAuthEnvNames(authCheck);
                    const present = names.filter(name => String(process.env[name] || '').trim());
                    if (present.length > 0) return { status: 'authenticated', message: `${present.join(', ')} set` };
                    if (authCheck.configFilePath && fs.existsSync(expandHomePath(authCheck.configFilePath))) {
                        return { status: 'authenticated', message: `${authCheck.configFilePath} exists` };
                    }
                    return { status: 'unauthenticated', message: names.length ? `${names.join(' / ')} not set` : 'environment variable not configured' };
                }
                if (method === 'configFile') {
                    if (authCheck.configFilePath && fs.existsSync(expandHomePath(authCheck.configFilePath))) {
                        return { status: 'authenticated', message: `${authCheck.configFilePath} exists` };
                    }
                    return { status: 'unauthenticated', message: `${authCheck.configFilePath || 'config file'} not found` };
                }
                if (method === 'command') {
                    if (!authCheck.command) return { status: 'unknown', message: 'auth command not configured' };
                    const result = spawnSync(authCheck.command, {
                        shell: true,
                        encoding: 'utf8',
                        timeout: 3000,
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                    if (result.error) {
                        const detail = result.error.code === 'ETIMEDOUT' ? 'timed out after 3s' : result.error.message;
                        return { status: 'failed', message: `check failed: ${detail}` };
                    }
                    const stdout = String(result.stdout || '').trim();
                    const stderr = String(result.stderr || '').trim();
                    if (result.status !== 0) {
                        return { status: 'unauthenticated', message: stderr || `command exited ${result.status}` };
                    }
                    if (authCheck.successIndicator) {
                        try {
                            const parsed = JSON.parse(stdout || '{}');
                            const value = getJsonPathValue(parsed, authCheck.successIndicator);
                            return value
                                ? { status: 'authenticated', message: `${authCheck.successIndicator}=true` }
                                : { status: 'unauthenticated', message: `${authCheck.successIndicator}=false` };
                        } catch (e) {
                            return { status: 'failed', message: `check failed: invalid JSON from ${authCheck.command}` };
                        }
                    }
                    return stdout
                        ? { status: 'authenticated', message: 'command returned provider data' }
                        : { status: 'unauthenticated', message: 'command returned no provider data' };
                }
                return { status: 'unknown', message: `auth method '${method}' unknown` };
            }

            function openAuthFixWindow(agentId, authCheck) {
                if (!authCheck?.loginCommand) {
                    if (authCheck?.loginHint) console.log(`     ${agentId}: ${authCheck.loginHint}`);
                    return;
                }
                const title = `aigon-auth-${agentId}`;
                let result = spawnSync('tmux', ['new-window', '-n', title, authCheck.loginCommand], {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
                if (result.status !== 0 || result.error) {
                    result = spawnSync('tmux', ['new-session', '-d', '-s', title, authCheck.loginCommand], {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                }
                if (result.status === 0 && !result.error) {
                    console.log(`     ✅ ${agentId}: opened tmux login session (${authCheck.loginCommand})`);
                } else {
                    const detail = result.error?.message || String(result.stderr || '').trim() || 'tmux failed';
                    console.log(`     ⚠️  ${agentId}: could not open login session (${detail})`);
                    console.log(`        Run manually: ${authCheck.loginCommand}`);
                }
            }

            function printAgentAuthSection() {
                console.log('\nAgent Auth\n──────────');
                if (installedAgentIds.length === 0) {
                    console.log('  ℹ️  No installed agent CLIs found to authenticate.');
                    return;
                }
                const unauthenticated = [];
                for (const agentId of installedAgentIds) {
                    const agentConfig = loadAgentConfigFn(agentId);
                    const result = runAgentAuthCheck(agentConfig);
                    const name = agentConfig?.name || agentId;
                    if (result.status === 'authenticated') {
                        console.log(`  ✅ ${agentId} (${name}): authenticated${result.message ? ` — ${result.message}` : ''}`);
                    } else if (result.status === 'unauthenticated') {
                        console.log(`  ⚠️  ${agentId} (${name}): unauthenticated${result.message ? ` — ${result.message}` : ''}`);
                        unauthenticated.push({ agentId, authCheck: agentConfig?.authCheck || {} });
                        report.issue({
                            section: 'agent-auth',
                            sectionTitle: 'Agent Auth',
                            check: 'agent-unauthenticated',
                            message: `${agentId} unauthenticated${result.message ? ` — ${result.message}` : ''}`,
                            fix: {
                                label: 'open login session',
                                command: agentConfig?.authCheck?.loginCommand || 'aigon doctor --auth --fix',
                                autoFixable: true,
                            },
                        });
                    } else if (result.status === 'failed') {
                        console.log(`  ⚠️  ${agentId} (${name}): ${result.message}`);
                        report.issue({
                            section: 'agent-auth',
                            sectionTitle: 'Agent Auth',
                            check: 'agent-auth-check-failed',
                            message: `${agentId} auth check failed: ${result.message}`,
                        });
                    } else if (result.status === 'external') {
                        console.log(`  ℹ️  ${agentId} (${name}): ${result.message}`);
                    } else {
                        console.log(`  ℹ️  ${agentId} (${name}): auth-method unknown${result.message ? ` — ${result.message}` : ''}`);
                    }
                }
                if (unauthenticated.length > 0) {
                    queueFix({
                        section: 'agent-auth',
                        message: `Open login for ${unauthenticated.length} unauthenticated agent(s)`,
                        label: 'open login sessions',
                        command: unauthenticated.map(u => u.authCheck?.loginCommand).filter(Boolean).join('; ') || 'aigon doctor --auth --fix',
                        apply: () => {
                            console.log('\n  Auth fixes');
                            unauthenticated.forEach(({ agentId, authCheck }) => openAuthFixWindow(agentId, authCheck));
                        },
                    });
                }
                const total = installedAgentIds.length;
                const auth = total - unauthenticated.length;
                return total ? `${auth} of ${total} authenticated` : 'no agents installed';
            }

            function getQuotaMode(agentId, agentConfig) {
                const candidates = {
                    cc: ['ANTHROPIC_API_KEY'],
                    gg: ['GEMINI_API_KEY'],
                    cx: ['OPENAI_API_KEY'],
                    op: ['OPENROUTER_API_KEY', 'OPENCODE_API_KEY'],
                    am: ['AMP_API_KEY'],
                    km: ['MOONSHOT_API_KEY'],
                }[agentId] || getAuthEnvNames(agentConfig?.authCheck || {});
                const present = candidates.filter(name => String(process.env[name] || '').trim());
                if (present.length > 0) return `API key mode (${present.join(', ')})`;
                if (agentId === 'cx' && String(process.env.OPENAI_BASE_URL || '').trim()) return 'API key mode (OPENAI_BASE_URL)';
                return 'OAuth/default mode';
            }

            function printModelHealthSection() {
                console.log('\nModel Health Check\n──────────────────');
                const agents = getAvailableAgentsFn();
                let modelWarnings = 0;
                for (const agentId of agents) {
                    const agentConfig = loadAgentConfigFn(agentId);
                    if (!agentConfig) {
                        console.log(`  ❌ ${agentId}: Agent template not found`);
                        modelWarnings++;
                        report.issue({
                            section: 'model-health',
                            sectionTitle: 'Model Health',
                            check: 'model-template-missing',
                            message: `${agentId}: agent template not found`,
                        });
                        continue;
                    }
                    const cliConfig = getAgentCliConfigFn(agentId);
                    const supportsModelFlag = agentConfig.capabilities?.supportsModelFlag === true && !!agentConfig.cli?.modelFlag;
                    const hasTemplateModels = agentConfig.cli?.models && Object.keys(agentConfig.cli.models).length > 0;
                    const implementModel = cliConfig.models?.implement || agentConfig.cli?.models?.implement || '(default)';
                    const planModel = cliConfig.models?.plan || cliConfig.models?.research || agentConfig.cli?.models?.plan || agentConfig.cli?.models?.research || implementModel;
                    const acceptsDashModel = agentConfig.cli?.modelFlag === '--model';
                    const mode = getQuotaMode(agentId, agentConfig);

                    if (!supportsModelFlag) {
                        console.log(`  ℹ️  ${agentId} (${agentConfig.name}): model flag unavailable; implement=${implementModel}; plan=${planModel}; ${mode}`);
                    } else if (!hasTemplateModels) {
                        console.log(`  ⚠️  ${agentId} (${agentConfig.name}): model flag ${agentConfig.cli.modelFlag}; --model=${acceptsDashModel ? 'yes' : 'no'}; no template model metadata; ${mode}`);
                        modelWarnings++;
                        report.issue({
                            section: 'model-health',
                            sectionTitle: 'Model Health',
                            check: 'model-warning',
                            message: `${agentId}: no template model metadata`,
                        });
                    } else {
                        console.log(`  ✅ ${agentId} (${agentConfig.name}): implement=${implementModel}; plan=${planModel}; flag=${agentConfig.cli.modelFlag}; --model=${acceptsDashModel ? 'yes' : 'no'}; ${mode}`);
                    }
                }
                console.log('');
                if (modelWarnings > 0) {
                    console.log(`${modelWarnings} model warning${modelWarnings === 1 ? '' : 's'}.`);
                } else {
                    console.log('No model issues found.');
                }
                console.log(`💡 Run \`aigon config models\` for full model configuration table.`);
                const n = agents.length;
                return modelWarnings ? `${modelWarnings} warning${modelWarnings === 1 ? '' : 's'}` : `${n} agent${n === 1 ? '' : 's'} healthy`;
            }

            function printTerminalAppSection() {
                console.log('\nTerminal App\n────────────');
                const terminalConfig = loadGlobalConfig().terminalApp ?? (process.platform === 'darwin' ? 'apple-terminal' : null);
                if (!terminalConfig) {
                    console.log('  ℹ️  terminalApp not configured — auto-detect mode');
                    return 'auto-detect';
                }
                const terminalAdapters = require('../../terminal-adapters');
                const adapter = terminalAdapters.getAdapter(terminalConfig);
                if (process.platform !== 'darwin') {
                    console.log(`  ℹ️  terminalApp=${terminalConfig}; bundle checks are macOS-only`);
                    return `${terminalConfig} (non-macOS)`;
                }
                if (!adapter?.appBundle) {
                    console.log(`  ℹ️  ${terminalConfig}: no app bundle metadata`);
                    return `${terminalConfig}`;
                }
                const candidates = [
                    path.join('/Applications', adapter.appBundle),
                    path.join('/System/Applications', adapter.appBundle),
                ];
                const found = candidates.find(p => fs.existsSync(p));
                if (found) {
                    console.log(`  ✅ ${adapter.displayName || terminalConfig}: installed (${found})`);
                    return `${adapter.displayName || terminalConfig} installed`;
                }
                console.log(`  ❌ ${adapter.displayName || terminalConfig}: not found (${adapter.appBundle})`);
                console.log(`     ${adapter.appInstallHint || `Install ${adapter.displayName || terminalConfig}`}`);
                const installHint = adapter.appInstallHint || `Install ${adapter.displayName || terminalConfig}`;
                report.issue({
                    section: 'terminal-app',
                    sectionTitle: 'Terminal App',
                    check: 'terminal-app-missing',
                    message: `${adapter.displayName || terminalConfig}: configured but not installed`,
                    fix: { label: installHint, command: installHint, autoFixable: false },
                });
                if (batchFix) {
                    const installed = terminalAdapters.getPickerOptions({ platform: 'darwin' })
                        .filter(opt => {
                            const a = terminalAdapters.getAdapter(opt.value);
                            return a?.appBundle && candidatesForBundle(a.appBundle).some(p => fs.existsSync(p));
                        });
                    if (installed.length > 0) {
                        console.log(`     Installed alternatives: ${installed.map(opt => opt.value).join(', ')}`);
                        console.log(`     Run: aigon config set terminalApp ${installed[0].value}`);
                    } else {
                        console.log('     No installed configured alternatives found.');
                    }
                }
                return `${adapter.displayName || terminalConfig}: not installed`;
            }

            function candidatesForBundle(bundle) {
                return [path.join('/Applications', bundle), path.join('/System/Applications', bundle)];
            }

            function readRegisteredReposForVersionSweep() {
                const repos = [];
                for (const [name, entry] of Object.entries(registry || {})) {
                    const repoPath = entry?.path;
                    if (!repoPath || repoPath.includes('/.aigon/worktrees/')) continue;
                    repos.push({ name, path: repoPath });
                }
                return repos;
            }

            function printMultiRepoVersionSweep() {
                console.log('\nMulti-Repo Version Sweep\n────────────────────────');
                const repos = readRegisteredReposForVersionSweep();
                if (repos.length === 0) {
                    console.log('  ℹ️  No registered repos found in ~/.aigon/ports.json.');
                    return 'no registered repos';
                }
                const currentVersion = getAigonVersion() || require('../../package.json').version;
                const rows = repos.map(repo => {
                    if (!fs.existsSync(repo.path)) return { ...repo, version: '·', status: 'not-dir' };
                    const versionFile = path.join(repo.path, '.aigon', 'version');
                    if (!fs.existsSync(versionFile)) return { ...repo, version: 'missing', status: 'missing' };
                    let installed = '';
                    try { installed = fs.readFileSync(versionFile, 'utf8').trim(); } catch (_) { installed = ''; }
                    if (!installed) return { ...repo, version: 'missing', status: 'missing' };
                    const cmp = compareVersions(installed, currentVersion);
                    return { ...repo, version: installed, status: cmp === 0 ? 'current' : (cmp < 0 ? 'behind' : 'ahead') };
                });
                const maxName = Math.max(4, ...rows.map(r => r.name.length));
                const maxPath = Math.max(4, ...rows.map(r => doctorShortenPath(r.path).length));
                const maxVersion = Math.max(7, ...rows.map(r => String(r.version).length));
                console.log(`  ${'REPO'.padEnd(maxName + 2)}${'PATH'.padEnd(maxPath + 2)}${'VERSION'.padEnd(maxVersion + 2)}STATUS`);
                for (const row of rows) {
                    const icon = row.status === 'current' ? '✅ current'
                        : row.status === 'behind' ? '⚠️  behind'
                            : row.status === 'missing' ? '❌ missing'
                                : row.status === 'ahead' ? 'ℹ️  ahead'
                                    : '· not a dir';
                    console.log(`  ${row.name.padEnd(maxName + 2)}${doctorShortenPath(row.path).padEnd(maxPath + 2)}${String(row.version).padEnd(maxVersion + 2)}${icon}`);
                }
                const stale = rows.filter(r => r.status === 'behind' && fs.existsSync(r.path));
                stale.forEach(r => report.issue({
                    section: 'multi-repo',
                    sectionTitle: 'Multi-Repo Version Sweep',
                    check: 'repo-version-behind',
                    message: `${r.name} behind (${r.version})`,
                    fix: { label: 'aigon apply', command: `aigon apply  # in ${r.name}`, autoFixable: true },
                }));
                rows.filter(r => r.status === 'missing' && fs.existsSync(r.path)).forEach(r => report.issue({
                    section: 'multi-repo',
                    sectionTitle: 'Multi-Repo Version Sweep',
                    check: 'repo-version-missing',
                    message: `${r.name} missing .aigon/version`,
                }));
                if (stale.length > 0 && !(batchFix && !sweepReposFlag)) {
                    queueFix({
                        section: 'multi-repo',
                        message: `Apply aigon to ${stale.length} stale repo(s)`,
                        label: 'aigon apply',
                        command: stale.map(r => `aigon apply  # in ${r.name}`).join('; '),
                        apply: async () => {
                            console.log('\n  Applying stale repos');
                            if (sweepReposFlag) {
                                console.log('  Repos to update:');
                                for (const row of stale) {
                                    console.log(`    - ${row.name}  ${doctorShortenPath(row.path)}  (v${row.version})`);
                                }
                            }
                            for (const row of stale) {
                                console.log(`\n  ${row.name}: running aigon apply in ${doctorShortenPath(row.path)}`);
                                const result = spawnSync('aigon', ['apply'], { cwd: row.path, stdio: 'inherit' });
                                if (result.status === 0 && !result.error) console.log(`  ✅ ${row.name}: applied`);
                                else console.log(`  ⚠️  ${row.name}: apply failed (${result.error?.message || `exit ${result.status}`})`);
                            }
                        },
                    });
                }
                const current = rows.filter(r => r.status === 'current').length;
                const behind = rows.filter(r => r.status === 'behind').length;
                const missing = rows.filter(r => r.status === 'missing').length;
                const parts = [`${current} current`];
                if (behind) parts.push(`${behind} behind`);
                if (missing) parts.push(`${missing} missing`);
                return parts.join(', ');
            }

            function printTmuxLivenessSection() {
                console.log('\ntmux Liveness\n──────────────');
                if (!isBinAvailable('tmux')) {
                    console.log('  ❌ tmux not installed');
                    return 'not installed';
                }
                const result = spawnSync('tmux', ['list-sessions'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
                if (result.status === 0) {
                    const sessions = String(result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
                    console.log(`  ✅ server running (${sessions.length} session${sessions.length === 1 ? '' : 's'})`);
                    return `server running (${sessions.length} session${sessions.length === 1 ? '' : 's'})`;
                }
                const stderr = String(result.stderr || '').trim();
                if (/no server running|failed to connect to server/i.test(stderr)) {
                    console.log('  ℹ️  server not started (no sessions yet — this is normal)');
                    return 'server not started';
                }
                console.log(`  ❌ tmux error${stderr ? ` — ${stderr}` : ''}`);
                if (batchFix) {
                    console.log('     Try: tmux kill-server && tmux new-session');
                }
                report.issue({
                    section: 'tmux',
                    sectionTitle: 'tmux Liveness',
                    check: 'tmux-error',
                    message: `tmux error${stderr ? ` — ${stderr}` : ''}`,
                    fix: { label: 'restart tmux', command: 'tmux kill-server && tmux new-session', autoFixable: false },
                });
                return stderr ? `error — ${stderr}` : 'error';
            }

            function printDashboardHealthSection() {
                console.log('\nDashboard Server Health\n───────────────────────');
                const { getDashboardRuntimePath } = require('../../global-config-migration');
                const runtimePath = getDashboardRuntimePath();
                let runtime = null;
                try {
                    if (fs.existsSync(runtimePath)) runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
                } catch (e) {
                    console.log(`  ⚠️  Could not read ${doctorShortenPath(runtimePath)}: ${e.message}`);
                    return 'unreadable runtime';
                }
                if (!runtime?.pid) {
                    console.log('  ℹ️  stopped (no dashboard runtime pid)');
                    return 'stopped';
                }
                try {
                    process.kill(runtime.pid, 0);
                } catch (_) {
                    console.log(`  ℹ️  stopped (stale pid ${runtime.pid})`);
                    return 'stopped';
                }
                const { getConfiguredServerPort } = require('../../config');
                const port = runtime.port || getConfiguredServerPort();
                const http = require('http');
                return new Promise(resolve => {
                    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1500 }, (res) => {
                        res.resume();
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log(`  ✅ running on port ${port} (pid ${runtime.pid})`);
                            resolve(`running :${port}`);
                            return;
                        }
                        console.log(`  ⚠️  unhealthy on port ${port}: HTTP ${res.statusCode}`);
                        report.issue({
                            section: 'dashboard',
                            sectionTitle: 'Dashboard Server Health',
                            check: 'dashboard-unhealthy',
                            message: `unhealthy on port ${port}: HTTP ${res.statusCode}`,
                            fix: { label: 'restart dashboard', command: 'aigon server restart', autoFixable: false },
                        });
                        resolve(`unhealthy :${port}`);
                    });
                    req.on('timeout', () => {
                        req.destroy();
                        console.log(`  ⚠️  unhealthy on port ${port}: request timed out`);
                        report.issue({
                            section: 'dashboard',
                            sectionTitle: 'Dashboard Server Health',
                            check: 'dashboard-unhealthy',
                            message: `unhealthy on port ${port}: request timed out`,
                            fix: { label: 'restart dashboard', command: 'aigon server restart', autoFixable: false },
                        });
                        resolve(`unhealthy :${port}`);
                    });
                    req.on('error', (e) => {
                        console.log(`  ℹ️  stopped (pid exists, health check failed: ${e.message})`);
                        resolve('stopped');
                    });
                });
            }

            function printShellPathSection() {
                console.log('\nShell PATH\n──────────');
                let whichAigon = '';
                try { whichAigon = execSync('which aigon', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) {}
                if (!whichAigon) {
                    console.log('  ⚠️  aigon not found on PATH');
                    report.issue({
                        section: 'shell-path',
                        sectionTitle: 'Shell PATH',
                        check: 'shell-path-aigon-missing',
                        message: 'aigon not found on PATH',
                    });
                    return 'aigon not on PATH';
                }
                let expected = '';
                try {
                    const npmPrefix = execSync('npm prefix -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                    expected = path.join(npmPrefix, 'bin', 'aigon');
                } catch (_) {}
                if (expected && path.resolve(whichAigon) !== path.resolve(expected)) {
                    console.log(`  ⚠️  which aigon → ${whichAigon}`);
                    console.log(`     Expected npm global binary: ${expected}`);
                    report.issue({
                        section: 'shell-path',
                        sectionTitle: 'Shell PATH',
                        check: 'shell-path-mismatch',
                        message: `which aigon → ${whichAigon} (expected ${expected})`,
                    });
                    return 'PATH mismatch';
                }
                console.log(`  ✅ which aigon → ${whichAigon}`);
                return `aigon → ${doctorShortenPath(whichAigon)}`;
            }

            function printGitIdentitySection() {
                console.log('\ngit Identity\n────────────');
                let name = '';
                let email = '';
                try { name = execSync('git config --global user.name', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) {}
                try { email = execSync('git config --global user.email', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) {}
                if (name && email) {
                    console.log(`  ✅ ${name} <${email}>`);
                    return `${name} <${email}>`;
                }
                if (!name) console.log('  ⚠️  git config --global user.name is missing');
                if (!email) console.log('  ⚠️  git config --global user.email is missing');
                const missing = [!name && 'user.name', !email && 'user.email'].filter(Boolean).join(' + ');
                report.issue({
                    section: 'git-identity',
                    sectionTitle: 'git Identity',
                    check: 'git-identity-missing',
                    message: `git --global ${missing} not set`,
                    fix: { label: 'set git identity', command: 'git config --global user.name "<name>" && git config --global user.email <email>', autoFixable: false },
                });
                return `${missing} missing`;
            }

            await withSection({ id: 'agent-auth', title: 'Agent Auth' }, () => printAgentAuthSection());
            await withSection({
                id: 'provider-quota',
                title: 'Provider Quota',
                summary: (r) => r || 'OK',
            }, () => {
                const providerQuotaPoller = require('../../provider-quota-poller');
                const quotaProbe = require('../../quota-probe');
                const repoPath = process.cwd();
                if (doFix) quotaProbe.migrateQuotaStateOnDisk(repoPath);
                const audit = providerQuotaPoller.auditDoctor(repoPath);
                console.log('\nProvider Quota\n──────────────');
                if (!audit.issues.length && !audit.warnings.length) {
                    console.log('  ✅ Provider quota checks passed.');
                    report.pass('provider-quota', 'Provider Quota', 'OK');
                    return 'OK';
                }
                audit.issues.forEach(msg => {
                    console.log(`  ❌ ${msg}`);
                    report.issue({
                        section: 'provider-quota',
                        sectionTitle: 'Provider Quota',
                        check: 'provider-quota',
                        message: msg,
                    });
                });
                audit.warnings.forEach(msg => {
                    console.log(`  ⚠️  ${msg}`);
                    report.issue({
                        section: 'provider-quota',
                        sectionTitle: 'Provider Quota',
                        check: 'provider-quota-warning',
                        message: msg,
                        severity: 'advisory',
                    });
                });
                return `${audit.issues.length} issue(s), ${audit.warnings.length} warning(s)`;
            });
            if (doAuthOnly) {
                report.render();
                if (deferFix && fixQueue.length > 0) {
                    const fixResult = await runFixDispatch(fixQueue, { yes: false });
                    printFixSummary(fixResult, report.issues.filter(i => i.fix && !i.fix.autoFixable).length);
                    printManualIssues(report.issues);
                } else if (batchFix && fixQueue.length > 0) {
                    const fixResult = await runFixDispatch(fixQueue, { yes: true });
                    printFixSummary(fixResult, report.issues.filter(i => i.fix && !i.fix.autoFixable).length);
                }
                if (report.worstSeverity() === 'blocking') process.exitCode = 1;
                return;
            }
            if (doctorScope !== 'ports') {
            await withSection({ id: 'model-health', title: 'Model Health' }, () => printModelHealthSection());
            await withSection({ id: 'terminal-app', title: 'Terminal App' }, () => printTerminalAppSection());
            await withSection({ id: 'multi-repo', title: 'Multi-Repo Version Sweep' }, () => printMultiRepoVersionSweep());
            await withSection({ id: 'tmux', title: 'tmux Liveness' }, () => printTmuxLivenessSection());
            await withSection({ id: 'dashboard', title: 'Dashboard Server Health' }, () => printDashboardHealthSection());
            await withSection({ id: 'shell-path', title: 'Shell PATH' }, () => printShellPathSection());
            await withSection({ id: 'git-identity', title: 'git Identity' }, () => printGitIdentitySection());
            await withSection({
                id: 'stash-hygiene',
                title: 'Stash Hygiene',
                summary: (r) => r || 'no leaked auto-stashes',
            }, () => {
                const { findAutoStashes, archiveAndDropAutoStashes } = require('../../doctor/stale-stashes');
                const repoPath = process.cwd();
                const leaked = findAutoStashes(repoPath);
                console.log('\nStash Hygiene\n─────────────');
                if (leaked.length === 0) {
                    console.log('  ✅ No leaked feature-close auto-stashes.');
                    report.pass('stash-hygiene', 'Stash Hygiene', 'no leaked auto-stashes');
                    return 'no leaked auto-stashes';
                }
                const label = `${leaked.length} leaked feature-close auto-stash${leaked.length === 1 ? '' : 'es'}`;
                console.log(`  ⚠️  ${label} (from conflicted stash pops that were never dropped):`);
                leaked.forEach(s => console.log(`     ${s.ref}  ${s.sha.slice(0, 8)}`));
                if (!doFix) console.log('     💡 Run `aigon doctor --fix` to archive each to a patch, then drop.');
                report.issue({
                    section: 'stash-hygiene',
                    sectionTitle: 'Stash Hygiene',
                    check: 'stale-auto-stash',
                    message: label,
                    fix: { label: 'archive + drop auto-stashes', command: 'aigon doctor --fix', autoFixable: true },
                });
                queueFix({
                    section: 'stash-hygiene',
                    message: label,
                    label: 'archive + drop leaked auto-stashes',
                    command: 'aigon doctor --fix',
                    apply: () => {
                        const res = archiveAndDropAutoStashes(repoPath);
                        res.patches.forEach(p => console.log(`  📦 archived ${path.relative(repoPath, p)}`));
                        console.log(`  ✅ stale-auto-stash: archived ${res.archived}, dropped ${res.dropped}`);
                        res.errors.forEach(e => console.log(`  ⚠️  stale-auto-stash: ${e}`));
                    },
                });
                return label;
            });
            }

            if (allProjects.length === 0) {
                console.log('\nPort Health Check\n─────────────────');
                console.log('No projects with port configurations found.');
                report.render();
                if (report.worstSeverity() === 'blocking') process.exitCode = 1;
                return;
            }

            // Sort by port, then name
            allProjects.sort((a, b) => a.basePort - b.basePort || a.name.localeCompare(b.name));

            // Group by basePort to detect conflicts
            const portGroups = new Map();
            for (const project of allProjects) {
                const key = project.basePort;
                if (!portGroups.has(key)) portGroups.set(key, []);
                portGroups.get(key).push(project);
            }

            // Also check for overlapping ranges (each project uses base..base+blockSize-1)
            const rangeConflicts = new Map(); // port -> [conflicting project names]
            const sortedProjects = [...allProjects];
            for (let i = 0; i < sortedProjects.length; i++) {
                for (let j = i + 1; j < sortedProjects.length; j++) {
                    const a = sortedProjects[i];
                    const b = sortedProjects[j];
                    if (a.basePort === b.basePort) continue; // handled by portGroups
                    if (Math.abs(a.basePort - b.basePort) < blockSize) {
                        const key = Math.min(a.basePort, b.basePort);
                        if (!rangeConflicts.has(key)) rangeConflicts.set(key, new Set());
                        rangeConflicts.get(key).add(a.name);
                        rangeConflicts.get(key).add(b.name);
                    }
                }
            }

            // Display table
            const { homedir } = require('os');
            const shortenPath = (p) => p && p.startsWith(homedir()) ? '~' + p.slice(homedir().length) : (p || '(unknown)');

            let portConflictCount = 0;
            let portUnregisteredCount = 0;
            let portDeadCount = 0;
            await withSection({
                id: 'port-health',
                title: 'Port Health',
                verboseOnly: true,
                summary: () => {
                    if (portConflictCount === 0 && portDeadCount === 0 && portUnregisteredCount === 0) {
                        return `no conflicts (${allProjects.length} project${allProjects.length === 1 ? '' : 's'})`;
                    }
                    const parts = [];
                    if (portConflictCount) parts.push(`${portConflictCount} conflict${portConflictCount === 1 ? '' : 's'}`);
                    if (portDeadCount) parts.push(`${portDeadCount} stale`);
                    if (portUnregisteredCount) parts.push(`${portUnregisteredCount} unregistered`);
                    return parts.join(', ');
                },
            }, () => {
            console.log('\nPort Health Check\n─────────────────');

            // Calculate column widths
            const maxNameLen = Math.max(4, ...allProjects.map(p => p.name.length));
            const maxPathLen = Math.max(4, ...allProjects.map(p => shortenPath(p.path).length));

            const header = `  ${'PORT'.padEnd(7)}${'REPO'.padEnd(maxNameLen + 2)}${'PATH'.padEnd(maxPathLen + 2)}REGISTERED`;
            console.log(header);

            let conflictCount = 0;
            let unregisteredCount = 0;
            let deadCount = 0;

            for (const [port, projects] of [...portGroups.entries()].sort((a, b) => a[0] - b[0])) {
                const isConflict = projects.length > 1;
                if (isConflict) conflictCount++;

                for (const project of projects) {
                    if (!project.registered) unregisteredCount++;
                    const portStr = String(project.basePort).padEnd(7);
                    const nameStr = project.name.padEnd(maxNameLen + 2);
                    const pathStr = shortenPath(project.path).padEnd(maxPathLen + 2);
                    const regStr = project.registered ? 'yes' : 'no';
                    console.log(`  ${portStr}${nameStr}${pathStr}${regStr}`);
                }

                if (isConflict) {
                    const names = projects.map(p => p.name).join(' and ');
                    console.log(`         ⚠️  CONFLICT: ${names} both use port ${port}`);
                    report.issue({
                        section: 'port-health',
                        sectionTitle: 'Port Health',
                        check: 'port-conflict',
                        message: `${names} both use port ${port}`,
                        fix: AUTO_FIX,
                    });
                }

                console.log('');
            }

            // Print range conflicts (different base ports but overlapping ranges)
            for (const [, names] of rangeConflicts) {
                const nameArr = [...names];
                const involved = allProjects.filter(p => nameArr.includes(p.name));
                const portsStr = involved.map(p => `${p.name}:${p.basePort}`).join(', ');
                console.log(`  ⚠️  RANGE OVERLAP: ${portsStr} — ranges within ${blockSize} of each other`);
                conflictCount++;
                report.issue({
                    section: 'port-health',
                    sectionTitle: 'Port Health',
                    check: 'port-range-overlap',
                    message: `${portsStr} — ranges within ${blockSize} of each other`,
                    fix: AUTO_FIX,
                });
            }

            // Clean dead entries (repos that no longer exist)
            for (const project of allProjects) {
                if (project.registered && !fs.existsSync(project.path)) {
                    deadCount++;
                    console.log(`  🗑️  STALE: ${project.name} — ${project.path} no longer exists`);
                    queueFix({
                        section: 'port-health',
                        message: `Remove stale port entry: ${project.name}`,
                        label: 'deregister stale port',
                        command: `aigon doctor --ports --fix`,
                        apply: () => {
                            u.deregisterPort(project.name);
                            console.log(`     ✅ Removed ${project.name} from registry`);
                        },
                    });
                    report.issue({
                        section: 'port-health',
                        sectionTitle: 'Port Health',
                        check: 'port-stale',
                        message: `${project.name} — ${project.path} no longer exists`,
                        fix: AUTO_FIX,
                    });
                }
            }

            // Fix port conflicts by re-allocating (queued for interactive; immediate when --yes)
            if (conflictCount > 0) {
                queueFix({
                    section: 'port-health',
                    message: `Re-allocate ${conflictCount} port conflict(s)`,
                    label: 're-allocate ports',
                    command: 'aigon doctor --ports --fix',
                    apply: () => {
                        const conflictingNames = new Set();
                        for (const [, projects] of portGroups) {
                            if (projects.length > 1) {
                                for (let i = 1; i < projects.length; i++) {
                                    if (projects[i].registered) conflictingNames.add(projects[i].name);
                                }
                            }
                        }
                        for (const [, names] of rangeConflicts) {
                            const nameArr = [...names];
                            for (let i = 1; i < nameArr.length; i++) {
                                conflictingNames.add(nameArr[i]);
                            }
                        }
                        for (const name of conflictingNames) {
                            const newPort = reallocatePortFn(name);
                            if (newPort !== null) {
                                console.log(`  ✅ Re-allocated ${name} → port ${newPort}`);
                            }
                        }
                    },
                });
            }

            // Summary
            if (conflictCount > 0 || unregisteredCount > 0 || deadCount > 0) {
                const parts = [];
                if (conflictCount > 0) parts.push(`${conflictCount} conflict${conflictCount === 1 ? '' : 's'} found`);
                if (unregisteredCount > 0) parts.push(`${unregisteredCount} unregistered project${unregisteredCount === 1 ? '' : 's'}`);
                if (deadCount > 0) parts.push(`${deadCount} stale entr${deadCount === 1 ? 'y' : 'ies'}`);
                console.log(parts.join('. ') + '.');
            } else {
                console.log('No conflicts found.');
            }

            if (unregisteredCount > 0 && !doRegister) {
                console.log(`💡 Run \`aigon doctor --register\` to register the current project.`);
            }
            if ((conflictCount > 0 || deadCount > 0) && !doFix) {
                console.log(`💡 Run \`aigon doctor --fix\` to resolve conflicts and clean stale entries.`);
            }
            portConflictCount = conflictCount;
            portUnregisteredCount = unregisteredCount;
            portDeadCount = deadCount;
            }); // end Port Health withSection

            if (doctorScope === 'ports') {
                report.render();
                if (deferFix && fixQueue.length > 0) {
                    const fixResult = await runFixDispatch(fixQueue, { yes: false });
                    printFixSummary(fixResult, report.issues.filter(i => i.fix && !i.fix.autoFixable).length);
                    printManualIssues(report.issues);
                } else if (batchFix && fixQueue.length > 0) {
                    const fixResult = await runFixDispatch(fixQueue, { yes: true });
                    printFixSummary(fixResult, report.issues.filter(i => i.fix && !i.fix.autoFixable).length);
                }
                if (report.worstSeverity() === 'blocking') process.exitCode = 1;
                return;
            }

            // Backup status check moved to @aigon/pro with feature 236.
            // When Pro is installed, defer to its backup engine; otherwise no
            // status row is printed (free tier has no backup capability).
            let backupActive = false;
            try {
                const { isProAvailable, getPro } = require('../../pro');
                backupActive = isProAvailable() && getPro() && getPro().backup && typeof getPro().backup.status === 'function';
            } catch (_) { backupActive = false; }
            if (backupActive) await withSection({ id: 'backup', title: 'Backup' }, () => {
                try {
                    const { getPro } = require('../../pro');
                    console.log('\nBackup\n──────');
                    const s = getPro().backup.status();
                    if (!s.configured) {
                        console.log('  ℹ️  Backup not configured — run `aigon backup configure` to protect your aigon data.');
                        report.issue({
                            section: 'backup',
                            sectionTitle: 'Backup',
                            check: 'backup-not-configured',
                            message: 'Backup not configured',
                            fix: { label: 'configure backup', command: 'aigon backup configure', autoFixable: false },
                        });
                        return 'not configured';
                    }
                    console.log(`  ✅ Backup configured: ${s.remote}`);
                    console.log(`     Last push: ${s.lastPushAt || 'never'} · Schedule: ${s.schedule}${s.scheduleActive ? '' : ' (inactive)'}`);
                    return `${s.schedule}${s.scheduleActive ? '' : ' (inactive)'}`;
                } catch (_) { return 'unavailable'; }
            });

            // --- Linux Platform Checks ---
            if (process.platform === 'linux') await withSection({ id: 'linux', title: 'Linux Platform' }, () => {
                console.log('\nLinux Platform\n──────────────');
                // Check terminal emulators
                const terminals = ['kitty', 'gnome-terminal', 'xterm'];
                const found = terminals.filter(t => {
                    try { execSync(`which ${t}`, { stdio: 'pipe' }); return true; } catch { return false; }
                });
                if (found.length > 0) {
                    console.log(`  ✅ Terminal emulators: ${found.join(', ')}`);
                } else {
                    console.log('  ⚠️  No supported terminal emulator found (kitty, gnome-terminal, xterm)');
                    console.log('     Aigon will print tmux attach commands for manual use');
                }
                // Check xdg-open
                let xdg = false;
                try {
                    execSync('which xdg-open', { stdio: 'pipe' });
                    console.log('  ✅ xdg-open is available');
                    xdg = true;
                } catch {
                    console.log('  ⚠️  xdg-open not found — file/URL opening may not work');
                    console.log('     Install: sudo apt install xdg-utils');
                }
                return `${found.length} terminal${found.length === 1 ? '' : 's'}, xdg-open ${xdg ? 'ok' : 'missing'}`;
            });

            // --- Proxy Health ---
            await withSection({ id: 'proxy', title: 'Proxy Health' }, () => {
                console.log('\nProxy Health (Caddy)\n────────────────────');
                try {
                    const diag = proxyDiagnosticsFn();
                    const ok = (v) => v ? '✅' : '❌';
                    console.log(`  ${ok(diag.proxy.installed)} Caddy installed`);
                    console.log(`  ${ok(diag.proxy.running)} Caddy running`);
                    const routes = parseCaddyRoutesFn();
                    console.log(`  ℹ️  Routes: ${routes.length} configured`);
                    if (diag.fix) {
                        console.log(`\n  💡 Fix: ${diag.fix}`);
                    }
                    if (!diag.proxy.installed) {
                        report.issue({
                            section: 'proxy',
                            sectionTitle: 'Proxy Health',
                            check: 'caddy-not-installed',
                            message: 'Caddy not installed',
                            fix: { label: diag.fix || 'install caddy', command: diag.fix || 'brew install caddy', autoFixable: false },
                        });
                        return 'Caddy not installed';
                    }
                    if (!diag.proxy.running) {
                        report.issue({
                            section: 'proxy',
                            sectionTitle: 'Proxy Health',
                            check: 'caddy-not-running',
                            message: 'Caddy installed but not running',
                            fix: { label: diag.fix || 'start caddy', command: diag.fix || 'brew services start caddy', autoFixable: false },
                        });
                        return 'Caddy not running';
                    }
                    return `Caddy running, ${routes.length} route${routes.length === 1 ? '' : 's'}`;
                } catch (e) {
                    console.log(`  ⚠️  Proxy diagnostics failed: ${e.message}`);
                    report.issue({
                        section: 'proxy',
                        sectionTitle: 'Proxy Health',
                        check: 'proxy-diag-failed',
                        message: `Proxy diagnostics failed: ${e.message}`,
                    });
                    return 'diagnostics failed';
                }
            });

            // F550: route legacy state-reconciliation checks into digest sections.
            const ROUTE_SECTION = (check) => {
                if (check === 'stale-drive-branch') return ['git-branches', 'git Branches'];
                if (check === 'signal-health-low-reliability') return ['signal-health', 'Signal Health'];
                if (check === 'invalid-spec-agent-field') return ['spec-frontmatter', 'Spec Frontmatter'];
                if (check === 'pending-migrations' || check === 'migration-failed') return ['schema-migrations', 'Schema Migrations'];
                if (String(check).startsWith('install-manifest-')) return ['install-manifest', 'Install Manifest'];
                if (check === 'missing-workflow-state' || check === 'partial-bootstrap' || check === 'legacy-submitted-lifecycle' || check === 'spec-folder-drift' || check === 'misplaced-slug-spec') return ['workflow-state', 'Workflow State'];
                if (check === 'worktree-dir-missing' || check === 'legacy-worktree-location') return ['worktrees', 'Worktrees'];
                if (check === 'pre-commit-hook-missing' || check === 'git-hooks-path-missing' || check === 'env-local-tracked' || check === 'env-local-untracked') return ['security-hooks', 'Security Hooks'];
                if (check === 'research-folder-renumber' || check === 'log-migration') return ['migrations', 'Migrations'];
                return ['state-reconciliation', 'State Reconciliation'];
            };

            const agentStatus = require('../../agent-status');
            const issues = [];
            await withSection({
                id: 'state-reconciliation',
                title: 'State Reconciliation',
                expandWhen: () => issues.length > 0,
                summary: () => {
                    if (issues.length === 0) return 'no issues';
                    const safeCount = issues.filter(i => i.safe).length;
                    return `${issues.length} issue${issues.length === 1 ? '' : 's'}${safeCount > 0 ? ` (${safeCount} auto-fixable)` : ''}`;
                },
            }, async () => {
            console.log('\nState Reconciliation\n────────────────────');
            const stateDir = agentStatus.getStateDir();
            const locksDir = agentStatus.getLocksDir();

            function detectDefaultBranchForRepo(repoPath) {
                const quoted = JSON.stringify(repoPath);
                try {
                    const remoteHead = execSync(`git -C ${quoted} symbolic-ref --short refs/remotes/origin/HEAD`, { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
                    }).trim();
                    const parsed = remoteHead.replace(/^origin\//, '').trim();
                    if (parsed) return parsed;
                } catch (_) { /* ignore */ }
                for (const candidate of ['main', 'master']) {
                    try {
                        execSync(`git -C ${quoted} show-ref --verify --quiet refs/heads/${candidate}`, { stdio: 'ignore' }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
                        return candidate;
                    } catch (_) { /* ignore */ }
                }
                return 'main';
            }

            function hasFeatureWorktreeCommits(id, agent) {
                const wtBase = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(process.cwd()));
                // Also check legacy sibling location
                const legacyWtBase = path.resolve(process.cwd(), '..', path.basename(process.cwd()) + '-worktrees');
                const effectiveBase = fs.existsSync(wtBase) ? wtBase : (fs.existsSync(legacyWtBase) ? legacyWtBase : null);
                if (!effectiveBase) return false;
                const paddedId = String(id).padStart(2, '0');
                const unpaddedId = String(parseInt(id, 10));
                let worktreePath = null;
                try {
                    const entries = fs.readdirSync(effectiveBase);
                    const hit = entries.find(name => {
                        const m = name.match(/^feature-(\d+)-([a-z]{2})-.+$/);
                        return m && (m[1] === paddedId || m[1] === unpaddedId) && m[2] === agent;
                    });
                    if (hit) worktreePath = path.join(effectiveBase, hit);
                } catch (_) { /* ignore */ }
                if (!worktreePath) return false;
                const quoted = JSON.stringify(worktreePath);
                const defaultBranch = detectDefaultBranchForRepo(worktreePath);
                try {
                    const ahead = parseInt(execSync(`git -C ${quoted} rev-list --count ${defaultBranch}..HEAD`, {
                        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
                    }).trim(), 10);
                    return Number.isFinite(ahead) && ahead > 0;
                } catch (_) {
                    return false;
                }
            }

            function hasResearchFindingsProgress(researchId, agent) {
                const logsDir = path.join(process.cwd(), 'docs', 'specs', 'research-topics', 'logs');
                const filePath = path.join(logsDir, `research-${researchId}-${agent}-findings.md`);
                if (!fs.existsSync(filePath)) return false;
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const section = content.match(/^##\s+Findings\s*\r?\n([\s\S]*?)(?=^##\s+|$)/im);
                    const body = (section ? section[1] : content).split(/\r?\n/)
                        .map(line => line.trim())
                        .filter(Boolean)
                        .filter(line => !line.startsWith('- [') && !/^TBD$/i.test(line));
                    return body.length >= 3;
                } catch (_) {
                    return false;
                }
            }

            function isAgentSessionRunning(entityType, id, agent) {
                try {
                    const out = execSync('tmux list-sessions -F "#S"', {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'ignore']
                    });
                    const names = out.split('\n').map(v => v.trim()).filter(Boolean);
                    const prefix = entityType === 'research' ? `-r${parseInt(id, 10)}-${agent}` : `-f${parseInt(id, 10)}-${agent}`;
                    return names.some(name => name.includes(prefix));
                } catch (_) {
                    return false;
                }
            }

            // Check: .env.local gitignore + tracking state
            const preCommitHookPath = path.join(process.cwd(), SECURITY_HOOKS_PATH, PRE_COMMIT_HOOK_NAME);
            if (!fs.existsSync(preCommitHookPath)) {
                const issue = {
                    check: 'pre-commit-hook-missing',
                    featureId: '-',
                    message: `Missing ${SECURITY_HOOKS_PATH}/${PRE_COMMIT_HOOK_NAME}`,
                    safe: true,
                };
                issues.push(issue);
                console.log(`  ⚠️  pre-commit-hook-missing: ${issue.message}`);
                if (!doFix) console.log(`     💡 Run \`aigon doctor --fix\` to scaffold the hook.`);
                queueFix({
                    section: 'state-reconciliation',
                    message: issue.message,
                    label: 'scaffold pre-commit hook',
                    command: 'aigon doctor --fix',
                    apply: () => {
                        ensurePreCommitHook();
                        console.log(`  ✅ pre-commit-hook-missing: created ${SECURITY_HOOKS_PATH}/${PRE_COMMIT_HOOK_NAME}`);
                    },
                });
            }

            if (!isHooksPathConfigured()) {
                const issue = {
                    check: 'git-hooks-path-missing',
                    featureId: '-',
                    message: `git core.hooksPath is not set to ${SECURITY_HOOKS_PATH}`,
                    safe: true,
                };
                issues.push(issue);
                console.log(`  ⚠️  git-hooks-path-missing: ${issue.message}`);
                if (!doFix) console.log(`     💡 Run \`aigon doctor --fix\` to configure git hooks.`);
                queueFix({
                    section: 'state-reconciliation',
                    message: issue.message,
                    label: 'configure git hooksPath',
                    command: 'aigon doctor --fix',
                    apply: () => {
                        const hookSetup = ensureHooksPathConfigured();
                        if (hookSetup.ok) {
                            console.log(`  ✅ git-hooks-path-missing: set core.hooksPath=${SECURITY_HOOKS_PATH}`);
                        } else {
                            console.log(`  ⚠️  git-hooks-path-missing: failed to set hooksPath (${hookSetup.error})`);
                        }
                    },
                });
            }

            const envGitignoreStatus = getEnvLocalGitignoreStatus();
            if (!envGitignoreStatus.hasAllEntries) {
                const issue = {
                    check: 'env-gitignore-missing',
                    featureId: '-',
                    message: `Missing .gitignore entries: ${envGitignoreStatus.missingEntries.join(', ')}`,
                    safe: true,
                };
                issues.push(issue);
                console.log(`  ⚠️  env-gitignore-missing: ${issue.message}`);
                if (!doFix) console.log('     💡 Run `aigon doctor --fix` to add them automatically.');
                queueFix({
                    section: 'state-reconciliation',
                    message: issue.message,
                    label: 'add .gitignore entries',
                    command: 'aigon doctor --fix',
                    apply: () => {
                        const result = ensureEnvLocalGitignore();
                        console.log(`  ✅ env-gitignore-missing: added ${result.addedEntries.join(', ')}`);
                    },
                });
            }

            const trackedEnvLocals = getTrackedEnvLocalFiles();
            if (trackedEnvLocals.length > 0) {
                const issue = {
                    check: 'tracked-env-local',
                    featureId: '-',
                    message: `Tracked env-local files: ${trackedEnvLocals.join(', ')}`,
                    safe: true,
                };
                issues.push(issue);
                console.log(`  ⚠️  tracked-env-local: ${issue.message}`);
                if (!doFix) console.log('     💡 Run `aigon doctor --fix` to untrack and keep local copies.');
                queueFix({
                    section: 'state-reconciliation',
                    message: issue.message,
                    label: 'untrack env-local files',
                    command: 'aigon doctor --fix',
                    apply: () => {
                        const untracked = untrackFiles(process.cwd(), trackedEnvLocals);
                        if (untracked.ok) {
                            console.log(`  ✅ tracked-env-local: untracked ${trackedEnvLocals.length} file(s)`);
                        } else {
                            console.log(`  ⚠️  tracked-env-local: failed to untrack (${untracked.error})`);
                        }
                    },
                });
            }

            // Check: GitHub secret scanning enabled (requires gh CLI)
            const { isBinaryAvailable } = require('../../security');
            if (isBinaryAvailable('gh')) {
                try {
                    // Get the remote repo in owner/repo format
                    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                    let ownerRepo = null;
                    // Parse SSH or HTTPS URLs
                    const sshMatch = remoteUrl.match(/[:\/]([^/]+\/[^/]+?)(?:\.git)?$/);
                    if (sshMatch) ownerRepo = sshMatch[1];

                    if (ownerRepo) {
                        const apiResult = execSync(
                            `gh api repos/${ownerRepo} --jq '.security_and_analysis.secret_scanning.status // "not_available"'`,
                            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
                        ).trim();

                        if (apiResult === 'enabled') {
                            console.log(`  ✅ GitHub secret scanning: enabled (${ownerRepo})`);
                        } else {
                            const issue = {
                                check: 'github-secret-scanning-disabled',
                                featureId: '-',
                                message: `GitHub secret scanning not enabled for ${ownerRepo}`,
                                safe: false,
                            };
                            issues.push(issue);
                            console.log(`  ⚠️  github-secret-scanning-disabled: ${issue.message}`);
                            console.log(`     💡 Enable at: https://github.com/${ownerRepo}/settings/security_analysis`);
                        }

                        // Also check push protection
                        const pushProtection = execSync(
                            `gh api repos/${ownerRepo} --jq '.security_and_analysis.secret_scanning_push_protection.status // "not_available"'`,
                            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
                        ).trim();

                        if (pushProtection === 'enabled') {
                            console.log(`  ✅ GitHub push protection: enabled`);
                        } else {
                            const issue = {
                                check: 'github-push-protection-disabled',
                                featureId: '-',
                                message: `GitHub push protection not enabled for ${ownerRepo}`,
                                safe: false,
                            };
                            issues.push(issue);
                            console.log(`  ⚠️  github-push-protection-disabled: ${issue.message}`);
                            console.log(`     💡 Enable at: https://github.com/${ownerRepo}/settings/security_analysis`);
                        }
                    }
                } catch (e) {
                    // gh not authenticated or API error — skip gracefully
                    console.log(`  ℹ️  GitHub secret scanning: could not check (${e.message.split('\n')[0]})`);
                }
            } else {
                console.log(`  ℹ️  GitHub secret scanning: skipped (gh CLI not installed)`);
            }

            const { writeAgentStatus } = require('../../agent-status');
            const manifest = {
                readManifest(id) {
                    const manifestPath = path.join(stateDir, `feature-${id}.json`);
                    if (!fs.existsSync(manifestPath)) return null;
                    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                },
                writeManifest(id, patch) {
                    const manifestPath = path.join(stateDir, `feature-${id}.json`);
                    const current = this.readManifest(id) || { id };
                    fs.writeFileSync(manifestPath, JSON.stringify({ ...current, ...patch }, null, 2) + '\n');
                },
                writeAgentStatus(id, agent, data, prefix = 'feature') {
                    writeAgentStatus(id, agent, data, prefix);
                },
            };

            const signalSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const signalSummary = signalHealth.summarizeSignalEvents(signalHealth.readSignalEvents({
                repoPath: process.cwd(),
                since: signalSince,
            }));
            console.log('\nSignal-health summary (last 30 days)');
            if (signalSummary.length === 0) {
                console.log('  No signal-health events recorded.');
            } else {
                console.log('  Agent  Reliability  Emitted  Missed  Recovered  Abandoned');
                signalSummary.forEach(row => {
                    const recovered = row.recoveredViaNudge + row.recoveredViaUser;
                    console.log(`  ${row.agent.padEnd(5)}  ${`${row.reliability.toFixed(1)}%`.padStart(11)}  ${String(row.emitted).padStart(7)}  ${String(row.missed).padStart(6)}  ${String(recovered).padStart(9)}  ${String(row.abandoned).padStart(9)}`);
                    const sessions = row.emitted + row.missed + row.abandoned + row.outOfOrder;
                    if (sessions >= 5 && row.reliability < 70) {
                        issues.push({
                            check: 'signal-health-low-reliability',
                            featureId: '-',
                            message: `${row.agent} signal reliability is ${row.reliability.toFixed(1)}% over ${sessions} sessions`,
                            safe: false,
                        });
                        console.log(`     ⚠️  reliability below 70% over ${sessions} sessions`);
                    }
                });
            }
            if (doGc) {
                const gcResult = signalHealth.gcSignalHealth(process.cwd());
                console.log(`  ✅ Signal-health GC removed ${gcResult.removed} old daily file(s); retention ${gcResult.retentionDays} days`);
            }

            // Discover all feature manifests
            let manifestFiles = [];
            if (fs.existsSync(stateDir)) {
                try {
                    manifestFiles = fs.readdirSync(stateDir)
                        .filter(f => /^feature-\d+\.json$/.test(f))
                        .map(f => {
                            const m = f.match(/^feature-(\d+)\.json$/);
                            return m ? m[1] : null;
                        })
                        .filter(Boolean);
                } catch (e) { /* ignore */ }
            }

            // Also discover features from spec folders that may not have manifests yet
            const specsRoot = path.join(process.cwd(), 'docs', 'specs', 'features');
            const FOLDERS = [
                { folder: STAGE_FOLDERS.INBOX, stage: 'inbox' },
                { folder: STAGE_FOLDERS.BACKLOG, stage: 'backlog' },
                { folder: STAGE_FOLDERS.IN_PROGRESS, stage: 'in-progress' },
                { folder: STAGE_FOLDERS.IN_EVALUATION, stage: 'in-evaluation' },
                { folder: STAGE_FOLDERS.DONE, stage: 'done' },
                { folder: STAGE_FOLDERS.PAUSED, stage: 'paused' },
            ];
            const folderStageById = {};
            FOLDERS.forEach(({ folder, stage }) => {
                const dir = path.join(specsRoot, folder);
                if (!fs.existsSync(dir)) return;
                try {
                    fs.readdirSync(dir).forEach(f => {
                        const m = f.match(/^feature-(\d+)-/);
                        if (m) folderStageById[m[1]] = stage;
                    });
                } catch (e) { /* ignore */ }
            });

            // Merge IDs from manifests + folders
            const allIds = [...new Set([...manifestFiles, ...Object.keys(folderStageById)])];

            for (const id of allIds) {
                let m;
                try { m = manifest.readManifest(id); } catch (e) { continue; }
                if (!m) continue;

                const folderStage = folderStageById[id] || null;

                // Check 1: stage-mismatch — manifest stage vs folder position
                if (folderStage && m.stage !== folderStage) {
                    const issue = {
                        check: 'stage-mismatch',
                        featureId: id,
                        message: `Manifest stage '${m.stage}' != folder stage '${folderStage}'`,
                        safe: true,
                    };
                    issues.push(issue);
                    if (batchFix) {
                        // Safe repair: correct manifest to match folder (folder is source of truth)
                        manifest.writeManifest(id, { stage: folderStage }, { type: 'reconcile-stage', actor: 'doctor' });
                        console.log(`  ✅ stage-mismatch [feature-${id}]: fixed (${m.stage} → ${folderStage})`);
                    } else {
                        console.log(`  ⚠️  stage-mismatch [feature-${id}]: ${issue.message}`);
                    }
                }

                // Check 2: orphaned-worktree — manifest agents vs worktree existence
                if (m.agents && m.agents.length > 0 && m.stage !== 'in-progress' && m.stage !== 'in-evaluation') {
                    // For done/paused features, worktrees should not exist
                    let worktrees = [];
                    try {
                        const wtOutput = execSync('git worktree list', { encoding: 'utf8', timeout: 5000 });
                        for (const line of wtOutput.split('\n')) {
                            const wtMatch = line.match(/^([^\s]+)\s+/);
                            if (!wtMatch) continue;
                            const wtPath = wtMatch[1];
                            const base = path.basename(wtPath);
                            const paddedId = String(id).padStart(2, '0');
                            const unpaddedId = String(parseInt(id, 10));
                            if (base.match(new RegExp(`^feature-(${paddedId}|${unpaddedId})-`))) {
                                worktrees.push(wtPath);
                            }
                        }
                    } catch (e) { /* ignore */ }

                    if (worktrees.length > 0) {
                        worktrees.forEach(wtPath => {
                            const issue = {
                                check: 'orphaned-worktree',
                                featureId: id,
                                message: `Worktree exists for ${m.stage} feature: ${wtPath}`,
                                safe: false,
                            };
                            issues.push(issue);
                            console.log(`  ⚠️  orphaned-worktree [feature-${id}]: ${issue.message}`);
                        });
                    }
                }

                // Check 3: stale-pending — pending ops older than 1 hour
                if (m.pending && m.pending.length > 0) {
                    const lastEvent = m.events && m.events.length > 0 ? m.events[m.events.length - 1] : null;
                    const lastEventTime = lastEvent ? new Date(lastEvent.at).getTime() : 0;
                    const ageMs = Date.now() - lastEventTime;
                    const ONE_HOUR = 60 * 60 * 1000;
                    if (ageMs > ONE_HOUR) {
                        const ageHours = Math.round(ageMs / ONE_HOUR);
                        const issue = {
                            check: 'stale-pending',
                            featureId: id,
                            message: `Pending ops [${m.pending.join(', ')}] stale for ~${ageHours}h`,
                            safe: true,
                        };
                        issues.push(issue);
                        if (batchFix) {
                            // Safe repair: clear stale pending ops
                            manifest.writeManifest(id, { pending: [] }, { type: 'reconcile-pending', actor: 'doctor' });
                            console.log(`  ✅ stale-pending [feature-${id}]: cleared ${m.pending.length} stale op(s)`);
                        } else {
                            console.log(`  ⚠️  stale-pending [feature-${id}]: ${issue.message}`);
                        }
                    }
                }

                // Check 4: dead-agent — agent status files for closed features
                if (m.stage === 'done') {
                    const agentsWithStatus = [];
                    if (fs.existsSync(stateDir)) {
                        try {
                            fs.readdirSync(stateDir)
                                .filter(f => {
                                    const paddedId = String(id).padStart(2, '0');
                                    const unpaddedId = String(parseInt(id, 10));
                                    return f.match(new RegExp(`^feature-(${paddedId}|${unpaddedId})-[a-z]+\\.json$`));
                                })
                                .forEach(f => agentsWithStatus.push(f));
                        } catch (e) { /* ignore */ }
                    }
                    if (agentsWithStatus.length > 0) {
                        const issue = {
                            check: 'dead-agent',
                            featureId: id,
                            message: `${agentsWithStatus.length} agent status file(s) for done feature: ${agentsWithStatus.join(', ')}`,
                            safe: true,
                        };
                        issues.push(issue);
                        if (batchFix) {
                            agentsWithStatus.forEach(f => {
                                try { fs.unlinkSync(path.join(stateDir, f)); } catch (e) { /* ignore */ }
                            });
                            console.log(`  ✅ dead-agent [feature-${id}]: removed ${agentsWithStatus.length} agent status file(s)`);
                        } else {
                            console.log(`  ⚠️  dead-agent [feature-${id}]: ${issue.message}`);
                        }
                    }
                }

                // Check 5: stale-implementing-session-ended — implementing status with no tmux session but evidence of work
                if ((m.stage === 'in-progress' || m.stage === 'in-evaluation') && Array.isArray(m.agents)) {
                    m.agents.forEach(agent => {
                        if (!agent || agent === 'solo') return;
                        const statusPath = path.join(stateDir, `feature-${id}-${agent}.json`);
                        let agentState = null;
                        try {
                            if (fs.existsSync(statusPath)) {
                                agentState = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
                            }
                        } catch (_) { /* ignore */ }
                        const status = agentState && agentState.status ? agentState.status : 'implementing';
                        if (status !== 'implementing') return;
                        const flags = (agentState && agentState.flags && typeof agentState.flags === 'object') ? agentState.flags : {};
                        if (flags.sessionEnded) return;
                        const tmuxRunning = isAgentSessionRunning('feature', id, agent);
                        if (tmuxRunning) return;
                        if (!hasFeatureWorktreeCommits(id, agent)) return;

                        const issue = {
                            check: 'stale-implementing-session-ended',
                            featureId: id,
                            message: `Agent ${agent} has implementing status but session is ended with implementation commits`,
                            safe: true,
                        };
                        issues.push(issue);
                        if (batchFix) {
                            manifest.writeAgentStatus(id, agent, {
                                status: 'implementing',
                                flags: {
                                    ...flags,
                                    sessionEnded: true,
                                    sessionEndedAt: new Date().toISOString()
                                }
                            });
                            console.log(`  ✅ stale-implementing-session-ended [feature-${id}-${agent}]: flagged sessionEnded`);
                        } else {
                            console.log(`  ⚠️  stale-implementing-session-ended [feature-${id}-${agent}]: ${issue.message}`);
                        }
                    });
                }
            }

            // Check: stale drive-style branch alongside worktree branches (feature 240)
            // A bare `feature-<num>-<slug>` branch must never coexist with a
            // worktree branch `feature-<num>-<agent>-<slug>` for the same feature —
            // feature-close resolves the drive branch first and silently merges
            // the wrong commits. Detect and guide the user through safe cleanup.
            try {
                const allBranches = execSync('git branch --format="%(refname:short)"', {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                }).split('\n').map(s => s.trim()).filter(Boolean);

                const byFeatureId = new Map();
                for (const br of allBranches) {
                    const match = br.match(/^feature-(\d+)-(.+)$/);
                    if (!match) continue;
                    const [, fid, tail] = match;
                    if (!byFeatureId.has(fid)) byFeatureId.set(fid, []);
                    byFeatureId.get(fid).push({ branch: br, tail });
                }

                for (const [fid, branches] of byFeatureId) {
                    for (const drive of branches) {
                        const siblings = branches.filter(candidate => {
                            if (candidate.branch === drive.branch) return false;
                            return candidate.tail.endsWith(`-${drive.tail}`);
                        });
                        if (siblings.length === 0) continue;
                        const issue = {
                            check: 'stale-drive-branch',
                            featureId: fid,
                            message: `Stale drive-style branch ${drive.branch} alongside worktree branch(es): ${siblings.map(s => s.branch).join(', ')}`,
                            safe: false,
                        };
                        issues.push(issue);
                        console.log(`  ⚠️  stale-drive-branch [feature-${fid}]: ${issue.message}`);
                        console.log(`     💡 Recovery (after confirming the worktree branch has the real implementation):`);
                        console.log(`        git branch -D ${drive.branch}`);
                        console.log(`     If the drive branch actually has commits you need, merge them into the worktree branch first.`);
                    }
                }
            } catch (_) { /* git unavailable or not a repo — skip */ }

            // Research stale implementing session check
            const researchInProgressDir = path.join(process.cwd(), 'docs', 'specs', 'research-topics', STAGE_FOLDERS.IN_PROGRESS);
            if (fs.existsSync(researchInProgressDir)) {
                try {
                    fs.readdirSync(researchInProgressDir)
                        .filter(f => /^research-\d+-.+\.md$/.test(f))
                        .forEach(file => {
                            const m = file.match(/^research-(\d+)-/);
                            if (!m) return;
                            const researchId = m[1];
                            const researchLogsDir = path.join(process.cwd(), 'docs', 'specs', 'research-topics', 'logs');
                            if (!fs.existsSync(researchLogsDir)) return;
                            const findings = fs.readdirSync(researchLogsDir)
                                .filter(f => f.startsWith(`research-${researchId}-`) && f.endsWith('-findings.md'));
                            findings.forEach(findingsFile => {
                                const fm = findingsFile.match(/^research-\d+-([a-z]{2})-findings\.md$/);
                                if (!fm) return;
                                const agent = fm[1];
                                const statusPath = path.join(stateDir, `feature-${researchId}-${agent}.json`);
                                let agentState = null;
                                try {
                                    if (fs.existsSync(statusPath)) {
                                        agentState = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
                                    }
                                } catch (_) { /* ignore */ }
                                const status = agentState && agentState.status ? agentState.status : 'implementing';
                                if (status !== 'implementing') return;
                                const flags = (agentState && agentState.flags && typeof agentState.flags === 'object') ? agentState.flags : {};
                                if (flags.sessionEnded) return;
                                const tmuxRunning = isAgentSessionRunning('research', researchId, agent);
                                if (tmuxRunning) return;
                                if (!hasResearchFindingsProgress(researchId, agent)) return;
                                const issue = {
                                    check: 'stale-implementing-session-ended',
                                    featureId: `research-${researchId}`,
                                    message: `Research agent ${agent} has implementing status but session is ended with findings progress`,
                                    safe: true,
                                };
                                issues.push(issue);
                                if (batchFix) {
                                    manifest.writeAgentStatus(researchId, agent, {
                                        status: 'implementing',
                                        flags: {
                                            ...flags,
                                            sessionEnded: true,
                                            sessionEndedAt: new Date().toISOString()
                                        }
                                    }, 'research');
                                    console.log(`  ✅ stale-implementing-session-ended [research-${researchId}-${agent}]: flagged sessionEnded`);
                                } else {
                                    console.log(`  ⚠️  stale-implementing-session-ended [research-${researchId}-${agent}]: ${issue.message}`);
                                }
                            });
                        });
                } catch (_) { /* ignore */ }
            }

            // Check for stale locks
            if (fs.existsSync(locksDir)) {
                try {
                    fs.readdirSync(locksDir)
                        .filter(f => f.endsWith('.lock'))
                        .forEach(lockFile => {
                            const lockFilePath = path.join(locksDir, lockFile);
                            try {
                                const content = fs.readFileSync(lockFilePath, 'utf8').trim();
                                const pid = parseInt(content, 10);
                                let alive = false;
                                if (!isNaN(pid)) {
                                    try { process.kill(pid, 0); alive = true; } catch (e) { alive = false; }
                                }
                                if (!alive) {
                                    const issue = {
                                        check: 'stale-lock',
                                        featureId: lockFile.replace('feature-', '').replace('.lock', ''),
                                        message: `Stale lock file (PID ${content} dead): ${lockFile}`,
                                        safe: true,
                                    };
                                    issues.push(issue);
                                    if (batchFix) {
                                        fs.unlinkSync(lockFilePath);
                                        console.log(`  ✅ stale-lock: removed ${lockFile}`);
                                    } else {
                                        console.log(`  ⚠️  stale-lock: ${issue.message}`);
                                    }
                                }
                            } catch (e) { /* ignore */ }
                        });
                } catch (e) { /* ignore */ }
            }

            // Log migration: flatten logs/selected/ and logs/alternatives/ back to logs/
            const logsRoot = path.join(specsRoot, 'logs');
            const selectedDir = path.join(logsRoot, 'selected');
            const alternativesDir = path.join(logsRoot, 'alternatives');
            let migratedCount = 0;
            [selectedDir, alternativesDir].forEach(subdir => {
                if (!fs.existsSync(subdir)) return;
                try {
                    const files = fs.readdirSync(subdir).filter(f => f.endsWith('.md'));
                    if (files.length > 0) {
                        if (batchFix) {
                            files.forEach(f => {
                                const src = path.join(subdir, f);
                                const dest = path.join(logsRoot, f);
                                if (!fs.existsSync(dest)) {
                                    fs.renameSync(src, dest);
                                    migratedCount++;
                                }
                            });
                            // Remove empty subdir
                            const remaining = fs.readdirSync(subdir);
                            if (remaining.length === 0) fs.rmdirSync(subdir);
                        } else {
                            console.log(`  ⚠️  log-migration: ${files.length} file(s) in ${path.basename(subdir)}/ need flattening`);
                            issues.push({
                                check: 'log-migration',
                                featureId: '-',
                                message: `${files.length} log file(s) in ${path.basename(subdir)}/`,
                                safe: true,
                            });
                        }
                    }
                } catch (e) { /* ignore */ }
            });
            if (batchFix && migratedCount > 0) {
                console.log(`  ✅ log-migration: moved ${migratedCount} log file(s) to flat logs/`);
                // Auto-commit the log migration (tracked files moved)
                try {
                    execSync('git add docs/specs/features/logs/ && git commit -m "chore: flatten log directory structure (aigon doctor migration)"', {
                        cwd: process.cwd(),
                        stdio: 'pipe',
                    });
                    console.log(`  📝 Committed log migration`);
                } catch (e) {
                    // May fail if nothing staged (already committed) or not a git repo
                    if (e.stderr && /nothing to commit/.test(e.stderr.toString())) {
                        // Already clean — no-op
                    } else {
                        console.log(`  ⚠️  Could not auto-commit log migration — run: git add docs/specs/features/logs/ && git commit -m "chore: flatten log directory structure"`);
                    }
                }
            }

            // Check: research folder renumbering migration (04-done → 05-done, 05-paused → 06-paused)
            const researchRoot = path.join(process.cwd(), 'docs', 'specs', 'research-topics');
            const oldResearchDone = path.join(researchRoot, ['04', 'done'].join('-'));
            const newResearchDone = path.join(researchRoot, STAGE_FOLDERS.DONE);
            const oldResearchPaused = path.join(researchRoot, ['05', 'paused'].join('-'));
            const newResearchPaused = path.join(researchRoot, STAGE_FOLDERS.PAUSED);
            const newResearchEval = path.join(researchRoot, STAGE_FOLDERS.IN_EVALUATION);

            // Detect old numbering: 04-done exists but 05-done doesn't
            if (fs.existsSync(oldResearchDone) && !fs.existsSync(newResearchDone) && !fs.existsSync(newResearchEval)) {
                const issue = {
                    check: 'research-folder-renumber',
                    message: 'Research folders use old numbering (04-done, 05-paused). Needs migration to 04-in-evaluation, 05-done, 06-paused.',
                    safe: true,
                };
                issues.push(issue);
                if (batchFix) {
                    // Create new evaluation folder
                    fs.mkdirSync(newResearchEval, { recursive: true });
                    // Rename 05-paused → 06-paused first (if exists), then 04-done → 05-done
                    if (fs.existsSync(oldResearchPaused)) {
                        fs.renameSync(oldResearchPaused, newResearchPaused);
                        console.log(`  ✅ research-folder-renumber: 05-paused → 06-paused`);
                    }
                    fs.renameSync(oldResearchDone, newResearchDone);
                    console.log(`  ✅ research-folder-renumber: 04-done → 05-done`);
                    console.log(`  ✅ research-folder-renumber: created 04-in-evaluation`);
                } else {
                    console.log(`  ⚠️  research-folder-renumber: ${issue.message}`);
                }
            } else {
                // Ensure new folders exist even if no migration needed
                if (fs.existsSync(researchRoot)) {
                    if (!fs.existsSync(newResearchEval)) fs.mkdirSync(newResearchEval, { recursive: true });
                    if (!fs.existsSync(newResearchPaused)) fs.mkdirSync(newResearchPaused, { recursive: true });
                }
            }

            // Feature 341: check spec-level `agent:` frontmatter validity.
            console.log('\n🔍 Spec frontmatter agent field...');
            const availableForAgentCheck = getAvailableAgentsFn();
            const invalidAgentSpecs = findSpecsWithInvalidAgentField(process.cwd(), availableForAgentCheck);
            if (invalidAgentSpecs.length === 0) {
                console.log('  ✅ All specs have valid agent: frontmatter');
            } else if (batchFix) {
                let repaired = 0;
                for (const s of invalidAgentSpecs) {
                    if (repairInvalidAgentField(s.specPath)) repaired += 1;
                }
                console.log(`  🔧 Stripped invalid agent: line from ${repaired} spec(s)`);
            } else {
                for (const s of invalidAgentSpecs) {
                    issues.push({
                        check: 'invalid-spec-agent-field',
                        featureId: '-',
                        message: `${path.relative(process.cwd(), s.specPath)}: ${s.reason}`,
                        safe: true,
                    });
                    console.log(`  ⚠️  invalid-spec-agent-field: ${path.relative(process.cwd(), s.specPath)} — ${s.reason}`);
                }
            }

            // Check: pending schema migrations (must run before workflow bootstrap so shape
            // is correct by the time bootstrap creates new snapshots)
            console.log('\n🔍 Schema migrations...');
            {
                const { runPendingMigrations, _internals: migInternals } = require('../../migration');
                const repoPathForMig = process.cwd();
                if (migInternals.migrations.size === 0) {
                    console.log('  ✅ No migrations registered');
                } else {
                    const pendingVersions = [...migInternals.migrations.values()]
                        .filter(({ version }) => {
                            const m = migInternals.readManifest(repoPathForMig, version);
                            return !m || m.status !== 'success';
                        })
                        .map(({ version }) => version);
                    if (pendingVersions.length === 0) {
                        console.log('  ✅ All migrations applied');
                    } else {
                        const migMessage = `${pendingVersions.length} pending migration(s): ${pendingVersions.join(', ')}`;
                        issues.push({
                            check: 'pending-migrations',
                            featureId: '-',
                            message: `${migMessage} (run \`aigon doctor --fix\` to apply)`,
                            safe: true,
                        });
                        console.log(`  ⚠️  ${migMessage} (run \`aigon doctor --fix\` to apply)`);
                        queueFix({
                            section: 'state-reconciliation',
                            message: migMessage,
                            label: 'run pending migrations',
                            command: 'aigon doctor --fix',
                            apply: async () => {
                                const results = await runPendingMigrations(repoPathForMig);
                                const applied = results.filter(r => r.status === 'success');
                                const failed = results.filter(r => r.status === 'restored' || r.status === 'failed');
                                if (failed.length > 0) {
                                    for (const r of failed) {
                                        const manifestPath = path.join(repoPathForMig, '.aigon', 'migrations', r.version, 'manifest.json');
                                        console.log(`  ❌ Migration ${r.version}: failed — check ${manifestPath}`);
                                    }
                                } else if (applied.length > 0) {
                                    console.log(`  ✅ Applied ${applied.length} migration(s)`);
                                }
                            },
                        });
                    }
                }
            }

            // F574: legacy feedback → research migration notice
            {
                const { hasUnmigratedFeedback, countFeedbackFiles } = require('../../feedback-migrate');
                const repoPathForFb = process.cwd();
                const feedbackCount = countFeedbackFiles(repoPathForFb);
                if (feedbackCount > 0 && hasUnmigratedFeedback(repoPathForFb)) {
                    const fbMessage = `${feedbackCount} legacy feedback file(s) can be migrated to research (origin: customer-feedback)`;
                    issues.push({
                        check: 'legacy-feedback-unmigrated',
                        featureId: '-',
                        message: `${fbMessage} — run \`aigon feedback-migrate\` or \`aigon doctor --fix\``,
                        safe: true,
                    });
                    console.log(`  ⚠️  legacy-feedback: ${fbMessage}`);
                    console.log('     💡 Run `aigon feedback-migrate` or `aigon doctor --fix` to convert without duplicating specs.');
                    queueFix({
                        section: 'state-reconciliation',
                        message: fbMessage,
                        label: 'migrate feedback to research',
                        command: 'aigon feedback-migrate',
                        apply: () => {
                            const { migrateFeedbackToResearch } = require('../../feedback-migrate');
                            const result = migrateFeedbackToResearch(repoPathForFb, {
                                log: (msg) => console.log(`     ${msg}`),
                            });
                            console.log(`  ✅ legacy-feedback: migrated ${result.migrated}, skipped ${result.skipped}`);
                        },
                    });
                } else if (feedbackCount > 0) {
                    console.log(`  ℹ️  legacy-feedback: ${feedbackCount} feedback file(s) present (already migrated)`);
                }
            }

            // Check: install manifest health
            console.log('\n🔍 Install manifest...');
            {
                const doctorRepoRoot = process.cwd();
                let doctorManifest = null;
                let manifestReadError = null;
                try {
                    doctorManifest = installManifestLib.readManifest(doctorRepoRoot);
                } catch (e) {
                    manifestReadError = e.message;
                }
                if (manifestReadError) {
                    issues.push({ check: 'install-manifest-corrupt', featureId: '-', message: manifestReadError, safe: true });
                    console.log(`  ⚠️  install-manifest-corrupt: ${manifestReadError}`);
                    queueFix({
                        section: 'state-reconciliation',
                        message: 'Install manifest is corrupted (invalid JSON)',
                        label: 'back up corrupt manifest and regenerate',
                        command: 'aigon doctor --fix',
                        apply: async () => {
                            const recovery = installManifestLib.readManifestRecovering(doctorRepoRoot);
                            if (recovery.recovered) {
                                console.log(`  🔧 Backed up corrupt manifest to ${path.relative(doctorRepoRoot, recovery.backupPath)}`);
                            }
                            // Synthesize directly from disk rather than via
                            // runPendingMigrations: migration 2.61.0 is
                            // idempotent per-repo and no-ops once it has
                            // already succeeded here, which would silently
                            // fail to regenerate a manifest deleted/corrupted
                            // after that first run.
                            const aigonVersion = getAigonVersion() || 'unknown';
                            const rebuilt = installManifestLib.synthesizeManifestFromDisk(doctorRepoRoot, aigonVersion);
                            installManifestLib.writeManifest(doctorRepoRoot, rebuilt);
                            console.log(`  🔧 Install manifest regenerated (${rebuilt.files.length} files tracked)`);
                        },
                    });
                } else if (!doctorManifest) {
                    issues.push({ check: 'install-manifest-missing', featureId: '-', message: 'No install manifest found — run `aigon doctor --fix` to initialize', safe: true });
                    console.log('  ⚠️  install-manifest-missing: .aigon/install-manifest.json not found (run `aigon doctor --fix` to initialize)');
                    queueFix({
                        section: 'state-reconciliation',
                        message: 'Install manifest missing',
                        label: 'initialize install manifest',
                        command: 'aigon doctor --fix',
                        apply: async () => {
                            const aigonVersion = getAigonVersion() || 'unknown';
                            const rebuilt = installManifestLib.synthesizeManifestFromDisk(doctorRepoRoot, aigonVersion);
                            if (rebuilt.files.length === 0) {
                                console.log('  ⚠️  No aigon-owned files found on disk — nothing to initialize');
                                return;
                            }
                            installManifestLib.writeManifest(doctorRepoRoot, rebuilt);
                            console.log(`  🔧 Install manifest initialized (${rebuilt.files.length} files tracked)`);
                        },
                    });
                } else {
                    const missingFiles = installManifestLib.getMissingFiles(doctorManifest, doctorRepoRoot);
                    const modifiedFiles = installManifestLib.getModifiedFiles(doctorManifest, doctorRepoRoot);

                    // Untracked aigon-pattern files: files in aigon-owned directories not in manifest
                    const tracked = new Set((doctorManifest.files || []).map(f => f.path));
                    const untrackedFiles = [];
                    const AIGON_DIRS = [
                        path.join(doctorRepoRoot, '.aigon', 'docs'),
                        path.join(doctorRepoRoot, '.claude', 'commands', 'aigon'),
                        path.join(doctorRepoRoot, '.claude', 'skills'),
                        path.join(doctorRepoRoot, '.cursor', 'rules'),
                        path.join(doctorRepoRoot, '.codex', 'skills'),
                        path.join(doctorRepoRoot, '.gemini'),
                        path.join(doctorRepoRoot, '.agents'),
                    ];
                    function scanForUntracked(dir) {
                        if (!fs.existsSync(dir)) return;
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            const abs = path.join(dir, entry.name);
                            if (entry.isFile()) {
                                const rel = path.relative(doctorRepoRoot, abs).replace(/\\/g, '/');
                                if (!tracked.has(rel)) untrackedFiles.push(rel);
                            } else if (entry.isDirectory()) {
                                scanForUntracked(abs);
                            }
                        }
                    }
                    AIGON_DIRS.forEach(scanForUntracked);

                    if (missingFiles.length === 0 && modifiedFiles.length === 0 && untrackedFiles.length === 0) {
                        console.log(`  ✅ Install manifest healthy (${(doctorManifest.files || []).length} files tracked)`);
                    } else {
                        if (missingFiles.length > 0) {
                            issues.push({ check: 'install-manifest-missing-files', featureId: '-', message: `${missingFiles.length} manifest file(s) missing from disk`, safe: false });
                            console.log(`  ⚠️  install-manifest-missing-files: ${missingFiles.length} file(s) in manifest but not on disk`);
                            missingFiles.forEach(f => console.log(`      - ${f.path}`));
                        }
                        if (modifiedFiles.length > 0) {
                            issues.push({ check: 'install-manifest-modified', featureId: '-', message: `${modifiedFiles.length} aigon-managed file(s) modified outside install`, safe: false });
                            console.log(`  ⚠️  install-manifest-modified: ${modifiedFiles.length} file(s) differ from manifest sha256`);
                            modifiedFiles.forEach(m => console.log(`      - ${m.path}`));
                        }
                        if (untrackedFiles.length > 0) {
                            console.log(`  ℹ️  install-manifest-untracked: ${untrackedFiles.length} file(s) in aigon dirs but not in manifest (may be user-added)`);
                            untrackedFiles.forEach(f => console.log(`      - ${f}`));
                        }
                    }
                }
            }

            // Check: partial bootstrap (.aigon/ exists but spec folder structure missing)
            {
                const doctorCwd = process.cwd();
                const aigonExists = fs.existsSync(path.join(doctorCwd, '.aigon'));
                const specsInboxExists = fs.existsSync(path.join(doctorCwd, 'docs', 'specs', 'features', STAGE_FOLDERS.INBOX));
                if (aigonExists && !specsInboxExists) {
                    issues.push({ check: 'partial-bootstrap', featureId: '-', message: '.aigon/ exists but spec folder structure is missing — run `aigon apply` to complete setup', safe: false });
                    console.log('  ⚠️  partial-bootstrap: .aigon/ exists but docs/specs/ structure is missing');
                    console.log('       Run `aigon apply` to complete setup. (`doctor --fix` does not auto-run apply.)');
                }

                // Check: install-manifest references files that no longer exist on disk
                // (already handled above under install-manifest-missing-files, no duplicate needed)
            }

            // Check: missing workflow-core snapshots
            console.log('\n🔍 Workflow state...');
            const missing = findEntitiesMissingWorkflowState(process.cwd());
            const totalMissing = missing.features.length + missing.research.length;
            if (totalMissing === 0) {
                console.log('  ✅ All features and research have workflow state');
            } else {
                const parts = [];
                if (missing.features.length > 0) parts.push(`${missing.features.length} feature(s)`);
                if (missing.research.length > 0) parts.push(`${missing.research.length} research topic(s)`);
                const issue = {
                    check: 'missing-workflow-state',
                    featureId: '-',
                    message: `${parts.join(' and ')} missing workflow state`,
                    safe: true,
                };
                issues.push(issue);
                console.log(`  ⚠️  ${parts.join(' and ')} missing workflow state (run \`aigon doctor --fix\` to bootstrap)`);
                queueFix({
                    section: 'state-reconciliation',
                    message: issue.message,
                    label: 'bootstrap workflow snapshots',
                    command: 'aigon doctor --fix',
                    apply: () => {
                        bootstrapMissingWorkflowSnapshots(process.cwd(), missing.features, 'feature');
                        bootstrapMissingWorkflowSnapshots(process.cwd(), missing.research, 'research');
                        console.log(`  🔧 Bootstrapped workflow state for ${parts.join(' and ')}`);
                    },
                });
            }

            // Check: slug-only specs outside inbox (definitionally invalid)
            {
                const featuresRoot = path.join(process.cwd(), 'docs', 'specs', 'features');
                const researchRoot = path.join(process.cwd(), 'docs', 'specs', 'research-topics');
                // 05-done and 06-paused slug-only specs are legitimate: pre-ID historical artifacts or
                // intentionally paused before being prioritised. Leave them in place.
                const NON_INBOX_FOLDERS = [STAGE_FOLDERS.BACKLOG, STAGE_FOLDERS.IN_PROGRESS, STAGE_FOLDERS.IN_EVALUATION];
                const misplacedSlugs = [];
                for (const [root, prefix] of [[featuresRoot, 'feature'], [researchRoot, 'research']]) {
                    for (const folder of NON_INBOX_FOLDERS) {
                        const dir = path.join(root, folder);
                        if (!fs.existsSync(dir)) continue;
                        for (const file of fs.readdirSync(dir)) {
                            if (!file.endsWith('.md')) continue;
                            if (!file.startsWith(`${prefix}-`)) continue;
                            const hasId = new RegExp(`^${prefix}-\\d+-`).test(file);
                            if (!hasId) misplacedSlugs.push({ file, folder, dir, prefix });
                        }
                    }
                }
                if (misplacedSlugs.length === 0) {
                    console.log('  ✅ No slug-only specs outside inbox');
                } else {
                    for (const { file, folder, dir, prefix } of misplacedSlugs) {
                        const inboxDir = path.join(path.dirname(dir), STAGE_FOLDERS.INBOX);
                        if (batchFix) {
                            fs.mkdirSync(inboxDir, { recursive: true });
                            fs.renameSync(path.join(dir, file), path.join(inboxDir, file));
                            console.log(`  🔧 Moved misplaced slug-only spec: ${folder}/${file} → 01-inbox/${file}`);
                        } else {
                            issues.push({ check: 'misplaced-slug-spec', featureId: file, message: `Slug-only spec in ${folder}/ (should be in 01-inbox): ${file}`, safe: true });
                            console.log(`  ⚠️  misplaced-slug-spec: ${folder}/${file} belongs in 01-inbox (run \`aigon doctor --fix\` to move)`);
                        }
                    }
                }
            }

            // F501: rewrite legacy `lifecycle: submitted` snapshots → `ready`.
            // Same write path catches `currentSpecState: submitted` too. Closed
            // features (e.g. f495 incident) hold stale `submitted` because no
            // new events trigger re-projection; rewrite the on-disk snapshot
            // so `feature-close` and the dashboard see the new value directly.
            {
                const workflowsRoot = path.join(process.cwd(), '.aigon', 'workflows');
                const rewritten = [];
                for (const kind of ['features', 'research']) {
                    const kindRoot = path.join(workflowsRoot, kind);
                    if (!fs.existsSync(kindRoot)) continue;
                    for (const id of fs.readdirSync(kindRoot)) {
                        const snapPath = path.join(kindRoot, id, 'snapshot.json');
                        if (!fs.existsSync(snapPath)) continue;
                        let snap;
                        try { snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')); } catch (_) { continue; }
                        if (!snap || typeof snap !== 'object') continue;
                        const wasSubmitted = snap.lifecycle === 'submitted' || snap.currentSpecState === 'submitted';
                        if (!wasSubmitted) continue;
                        if (batchFix) {
                            if (snap.lifecycle === 'submitted') snap.lifecycle = 'ready';
                            if (snap.currentSpecState === 'submitted') snap.currentSpecState = 'ready';
                            fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2) + '\n');
                            rewritten.push({ kind, id });
                        } else {
                            issues.push({ check: 'legacy-submitted-lifecycle', featureId: id, message: `${kind === 'features' ? 'feature' : 'research'} ${id} snapshot has legacy lifecycle=submitted; rewrite to ready`, safe: true });
                        }
                    }
                }
                if (batchFix && rewritten.length > 0) {
                    for (const r of rewritten) {
                        console.log(`  🔧 legacy-submitted-lifecycle: rewrote ${r.kind}/${r.id} snapshot lifecycle submitted → ready`);
                    }
                }
            }

            // Check: spec folder vs workflow snapshot state mismatch
            {
                const featuresRoot = path.join(process.cwd(), 'docs', 'specs', 'features');
                const researchRoot = path.join(process.cwd(), 'docs', 'specs', 'research-topics');
                const workflowSnapshotAdapterLocal = require('../../workflow-snapshot-adapter');
                const drifted = [];
                for (const [root, prefix, lifecycleMap, entityType] of [
                    [featuresRoot, 'feature', LIFECYCLE_TO_FEATURE_DIR, 'feature'],
                    [researchRoot, 'research', LIFECYCLE_TO_RESEARCH_DIR, 'research'],
                ]) {
                    const allFolders = [STAGE_FOLDERS.INBOX, STAGE_FOLDERS.BACKLOG, STAGE_FOLDERS.IN_PROGRESS, STAGE_FOLDERS.IN_EVALUATION, STAGE_FOLDERS.DONE, STAGE_FOLDERS.PAUSED];
                    for (const folder of allFolders) {
                        const dir = path.join(root, folder);
                        if (!fs.existsSync(dir)) continue;
                        for (const file of fs.readdirSync(dir)) {
                            if (!file.endsWith('.md')) continue;
                            const idMatch = file.match(new RegExp(`^${prefix}-(\\d+)-`));
                            if (!idMatch) continue;
                            const id = String(parseInt(idMatch[1], 10)).padStart(2, '0');
                            let snapshot;
                            try {
                                snapshot = entityType === 'feature'
                                    ? workflowSnapshotAdapterLocal.readFeatureSnapshotSync(process.cwd(), id)
                                    : workflowSnapshotAdapterLocal.readWorkflowSnapshotSync(process.cwd(), 'research', id);
                            } catch (_) { continue; }
                            if (!snapshot) continue;
                            const state = snapshot.currentSpecState || snapshot.lifecycle;
                            if (!state) continue;
                            const expectedFolder = lifecycleMap[state];
                            if (expectedFolder && expectedFolder !== folder) {
                                drifted.push({ file, id, folder, expectedFolder, entityType });
                            }
                        }
                    }
                }
                if (drifted.length === 0) {
                    console.log('  ✅ All spec folders match workflow state');
                } else {
                    for (const { file, id, folder, expectedFolder, entityType } of drifted) {
                        const root = entityType === 'feature'
                            ? path.join(process.cwd(), 'docs', 'specs', 'features')
                            : path.join(process.cwd(), 'docs', 'specs', 'research-topics');
                        if (batchFix) {
                            const from = path.join(root, folder, file);
                            const toDir = path.join(root, expectedFolder);
                            fs.mkdirSync(toDir, { recursive: true });
                            fs.renameSync(from, path.join(toDir, file));
                            console.log(`  🔧 Moved drifted spec: ${folder}/${file} → ${expectedFolder}/${file}`);
                        } else {
                            issues.push({ check: 'spec-folder-drift', featureId: id, message: `${entityType} ${id} spec is in ${folder}/ but workflow state says ${expectedFolder}/`, safe: true });
                            console.log(`  ⚠️  spec-folder-drift [${entityType} ${id}]: in ${folder}/ but state says ${expectedFolder}/ (run \`aigon doctor --fix\` to correct)`);
                        }
                    }
                }
            }

            // Worktree directory checks
            const repoNameForWt = path.basename(process.cwd());
            const newWtBase = path.join(os.homedir(), '.aigon', 'worktrees', repoNameForWt);
            const legacyWtBase = path.resolve(process.cwd(), '..', `${repoNameForWt}-worktrees`);

            // Check: worktree directory exists
            if (!fs.existsSync(newWtBase)) {
                const wtIssue = {
                    check: 'worktree-dir-missing',
                    featureId: '-',
                    message: `Worktree directory missing: ${newWtBase}`,
                    safe: true,
                };
                issues.push(wtIssue);
                if (batchFix) {
                    fs.mkdirSync(newWtBase, { recursive: true });
                    console.log(`  ✅ worktree-dir-missing: created ${newWtBase}`);
                } else {
                    console.log(`  ⚠️  worktree-dir-missing: ${wtIssue.message}`);
                }
            }

            // Check: legacy worktrees need migration
            if (fs.existsSync(legacyWtBase)) {
                try {
                    const legacyEntries = fs.readdirSync(legacyWtBase)
                        .filter(name => /^(feature|research)-\d+-[a-z]{2}-.+$/.test(name));
                    if (legacyEntries.length > 0) {
                        const wtIssue = {
                            check: 'legacy-worktree-location',
                            featureId: '-',
                            message: `${legacyEntries.length} worktree(s) in legacy location: ${legacyWtBase}`,
                            safe: false,
                        };
                        issues.push(wtIssue);
                        console.log(`  ⚠️  legacy-worktree-location: ${wtIssue.message}`);
                        console.log(`      New worktrees will be created under: ${newWtBase}`);
                    }
                } catch (_) { /* ignore */ }
            }

            // Check: prune worktrees for completed features (--fix only)
            if (batchFix && fs.existsSync(newWtBase)) {
                try {
                    const wtEntries = fs.readdirSync(newWtBase)
                        .filter(name => /^feature-(\d+)-[a-z]{2}-.+$/.test(name));
                    wtEntries.forEach(name => {
                        const m = name.match(/^feature-(\d+)-/);
                        if (!m) return;
                        const featureId = m[1];
                        const doneDir = path.join(process.cwd(), 'docs', 'specs', 'features', STAGE_FOLDERS.DONE);
                        if (!fs.existsSync(doneDir)) return;
                        const isDone = fs.readdirSync(doneDir).some(f =>
                            f.startsWith(`feature-${featureId}-`) || f.startsWith(`feature-${String(parseInt(featureId, 10))}-`)
                        );
                        if (isDone) {
                            const wtPath = path.join(newWtBase, name);
                            console.log(`  🧹 Pruning worktree for done feature: ${name}`);
                            try {
                                execSync(`git worktree remove --force ${JSON.stringify(wtPath)}`, {
                                    cwd: process.cwd(), stdio: 'pipe'
                                });
                            } catch (_) {
                                try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch (_) { /* ignore */ }
                            }
                        }
                    });
                } catch (_) { /* ignore */ }
            }

            // Profile sync notice moved to @aigon/pro with feature 236. When
            // Pro is installed and unconfigured, nudge the user; otherwise no
            // notice (profile sync is now Pro-only).
            try {
                const { isProAvailable, getPro } = require('../../pro');
                if (isProAvailable() && getPro() && getPro().profile && typeof getPro().profile.getProfileRemote === 'function') {
                    if (!getPro().profile.getProfileRemote()) {
                        console.log('');
                        console.log('ℹ️  Profile sync is not configured.');
                        console.log('   Run: aigon profile configure <git-remote-url>');
                        console.log('   Syncs ~/.aigon/ (agent definitions, named workflows) between machines.');
                        report.issue({
                            section: 'profile-sync',
                            sectionTitle: 'Profile Sync',
                            check: 'profile-sync-not-configured',
                            message: 'Profile sync not configured',
                            fix: { label: 'configure profile sync', command: 'aigon profile configure <git-remote-url>', autoFixable: false },
                        });
                    }
                }
            } catch (_) { /* ignore — profile sync notice is best-effort */ }

            // Summary
            console.log('');
            if (issues.length === 0) {
                console.log('No state issues found.');
            } else {
                const safeCount = issues.filter(i => i.safe).length;
                const unsafeCount = issues.filter(i => !i.safe).length;
                if (batchFix) {
                    const fixedCount = issues.filter(i => i.safe).length;
                    console.log(`Fixed ${fixedCount} issue(s).` + (unsafeCount > 0 ? ` ${unsafeCount} issue(s) require manual attention.` : ''));
                } else {
                    console.log(`${issues.length} issue(s) found` + (safeCount > 0 ? ` (${safeCount} auto-fixable with --fix)` : '') + '.');
                }
            }
            for (const it of issues) {
                const [sec, title] = ROUTE_SECTION(it.check);
                report.fromLegacy(it, sec, title);
            }
            }); // end State Reconciliation withSection

            // Triage digest
            report.render();

            if (deferFix && fixQueue.length > 0) {
                const fixResult = await runFixDispatch(fixQueue, { yes: false });
                const manualCount = report.issues.filter(i => i.fix && !i.fix.autoFixable).length;
                printFixSummary(fixResult, manualCount);
                printManualIssues(report.issues);
            } else if (batchFix && fixQueue.length > 0) {
                const fixResult = await runFixDispatch(fixQueue, { yes: true });
                const manualCount = report.issues.filter(i => i.fix && !i.fix.autoFixable).length;
                printFixSummary(fixResult, manualCount);
                if (manualCount > 0) printManualIssues(report.issues);
            } else if (doFix) {
                printManualIssues(report.issues);
            }

            // Exit code reflects worst severity. Per spec Open Questions
            // default: non-zero only for `blocking`.
            const worst = report.worstSeverity();
            if (worst === 'blocking') {
                process.exitCode = 1;
            }
    };
};
