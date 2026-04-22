'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const agentRegistry = require('./agent-registry');
const wf = require('./workflow-core');
const { readAgentStatus } = require('./agent-status');
const { resolveAgentPromptBody } = require('./agent-prompt-resolver');
const { parseCliOptions, getOptionValue } = require('./cli-parse');
const { getDefaultAgent } = require('./config');

async function run(args, deps) {
    const {
        ctx,
        persistAndRunEffects,
        collectIncompleteFeatureEvalAgents,
    } = deps;

    const u = ctx.utils;
    const sc = ctx.specCrud;
    const { findFile, moveFile } = sc;
    const {
        PATHS,
        PROVIDER_FAMILIES,
        AGENT_CONFIGS,
        filterByFeatureId,
        findWorktrees,
        detectActiveAgentSession,
        buildAgentAliasMap,
        getAvailableAgents,
        getAgentCliConfig,
        getAgentLaunchFlagTokens,
        loadAgentConfig,
        isSameProviderFamily,
    } = u;
    const { getCurrentBranch } = ctx.git;

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
        let resolvedAgent = getDefaultAgent(process.cwd());

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
        const evalFlagSuffix = [
            allowSameModel ? '--allow-same-model-judge' : '',
            forceEval ? '--force' : '',
        ].filter(Boolean).join(' ');
        const prompt = resolveAgentPromptBody({
            agentId: resolvedAgent,
            verb: 'eval',
            featureId: name,
            extraArgs: evalFlagSuffix,
            cliConfig,
        });
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

    // Missing workflow snapshot: refuse to bootstrap from folder position
    // (feature 270). Point the operator to the explicit migration path.
    if (!(await wf.showFeatureOrNull(repoPath, evalFeatureId))) {
        process.exitCode = 1;
        return console.error(`❌ Feature ${evalFeatureId} has no workflow-core snapshot.\n   Run \`aigon doctor --fix\` to migrate legacy features, then retry.`);
    }

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
        // Drift-correction fallback (feature 270): the engine transition
        // succeeded but the move_spec effect didn't land the file.
        found = findFile(PATHS.features, name, ['03-in-progress']);
        if (found) {
            console.warn(`⚠️  Drift: spec for feature ${name} still in 03-in-progress after engine eval transition. Force-moving to 04-in-evaluation.`);
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
}

module.exports = { run };
