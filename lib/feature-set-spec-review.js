'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const featureSets = require('./feature-sets');
const { parseCliOptions, getOptionValue } = require('./cli-parse');
const { resolveCxCommandBody, printTopAgentSuggestion } = require('./agent-prompt-resolver');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const featureSpecResolver = require('./feature-spec-resolver');
const agentRegistry = require('./agent-registry');
const { getDefaultAgent, detectActiveAgentSession, printAgentContextWarning } = require('./config');
const { buildActionContext, assertActionAllowed, runDelegatedAigonCommand } = require('./action-scope');
const {
    buildTmuxSessionName,
    buildAgentCommand,
    createDetachedTmuxSession,
    openTerminalAppWithCommand,
    shellQuote,
    tmuxSessionExists,
    toUnpaddedId,
    addWorktreePermissions,
} = require('./worktree');

const REVIEWABLE_STAGES = new Set(['inbox', 'backlog']);

function isReviewableStage(stage) {
    return REVIEWABLE_STAGES.has(String(stage || ''));
}

function isSetMemberReviewable(member) {
    if (!member || member.stage === 'done') return false;
    return isReviewableStage(member.stage);
}

function countReviewableSetMembers(members) {
    return (Array.isArray(members) ? members : []).filter(isSetMemberReviewable).length;
}

function countLaunchableSetSpecReviewMembers(members) {
    return (Array.isArray(members) ? members : [])
        .filter(member => isSetMemberReviewable(member) && member.paddedId)
        .length;
}

function resolveMemberSpec(repoPath, member) {
    const lookupId = member.paddedId || member.slug;
    const snapshot = member.paddedId
        ? workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, member.paddedId)
        : null;
    const resolved = featureSpecResolver.resolveFeatureSpec(repoPath, lookupId, { snapshot });
    if (!resolved.path || !fs.existsSync(resolved.path)) {
        return null;
    }
    return {
        ...member,
        specPath: resolved.path,
        entityId: member.paddedId ? toUnpaddedId(member.paddedId) : member.slug,
        displayId: member.paddedId ? `#${member.paddedId}` : member.slug,
    };
}

function resolveSetSpecReviewPlan(repoPath, setSlug, paths = null) {
    const featurePaths = paths || require('./templates').PATHS.features;
    const members = featureSets.getSetMembersSorted(setSlug, featurePaths);
    const edges = featureSets.getSetDependencyEdges(setSlug, featurePaths);
    const reviewable = [];
    for (const member of members) {
        if (!isSetMemberReviewable(member)) continue;
        const resolved = resolveMemberSpec(repoPath, member);
        if (!resolved) {
            return {
                error: `Could not resolve feature spec for set member "${member.slug}" (stage: ${member.stage}).`,
            };
        }
        reviewable.push(resolved);
    }
    const anchor = reviewable.find(m => m.paddedId) || null;
    return {
        setSlug,
        members,
        edges,
        reviewable,
        anchor,
        doneMembers: members.filter(m => m.stage === 'done'),
    };
}

function formatDependencyEdges(edges) {
    if (!Array.isArray(edges) || edges.length === 0) return '(no intra-set dependencies)';
    return edges.map(edge => `#${edge.from} → #${edge.to}`).join('\n');
}

function formatMemberTable(members, edges) {
    const depMap = new Map();
    for (const edge of edges || []) {
        if (!depMap.has(edge.from)) depMap.set(edge.from, []);
        depMap.get(edge.from).push(`#${edge.to}`);
    }
    const header = '| ID | Stage | Feature | Depends on |';
    const sep = '| --- | --- | --- | --- |';
    const rows = (members || []).map((member) => {
        const id = member.paddedId ? `#${member.paddedId}` : member.slug;
        const deps = member.paddedId
            ? (depMap.get(member.paddedId) || []).join(', ')
            : '';
        return `| ${id} | ${member.stage} | ${member.slug} | ${deps || '—'} |`;
    });
    return [header, sep, ...rows].join('\n');
}

function readSpecBodies(reviewableMembers) {
    const chunks = [];
    for (const member of reviewableMembers) {
        let body;
        try {
            body = fs.readFileSync(member.specPath, 'utf8');
        } catch (e) {
            throw new Error(`Could not read ${member.specPath}: ${e.message}`);
        }
        chunks.push(
            `### ${member.displayId} — ${member.slug} (${member.stage})\n` +
            `Path: \`./${path.relative(process.cwd(), member.specPath).replace(/\\/g, '/')}\`\n\n` +
            body.trim() +
            '\n'
        );
    }
    return chunks.join('\n---\n\n');
}

function buildSetSpecReviewPromptPlaceholders(plan) {
    const reviewTargets = plan.reviewable.map(m => {
        const recordArg = m.paddedId || m.slug;
        return `- ${m.displayId} ${m.slug}: after editing, \`aigon feature-spec-review-record ${recordArg}\``;
    }).join('\n');
    return {
        SET_SLUG: plan.setSlug,
        SET_MEMBER_TABLE: formatMemberTable(plan.members, plan.edges),
        SET_DEPENDENCY_EDGES: formatDependencyEdges(plan.edges),
        SET_MEMBER_SPECS: readSpecBodies(plan.reviewable),
        SET_REVIEW_TARGETS: reviewTargets,
        ARG1_SYNTAX: plan.setSlug,
        ARG_SYNTAX: `${plan.setSlug} --no-launch`,
    };
}

function buildSetSpecReviewPromptBody(plan, agentId = 'cx') {
    const placeholders = buildSetSpecReviewPromptPlaceholders(plan);
    return resolveCxCommandBody('feature-set-spec-review', `${plan.setSlug} --no-launch`, agentId, placeholders);
}

function resolveReviewAgent(options, repoPath) {
    const availableAgents = require('./utils').getAvailableAgents();
    const aliasMap = require('./utils').buildAgentAliasMap();
    const raw = getOptionValue(options, 'agent');
    const positionalAgent = (options._ || []).slice(1).find(token => !String(token).startsWith('--'));
    const chosen = raw || positionalAgent || getDefaultAgent(repoPath);
    const resolved = aliasMap[String(chosen).toLowerCase()] || String(chosen).toLowerCase();
    if (!availableAgents.includes(resolved)) {
        throw new Error(`Unknown agent '${chosen}'. Supported agents: ${availableAgents.join(', ')}`);
    }
    return resolved;
}

function parseLauncherTriplet(options, agentId) {
    const modelsCsv = getOptionValue(options, 'models') || '';
    const effortsCsv = getOptionValue(options, 'efforts') || '';
    let launcherModel = null;
    let launcherEffort = null;
    for (const part of String(modelsCsv).split(',').map(s => s.trim()).filter(Boolean)) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        const id = part.slice(0, eq).trim();
        if (id === agentId) launcherModel = part.slice(eq + 1).trim();
    }
    for (const part of String(effortsCsv).split(',').map(s => s.trim()).filter(Boolean)) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        const id = part.slice(0, eq).trim();
        if (id === agentId) launcherEffort = part.slice(eq + 1).trim();
    }
    return { launcherModel, launcherEffort };
}

function launchSetSpecReviewTmuxSession({
    repoPath,
    plan,
    agentId,
    launcherModel,
    launcherEffort,
}) {
    if (!plan.anchor) {
        throw new Error(
            'Set-wide spec review needs at least one reviewable member with a numeric feature id. ' +
            'Run `aigon set-prioritise <slug>` on inbox members first.'
        );
    }
    const repoName = path.basename(repoPath);
    const featureId = plan.anchor.entityId;
    const sessionName = buildTmuxSessionName(featureId, agentId, {
        repo: repoName,
        desc: `set-${plan.setSlug}`,
        entityType: 'f',
        role: 'spec-review',
    });
    addWorktreePermissions([repoPath]);
    agentRegistry.ensureAgentTrust(agentId, [repoPath]);
    const promptBody = buildSetSpecReviewPromptBody(plan, agentId);
    const command = buildAgentCommand({
        agent: agentId,
        featureId,
        path: repoPath,
        desc: `set-${plan.setSlug}`,
        repoPath,
        entityType: 'feature',
        launcherModel,
        launcherEffort,
        promptOverride: promptBody,
    }, 'spec-review');

    if (!tmuxSessionExists(sessionName)) {
        createDetachedTmuxSession(sessionName, repoPath, command, {
            repoPath,
            worktreePath: repoPath,
            agent: agentId,
            entityType: 'f',
            entityId: featureId,
            role: 'spec-review',
            metadata: {
                setSpecReview: {
                    setSlug: plan.setSlug,
                    members: plan.reviewable.map(m => ({
                        id: m.paddedId || null,
                        slug: m.slug,
                        stage: m.stage,
                        entityId: m.entityId,
                    })),
                },
            },
        });
    }
    openTerminalAppWithCommand(repoPath, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
    return sessionName;
}

function launchSetSpecReviewInline(agentId, plan) {
    const u = require('./utils');
    const cliConfig = u.getAgentCliConfig(agentId);
    const prompt = buildSetSpecReviewPromptBody(plan, agentId);
    const model = cliConfig.models?.review;
    const { buildModelArgTokens } = require('./agent-launch');
    const modelTokens = buildModelArgTokens(agentId, model);
    const flagTokens = u.getAgentLaunchFlagTokens(cliConfig.command, cliConfig.implementFlag, { autonomous: false });
    const promptFlag = agentRegistry.getPromptFlag(agentId);
    const spawnArgs = [...flagTokens, ...modelTokens, ...(promptFlag ? [promptFlag] : []), prompt];
    const env = { ...process.env };
    env.AIGON_ENTITY_TYPE = 'feature';
    env.AIGON_ENTITY_ID = plan.anchor ? String(plan.anchor.entityId) : String(plan.setSlug);
    env.AIGON_AGENT_ID = agentId;
    env.AIGON_PROJECT_PATH = process.cwd();
    if (cliConfig.command === 'claude') delete env.CLAUDECODE;
    const result = spawnSync(cliConfig.command, spawnArgs, { stdio: 'inherit', env }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    if (result.error) {
        console.error(`❌ Failed to launch agent: ${result.error.message}`);
        process.exitCode = 1;
    } else if (result.status !== 0) {
        process.exitCode = result.status || 1;
    }
}

function runFeatureSetSpecReview(rawArgs) {
    const options = parseCliOptions(rawArgs || []);
    const setSlug = options._[0];
    if (!setSlug) {
        console.error('Usage: aigon feature-set-spec-review <slug> [--agent=<agent>] [--no-launch]');
        process.exitCode = 1;
        return;
    }
    if (!featureSets.isValidSetSlug(setSlug)) {
        console.error(`❌ Invalid set slug: "${setSlug}"`);
        console.error('   Slugs must match [a-z0-9][a-z0-9-]* (no slashes or whitespace).');
        process.exitCode = 1;
        return;
    }

    const actionCtx = buildActionContext(require('./git'));
    try {
        const result = assertActionAllowed('feature-set-spec-review', actionCtx);
        if (result && result.delegate) {
            console.log('📡 Delegating \'feature-set-spec-review\' to main repo...');
            runDelegatedAigonCommand(result.delegate, 'feature-set-spec-review', rawArgs || []);
            return;
        }
    } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exitCode = 1;
        return;
    }

    const repoPath = process.cwd();
    const plan = resolveSetSpecReviewPlan(repoPath, setSlug);
    if (plan.error) {
        console.error(`❌ ${plan.error}`);
        process.exitCode = 1;
        return;
    }
    if (plan.reviewable.length === 0) {
        console.error(`❌ Set "${setSlug}" has no reviewable members (inbox/backlog, not done).`);
        process.exitCode = 1;
        return;
    }

    const noLaunch = (rawArgs || []).includes('--no-launch');
    const fromDashboard = process.env.AIGON_INVOKED_BY_DASHBOARD === '1';
    const sessionInfo = detectActiveAgentSession();
    const anchorSpec = plan.anchor && plan.anchor.specPath ? plan.anchor.specPath : plan.reviewable[0].specPath;
    printTopAgentSuggestion('spec_review', anchorSpec);

    let agentId = null;
    try {
        agentId = resolveReviewAgent(options, repoPath);
    } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exitCode = 1;
        return;
    }

    const { launcherModel, launcherEffort } = parseLauncherTriplet(options, agentId);
    const launchTmux = fromDashboard && !noLaunch && !sessionInfo.detected;
    const launchInline = !sessionInfo.detected && !noLaunch && !fromDashboard;

    if (launchTmux) {
        try {
            const sessionName = launchSetSpecReviewTmuxSession({
                repoPath,
                plan,
                agentId,
                launcherModel,
                launcherEffort,
            });
            console.log(`✅ Opened set spec review for "${setSlug}" (${sessionName})`);
        } catch (e) {
            console.error(`❌ ${e.message}`);
            process.exitCode = 1;
        }
        return;
    }

    if (launchInline) {
        launchSetSpecReviewInline(agentId, plan);
        return;
    }

    printAgentContextWarning('feature-set-spec-review', setSlug);
    console.log(`📋 Set: ${setSlug} — ${plan.reviewable.length} reviewable member(s) in dependency order`);
    console.log('\n--- SET SPEC REVIEW PROMPT ---\n');
    console.log(buildSetSpecReviewPromptBody(plan, agentId));
    console.log('\n--- END PROMPT ---');
}

module.exports = {
    REVIEWABLE_STAGES,
    isReviewableStage,
    isSetMemberReviewable,
    countReviewableSetMembers,
    countLaunchableSetSpecReviewMembers,
    resolveSetSpecReviewPlan,
    buildSetSpecReviewPromptPlaceholders,
    buildSetSpecReviewPromptBody,
    runFeatureSetSpecReview,
};
