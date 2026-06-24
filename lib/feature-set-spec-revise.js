'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const featureSets = require('./feature-sets');
const { parseCliOptions, getOptionValue, parseFrontMatter } = require('./cli-parse');
const { resolveCxCommandBody, printTopAgentSuggestion } = require('./agent-prompt-resolver');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const featureSpecResolver = require('./feature-spec-resolver');
const agentRegistry = require('./agent-registry');
const { getDefaultAgent, detectActiveAgentSession, printAgentContextWarning } = require('./config');
const { buildActionContext, assertActionAllowed, runDelegatedAigonCommand } = require('./action-scope');
const {
    collectPendingSpecReviewsFromGit,
    getRevisionSkipReason,
    workflowHasLoggedPendingReviews,
} = require('./spec-review-state');
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
        snapshot,
        entityId: member.paddedId ? toUnpaddedId(member.paddedId) : member.slug,
        displayId: member.paddedId ? `#${member.paddedId}` : member.slug,
    };
}

function assessMemberRevisionCandidate(resolved) {
    const skipReason = getRevisionSkipReason(resolved);
    if (skipReason) {
        return {
            ...resolved,
            revisionStatus: 'skipped',
            skipReason,
            gitPending: [],
            workflowPending: [],
        };
    }

    const gitPending = collectPendingSpecReviewsFromGit(
        resolved.repoPath || process.cwd(),
        resolved.specPath,
        'feature',
        resolved.entityId,
    );
    const workflowPending = Array.isArray(resolved.snapshot?.specReview?.pendingReviews)
        ? resolved.snapshot.specReview.pendingReviews
        : [];

    if (gitPending.length === 0) {
        return {
            ...resolved,
            revisionStatus: 'no-pending',
            gitPending,
            workflowPending,
        };
    }

    if (!workflowHasLoggedPendingReviews(resolved.snapshot, gitPending)) {
        return {
            ...resolved,
            revisionStatus: 'inconsistent',
            gitPending,
            workflowPending,
            skipReason: 'spec-review commit exists but workflow review completion is missing',
        };
    }

    return {
        ...resolved,
        revisionStatus: 'eligible',
        gitPending,
        workflowPending,
    };
}

function filterPendingForRevisionAgent(member, revisionAgentId) {
    const agentId = String(revisionAgentId || '').trim().toLowerCase();
    const external = (member.gitPending || []).filter((review) => {
        const reviewerId = String(review.reviewerId || '').trim().toLowerCase();
        return reviewerId && reviewerId !== agentId;
    });
    if ((member.gitPending || []).length > 0 && external.length === 0) {
        return {
            ...member,
            revisionStatus: 'skipped',
            skipReason: 'same-agent review',
            activePending: [],
        };
    }
    return {
        ...member,
        activePending: external,
    };
}

function isPendingSpecReviseMember(memberAssessment) {
    return memberAssessment.revisionStatus === 'eligible';
}

function countPendingSpecReviseMembers(members, repoPath) {
    return (Array.isArray(members) ? members : []).filter((member) => {
        const resolved = resolveMemberSpec(repoPath, member);
        if (!resolved) return false;
        resolved.repoPath = repoPath;
        return isPendingSpecReviseMember(assessMemberRevisionCandidate(resolved));
    }).length;
}

function resolveSetSpecRevisePlan(repoPath, setSlug, paths = null, options = {}) {
    const featurePaths = paths || require('./templates').PATHS.features;
    const members = featureSets.getSetMembersSorted(setSlug, featurePaths);
    const edges = featureSets.getSetDependencyEdges(setSlug, featurePaths);
    const assessed = [];
    const contextRows = [];

    for (const member of members) {
        const resolved = resolveMemberSpec(repoPath, member);
        if (!resolved) {
            return {
                error: `Could not resolve feature spec for set member "${member.slug}" (stage: ${member.stage}).`,
            };
        }
        resolved.repoPath = repoPath;
        let assessment = assessMemberRevisionCandidate(resolved);
        if (assessment.revisionStatus === 'eligible') {
            if (options.revisionAgentId) {
                assessment = filterPendingForRevisionAgent(assessment, options.revisionAgentId);
            }
            if (assessment.revisionStatus === 'eligible' && (assessment.activePending || assessment.gitPending).length > 0) {
                assessed.push(assessment);
            }
        }
        contextRows.push({
            member: resolved,
            assessment,
        });
    }

    const anchor = assessed.find(m => m.paddedId) || assessed[0] || null;
    return {
        setSlug,
        members,
        edges,
        eligible: assessed,
        contextRows,
        anchor,
    };
}

function formatDependencyEdges(edges) {
    if (!Array.isArray(edges) || edges.length === 0) return '(no intra-set dependencies)';
    return edges.map(edge => `#${edge.from} → #${edge.to}`).join('\n');
}

function formatMemberContextTable(contextRows, edges) {
    const depMap = new Map();
    for (const edge of edges || []) {
        if (!depMap.has(edge.from)) depMap.set(edge.from, []);
        depMap.get(edge.from).push(`#${edge.to}`);
    }
    const header = '| ID | Stage | Feature | Depends on | Revision status |';
    const sep = '| --- | --- | --- | --- | --- |';
    const rows = (contextRows || []).map(({ member, assessment }) => {
        const id = member.paddedId ? `#${member.paddedId}` : member.slug;
        const deps = member.paddedId
            ? (depMap.get(member.paddedId) || []).join(', ')
            : '';
        let status = assessment.revisionStatus || '—';
        if (assessment.skipReason) status += ` (${assessment.skipReason})`;
        else if (assessment.revisionStatus === 'eligible') {
            const count = (assessment.gitPending || []).length;
            status = `${count} pending review${count === 1 ? '' : 's'}`;
        } else if (assessment.revisionStatus === 'inconsistent') {
            status = 'inconsistent — workflow signal missing';
        } else if (assessment.revisionStatus === 'no-pending') {
            status = 'no pending reviews';
        }
        return `| ${id} | ${member.stage} | ${member.slug} | ${deps || '—'} | ${status} |`;
    });
    return [header, sep, ...rows].join('\n');
}

function formatPendingReviewSummaries(eligibleMembers) {
    const chunks = [];
    for (const member of eligibleMembers) {
        const pending = member.activePending || member.gitPending || [];
        if (pending.length === 0) continue;
        const lines = pending.map((review) => {
            const reviewer = review.reviewerId ? ` (${review.reviewerId})` : '';
            return `- \`${review.sha.slice(0, 7)}\` ${review.subject}${reviewer}`;
        });
        chunks.push(`**${member.displayId} ${member.slug}**\n${lines.join('\n')}`);
    }
    return chunks.length > 0 ? chunks.join('\n\n') : '(no pending reviews in active set)';
}

function readSpecBodies(eligibleMembers) {
    const chunks = [];
    for (const member of eligibleMembers) {
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

function buildSetSpecRevisePromptPlaceholders(plan) {
    const reviseTargets = plan.eligible.map((m) => {
        const recordArg = m.paddedId || m.slug;
        return `- ${m.displayId} ${m.slug}: after deciding, \`git commit\` one \`spec-revise:\` ack for this spec, then \`aigon feature-spec-revise-record ${recordArg}\``;
    }).join('\n');
    return {
        SET_SLUG: plan.setSlug,
        SET_MEMBER_TABLE: formatMemberContextTable(plan.contextRows, plan.edges),
        SET_DEPENDENCY_EDGES: formatDependencyEdges(plan.edges),
        SET_PENDING_REVIEWS: formatPendingReviewSummaries(plan.eligible),
        SET_MEMBER_SPECS: readSpecBodies(plan.eligible),
        SET_REVISE_TARGETS: reviseTargets,
        ARG1_SYNTAX: plan.setSlug,
        ARG_SYNTAX: `${plan.setSlug} --no-launch`,
    };
}

function buildSetSpecRevisePromptBody(plan, agentId = 'cx') {
    const placeholders = buildSetSpecRevisePromptPlaceholders(plan);
    return resolveCxCommandBody('feature-set-spec-revise', `${plan.setSlug} --no-launch`, agentId, placeholders);
}

function resolveSetCreatorRevisionAgent(repoPath, plan) {
    const first = (plan.members || []).find(m => m.paddedId) || plan.members[0];
    if (!first) return getDefaultAgent(repoPath);
    const resolved = resolveMemberSpec(repoPath, first);
    if (!resolved || !resolved.specPath) return getDefaultAgent(repoPath);
    try {
        const raw = fs.readFileSync(resolved.specPath, 'utf8');
        const parsed = parseFrontMatter(raw);
        if (parsed?.data?.agent && String(parsed.data.agent).trim()) {
            return String(parsed.data.agent).trim();
        }
    } catch (_) { /* fall through */ }
    if (resolved.snapshot?.authorAgentId) {
        return String(resolved.snapshot.authorAgentId).trim();
    }
    return getDefaultAgent(repoPath);
}

function resolveRevisionAgent(options, repoPath, plan) {
    const availableAgents = require('./utils').getAvailableAgents();
    const aliasMap = require('./utils').buildAgentAliasMap();
    const raw = getOptionValue(options, 'agent');
    const positionalAgent = (options._ || []).slice(1).find(token => !String(token).startsWith('--'));
    const chosen = raw || positionalAgent || resolveSetCreatorRevisionAgent(repoPath, plan);
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

function launchSetSpecReviseTmuxSession({
    repoPath,
    plan,
    agentId,
    launcherModel,
    launcherEffort,
}) {
    if (!plan.anchor) {
        throw new Error(
            'Set-wide spec revision needs at least one eligible member with pending reviews. ' +
            'No members remain after filtering same-agent reviews and lifecycle skips.'
        );
    }
    const repoName = path.basename(repoPath);
    const featureId = plan.anchor.entityId;
    const sessionName = buildTmuxSessionName(featureId, agentId, {
        repo: repoName,
        desc: `set-${plan.setSlug}`,
        entityType: 'f',
        role: 'spec-revise',
    });
    addWorktreePermissions([repoPath]);
    agentRegistry.ensureAgentTrust(agentId, [repoPath]);
    const promptBody = buildSetSpecRevisePromptBody(plan, agentId);
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
    }, 'spec-revise');

    if (!tmuxSessionExists(sessionName)) {
        createDetachedTmuxSession(sessionName, repoPath, command, {
            repoPath,
            worktreePath: repoPath,
            agent: agentId,
            entityType: 'f',
            entityId: featureId,
            role: 'spec-revise',
            metadata: {
                setSpecRevise: {
                    setSlug: plan.setSlug,
                    members: plan.eligible.map(m => ({
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

function launchSetSpecReviseInline(agentId, plan) {
    const u = require('./utils');
    const cliConfig = u.getAgentCliConfig(agentId);
    const prompt = buildSetSpecRevisePromptBody(plan, agentId);
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

function runFeatureSetSpecRevise(rawArgs) {
    const options = parseCliOptions(rawArgs || []);
    const setSlug = options._[0];
    if (!setSlug) {
        console.error('Usage: aigon feature-set-spec-revise <slug> [--agent=<agent>] [--no-launch]');
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
        const result = assertActionAllowed('feature-set-spec-revise', actionCtx);
        if (result && result.delegate) {
            console.log('📡 Delegating \'feature-set-spec-revise\' to main repo...');
            runDelegatedAigonCommand(result.delegate, 'feature-set-spec-revise', rawArgs || []);
            return;
        }
    } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exitCode = 1;
        return;
    }

    const repoPath = process.cwd();
    const prePlan = resolveSetSpecRevisePlan(repoPath, setSlug);
    if (prePlan.error) {
        console.error(`❌ ${prePlan.error}`);
        process.exitCode = 1;
        return;
    }

    const pendingCount = countPendingSpecReviseMembers(prePlan.members, repoPath);
    if (pendingCount === 0) {
        console.error(`❌ Set "${setSlug}" has no members with pending spec reviews to revise.`);
        process.exitCode = 1;
        return;
    }

    const noLaunch = (rawArgs || []).includes('--no-launch');
    const fromDashboard = process.env.AIGON_INVOKED_BY_DASHBOARD === '1';
    const sessionInfo = detectActiveAgentSession();

    let agentId = null;
    try {
        agentId = resolveRevisionAgent(options, repoPath, prePlan);
    } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exitCode = 1;
        return;
    }

    const plan = resolveSetSpecRevisePlan(repoPath, setSlug, null, { revisionAgentId: agentId });
    if (plan.error) {
        console.error(`❌ ${plan.error}`);
        process.exitCode = 1;
        return;
    }

    if (plan.eligible.length === 0) {
        console.log(`ℹ️  Set "${setSlug}" has pending spec reviews, but none are eligible for revision agent "${agentId}".`);
        console.log('   All pending reviews were authored by the selected agent (same-agent skip).');
        console.log('   Pick a different revision agent or use per-feature `feature-spec-revise <id>`.');
        return;
    }

    const anchorSpec = plan.anchor && plan.anchor.specPath ? plan.anchor.specPath : plan.eligible[0].specPath;
    printTopAgentSuggestion('spec_review', anchorSpec);

    const { launcherModel, launcherEffort } = parseLauncherTriplet(options, agentId);
    const launchTmux = fromDashboard && !noLaunch && !sessionInfo.detected;
    const launchInline = !sessionInfo.detected && !noLaunch && !fromDashboard;

    if (launchTmux) {
        try {
            const sessionName = launchSetSpecReviseTmuxSession({
                repoPath,
                plan,
                agentId,
                launcherModel,
                launcherEffort,
            });
            console.log(`✅ Opened set spec revision for "${setSlug}" (${sessionName})`);
        } catch (e) {
            console.error(`❌ ${e.message}`);
            process.exitCode = 1;
        }
        return;
    }

    if (launchInline) {
        launchSetSpecReviseInline(agentId, plan);
        return;
    }

    printAgentContextWarning('feature-set-spec-revise', setSlug);
    console.log(`📋 Set: ${setSlug} — ${plan.eligible.length} eligible member(s) in dependency order`);
    console.log('\n--- SET SPEC REVISION PROMPT ---\n');
    console.log(buildSetSpecRevisePromptBody(plan, agentId));
    console.log('\n--- END PROMPT ---');
}

module.exports = {
    assessMemberRevisionCandidate,
    filterPendingForRevisionAgent,
    countPendingSpecReviseMembers,
    resolveSetSpecRevisePlan,
    buildSetSpecRevisePromptPlaceholders,
    buildSetSpecRevisePromptBody,
    runFeatureSetSpecRevise,
};
