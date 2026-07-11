'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const agentRegistry = require('../../agent-registry');
const { rebuildSeedFeatureManifests } = require('./seed-reset');
const { listExistingAigonWorktrees } = require('./worktree-cleanup');
const { ensureEnvLocalGitignore, ensurePreCommitHook } = require('./gitignore-and-hooks');
const {
    findEntitiesMissingWorkflowState,
    bootstrapMissingWorkflowSnapshots,
} = require('./agent-trust');

function runInitBootstrap(ctx) {
    const u = ctx.utils;
    const { PATHS, SPECS_ROOT } = u;
    const { ensureBoardMapInGitignore } = ctx.board;

    console.log('ACTION: Initializing Aigon in ./docs/specs ...');
    const createDirs = (root, folders) => {
        folders.forEach(f => {
            const p = path.join(root, f);
            if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
            const gitkeepPath = path.join(p, '.gitkeep');
            if (!fs.existsSync(gitkeepPath)) {
                fs.writeFileSync(gitkeepPath, '');
            }
        });
    };
    createDirs(PATHS.research.root, PATHS.research.folders);
    createDirs(PATHS.features.root, PATHS.features.folders);
    createDirs(PATHS.feedback.root, PATHS.feedback.folders);
    const featLogs = path.join(PATHS.features.root, 'logs');
    if (!fs.existsSync(path.join(featLogs, 'selected'))) fs.mkdirSync(path.join(featLogs, 'selected'), { recursive: true });
    if (!fs.existsSync(path.join(featLogs, 'alternatives'))) fs.mkdirSync(path.join(featLogs, 'alternatives'), { recursive: true });
    if (!fs.existsSync(path.join(PATHS.features.root, 'evaluations'))) fs.mkdirSync(path.join(PATHS.features.root, 'evaluations'), { recursive: true });
    [path.join(featLogs, 'selected'), path.join(featLogs, 'alternatives'), path.join(PATHS.features.root, 'evaluations')].forEach(p => {
        const gitkeepPath = path.join(p, '.gitkeep');
        if (!fs.existsSync(gitkeepPath)) fs.writeFileSync(gitkeepPath, '');
    });
    const readmePath = path.join(SPECS_ROOT, 'README.md');
    if (!fs.existsSync(readmePath)) {
        const readmeContent = '# Aigon Specs\n\n**This folder is the Single Source of Truth.**\n\n## Rules\n1. READ ONLY: backlog, inbox, done.\n2. WRITE: Only edit code if feature spec is in features/in-progress.\n';
        fs.writeFileSync(readmePath, readmeContent);
    }

    ensureBoardMapInGitignore();
    ensureEnvLocalGitignore();
    ensurePreCommitHook();

    console.log('✅ ./docs/specs directory structure created.');

    // New repos default to the stable spec layout (canonical `00-specs`); repos
    // that already hold legacy stage-folder specs are left on legacy to migrate
    // deliberately. No-op once `specLayout` is recorded, so this is safe on
    // every `aigon apply`. See F666–F670 / docs/specstore-architecture.md.
    try {
        const specLayout = require('../../spec-layout');
        const layout = specLayout.defaultLayoutForNewRepo(process.cwd());
        if (layout.applied) {
            for (const entityType of ['feature', 'research']) {
                const dir = specLayout.getCanonicalSpecDirForEntity(process.cwd(), entityType);
                const gitkeep = path.join(dir, '.gitkeep');
                if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
            }
            console.log('   ✓ New repo — defaulting to stable spec layout (canonical docs/specs/*/00-specs)');
        }
    } catch (_) { /* non-fatal: falls back to legacy default */ }

    try {
        const manifests = rebuildSeedFeatureManifests(process.cwd());
        if (manifests.length > 0) {
            console.log(`   ✓ Rebuilt ${manifests.length} manifest(s) for existing features`);
        }
        const { features: missingF, research: missingR } = findEntitiesMissingWorkflowState(process.cwd());
        const bootstrapped = bootstrapMissingWorkflowSnapshots(process.cwd(), missingF, 'feature')
            + bootstrapMissingWorkflowSnapshots(process.cwd(), missingR, 'research');
        if (bootstrapped > 0) {
            console.log(`   ✓ Bootstrapped workflow state for ${bootstrapped} entit${bootstrapped === 1 ? 'y' : 'ies'}`);
        }
    } catch (_) { /* non-fatal */ }

    const initProfile = u.getActiveProfile();
    if (initProfile.devServer.enabled) {
        const allocatedPort = u.allocateBasePort(process.cwd());
        console.log(`\n📋 Port ${allocatedPort} allocated (block of ${u.PORT_BLOCK_SIZE})`);
    }
    u.showPortSummary();

    if (initProfile.name === 'web' || initProfile.name === 'api') {
        const hasEslint = fs.existsSync(path.join(process.cwd(), '.eslintrc.json'))
            || fs.existsSync(path.join(process.cwd(), '.eslintrc.js'))
            || fs.existsSync(path.join(process.cwd(), '.eslintrc.cjs'))
            || fs.existsSync(path.join(process.cwd(), '.eslintrc.yml'))
            || fs.existsSync(path.join(process.cwd(), 'eslint.config.js'))
            || fs.existsSync(path.join(process.cwd(), 'eslint.config.mjs'))
            || fs.existsSync(path.join(process.cwd(), 'eslint.config.cjs'))
            || fs.existsSync(path.join(process.cwd(), 'eslint.config.ts'));
        if (hasEslint) {
            console.log('\n💡 Tip: Install eslint-plugin-security for OWASP pattern detection in your ESLint config:');
            console.log('   npm install --save-dev eslint-plugin-security');
        }
    }

    const repoName = path.basename(process.cwd());
    const wtBase = path.join(os.homedir(), '.aigon', 'worktrees', repoName);
    fs.mkdirSync(wtBase, { recursive: true });
    try {
        const installedAgents = u.getAvailableAgents().filter(agentId => {
            try {
                return u.loadAgentConfig(agentId) !== null;
            } catch (_) { return false; }
        });
        const existingWorktrees = listExistingAigonWorktrees(process.cwd());
        installedAgents.forEach(agentId => {
            const trustTargets = agentRegistry.getTrustInstallScope(agentId) === 'all-existing-worktrees'
                ? existingWorktrees
                : [wtBase];
            try { agentRegistry.ensureAgentTrust(agentId, trustTargets); } catch (_) { /* best-effort */ }
        });
    } catch (_) { /* agent trust is best-effort */ }
    console.log(`\n📂 Worktrees: ${wtBase}`);
}

function printFirstTimeNextStepHint() {
    try {
        const binMap = agentRegistry.getAgentBinMap();
        const onPath = Object.entries(binMap)
            .filter(([, bin]) => {
                try { execSync(`which ${bin}`, { stdio: 'pipe' }); return true; } catch { return false; }
            })
            .map(([id]) => id);
        if (onPath.length > 0) {
            console.log(`\nNext: aigon install-agent ${onPath.join(' ')}`);
        } else {
            console.log('\nNext: aigon install-agent <agent-id>  (e.g. cc, ag, cx, cu)');
        }
    } catch (_) {
        console.log('\nNext: aigon install-agent <agent-id>  (e.g. cc, ag, cx, cu)');
    }
}

module.exports = { runInitBootstrap, printFirstTimeNextStepHint };
