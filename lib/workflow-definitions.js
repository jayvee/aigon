'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_DIRNAME = path.join('.aigon', 'workflow-definitions');
const GLOBAL_DIRNAME = path.join('.aigon', 'workflow-definitions');
const ALLOWED_STOP_AFTER = new Set(['implement', 'eval', 'review', 'close']);
const ALLOWED_STAGE_TYPES = new Set(['implement', 'review', 'counter-review', 'eval', 'close']);
const LEGACY_KEYS = ['agents', 'evalAgent', 'reviewAgent', 'stopAfter'];

const BUILTIN_WORKFLOWS = Object.freeze({
    solo: Object.freeze({
        slug: 'solo',
        label: 'Solo',
        description: 'Single implementation agent in a dedicated worktree.',
        agents: ['cc'],
        stopAfter: 'close',
    }),
    'solo-reviewed': Object.freeze({
        slug: 'solo-reviewed',
        label: 'Solo Reviewed',
        description: 'Single implementation agent plus a separate review agent.',
        agents: ['cc'],
        reviewAgent: 'gg',
        stopAfter: 'close',
    }),
    arena: Object.freeze({
        slug: 'arena',
        label: 'Arena',
        description: 'Two implementation agents competing with a saved evaluator.',
        agents: ['cc', 'gg'],
        evalAgent: 'gg',
        stopAfter: 'eval',
    }),
    fleet: Object.freeze({
        slug: 'fleet',
        label: 'Fleet',
        description: 'Four implementation agents competing with a saved evaluator.',
        agents: ['cc', 'gg', 'cx', 'cu'],
        evalAgent: 'cc',
        stopAfter: 'eval',
    }),
});

function normalizeAgentList(value) {
    if (value === undefined || value === null || value === '') return [];
    const parts = Array.isArray(value) ? value : [value];
    const expanded = parts
        .flatMap(item => String(item).split(','))
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
    return [...new Set(expanded)];
}

function normalizeWorkflowSlug(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    return text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function projectWorkflowDir(repoPath = process.cwd()) {
    return path.join(path.resolve(repoPath), PROJECT_DIRNAME);
}

function globalWorkflowDir() {
    return path.join(os.homedir(), GLOBAL_DIRNAME);
}

function workflowFilePath(scope, repoPath, slug) {
    const dir = scope === 'global' ? globalWorkflowDir() : projectWorkflowDir(repoPath);
    return path.join(dir, `${slug}.json`);
}

function normalizeWorkflowInput(input = {}) {
    const slug = normalizeWorkflowSlug(input.slug);
    const label = String(input.label || slug || '').trim() || slug;
    const description = String(input.description || '').trim();
    const hasStages = Array.isArray(input.stages);
    const version = hasStages
        ? (input.version === undefined || input.version === null || input.version === ''
            ? 2
            : Number.parseInt(String(input.version), 10))
        : undefined;
    const stages = hasStages
        ? input.stages.map(stage => normalizeWorkflowStage(stage))
        : undefined;
    const agents = hasStages ? [] : normalizeAgentList(input.agents);
    const evalAgent = hasStages
        ? null
        : (input.evalAgent ? String(input.evalAgent).trim().toLowerCase() : null);
    const reviewAgent = hasStages
        ? null
        : (input.reviewAgent ? String(input.reviewAgent).trim().toLowerCase() : null);
    const stopAfter = hasStages
        ? null
        : String(input.stopAfter || 'close').trim().toLowerCase();

    return {
        slug,
        label,
        description,
        version,
        stages,
        agents,
        evalAgent,
        reviewAgent,
        stopAfter,
    };
}

function normalizeWorkflowStage(input = {}) {
    const type = String(input.type || '').trim().toLowerCase();
    const agents = normalizeAgentList(input.agents !== undefined ? input.agents : input.agent);
    return {
        type,
        agents,
    };
}

function cloneStages(stages = []) {
    return stages.map(stage => ({
        type: stage.type,
        agents: Array.isArray(stage.agents) ? stage.agents.slice() : [],
    }));
}

function validateWorkflowStages(input, options = {}) {
    const normalizedStages = cloneStages(input.stages || []);
    const availableAgents = new Set((options.availableAgents || []).map(agent => String(agent).trim().toLowerCase()));
    const errors = [];

    if (!Array.isArray(input.stages) || input.stages.length === 0) {
        errors.push('stage-based workflows require a non-empty stages array');
        return { stages: normalizedStages, errors };
    }

    const normalizedVersion = Number.parseInt(String(input.version), 10);
    if (normalizedVersion !== 2) {
        errors.push('stage-based workflows require version: 2');
    }

    const mixedLegacyKeys = LEGACY_KEYS.filter(key => {
        const value = input[key];
        if (value === undefined || value === null || value === '') return false;
        if (Array.isArray(value) && value.length === 0) return false;
        return true;
    });
    if (mixedLegacyKeys.length > 0) {
        errors.push(`stage-based workflows cannot also set legacy keys: ${mixedLegacyKeys.join(', ')}`);
    }

    const implementStage = normalizedStages.find(stage => stage.type === 'implement');
    const implementAgents = implementStage ? implementStage.agents : [];

    normalizedStages.forEach((stage, index) => {
        if (!stage.type) {
            errors.push(`stage ${index + 1} is missing a type`);
            return;
        }
        if (!ALLOWED_STAGE_TYPES.has(stage.type)) {
            errors.push(`stage ${index + 1} has unsupported type: ${stage.type}`);
        }

        if (stage.type === 'close') {
            return;
        }

        if (stage.agents.length === 0) {
            errors.push(`stage ${index + 1} (${stage.type}) requires at least one agent`);
            return;
        }

        if ((stage.type === 'review' || stage.type === 'eval') && stage.agents.length !== 1) {
            errors.push(`stage ${index + 1} (${stage.type}) must define exactly one agent`);
        }

        if (stage.type === 'counter-review' && implementAgents.length > 0) {
            const sameAgents = stage.agents.length === implementAgents.length
                && stage.agents.every((agent, agentIndex) => agent === implementAgents[agentIndex]);
            if (!sameAgents) {
                errors.push('counter-review stages must target the implementing agent set');
            }
        }

        if (availableAgents.size > 0) {
            const invalidAgents = stage.agents.filter(agent => !availableAgents.has(agent));
            if (invalidAgents.length > 0) {
                errors.push(`stage ${index + 1} (${stage.type}) has unknown agent(s): ${invalidAgents.join(', ')}`);
            }
        }
    });

    if (normalizedStages[0] && normalizedStages[0].type !== 'implement') {
        errors.push('stage-based workflows must begin with an implement stage');
    }

    const transitionErrors = [];
    for (let index = 0; index < normalizedStages.length; index += 1) {
        const current = normalizedStages[index];
        const next = normalizedStages[index + 1];
        if (!current || !current.type) continue;

        if (current.type === 'close' && next) {
            transitionErrors.push('close must be the final stage');
            continue;
        }

        if (!next) continue;

        if (current.type === 'implement' && !['review', 'eval', 'close'].includes(next.type)) {
            transitionErrors.push(`implement cannot be followed by ${next.type}`);
        }
        if (current.type === 'review' && next.type !== 'counter-review') {
            transitionErrors.push(`review cannot be followed by ${next.type}`);
        }
        if (current.type === 'counter-review' && !['review', 'close'].includes(next.type)) {
            transitionErrors.push(`counter-review cannot be followed by ${next.type}`);
        }
        if (current.type === 'eval' && next.type !== 'close') {
            transitionErrors.push(`eval cannot be followed by ${next.type}`);
        }
    }
    errors.push(...transitionErrors.map(message => `invalid stage ordering: ${message}`));

    const hasReview = normalizedStages.some(stage => stage.type === 'review' || stage.type === 'counter-review');
    const hasEval = normalizedStages.some(stage => stage.type === 'eval');
    if (!implementStage) {
        errors.push('stage-based workflows require an implement stage');
    }
    if (hasReview && implementAgents.length !== 1) {
        errors.push('review/counter-review stages require exactly one implementing agent');
    }
    if (hasEval && implementAgents.length < 2) {
        errors.push('eval stages require at least two implementing agents');
    }
    if (hasReview && hasEval) {
        errors.push('review/counter-review stages cannot be combined with eval stages');
    }

    return { stages: normalizedStages, errors };
}

function buildStagesFromLegacy(input = {}) {
    const implementAgents = normalizeAgentList(input.agents);
    const reviewAgent = input.reviewAgent ? String(input.reviewAgent).trim().toLowerCase() : null;
    const evalAgent = input.evalAgent ? String(input.evalAgent).trim().toLowerCase() : null;
    const stopAfter = String(input.stopAfter || 'close').trim().toLowerCase();
    const stages = [];

    if (implementAgents.length > 0) {
        stages.push({ type: 'implement', agents: implementAgents });
    }

    if (reviewAgent) {
        stages.push({ type: 'review', agents: [reviewAgent] });
        if (stopAfter !== 'review') {
            stages.push({ type: 'counter-review', agents: implementAgents });
        }
    } else if (evalAgent) {
        stages.push({ type: 'eval', agents: [evalAgent] });
    }

    if (stopAfter === 'close') {
        stages.push({ type: 'close', agents: [] });
    }

    return stages;
}

function overrideStageAgents(stages, type, agents) {
    const nextStages = cloneStages(stages);
    const stage = nextStages.find(entry => entry.type === type);
    if (!stage) return nextStages;
    stage.agents = agents;
    return nextStages;
}

function truncateStages(stages, stopAfter) {
    const normalizedStopAfter = String(stopAfter || '').trim().toLowerCase();
    if (!normalizedStopAfter) return cloneStages(stages);
    const targetType = normalizedStopAfter;
    const nextStages = cloneStages(stages);
    const stopIndex = nextStages.findIndex(stage => stage.type === targetType);
    if (stopIndex === -1) {
        return nextStages;
    }
    return nextStages.slice(0, stopIndex + 1);
}

function deriveStageRuntime(stages = []) {
    const effectiveStages = cloneStages(stages);
    const implementStage = effectiveStages.find(stage => stage.type === 'implement');
    const reviewStage = effectiveStages.find(stage => stage.type === 'review');
    const evalStage = effectiveStages.find(stage => stage.type === 'eval');
    const lastStage = effectiveStages[effectiveStages.length - 1] || null;
    return {
        version: 2,
        stages: effectiveStages,
        agents: implementStage ? implementStage.agents.slice() : [],
        evalAgent: evalStage ? (evalStage.agents[0] || null) : null,
        reviewAgent: reviewStage ? (reviewStage.agents[0] || null) : null,
        stopAfter: lastStage && lastStage.type !== 'counter-review' ? lastStage.type : 'close',
        stopAfterStage: lastStage ? lastStage.type : 'close',
    };
}

function validateWorkflowDefinition(input, options = {}) {
    const normalized = normalizeWorkflowInput(input);
    const errors = [];

    if (!normalized.slug) {
        errors.push('slug is required');
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized.slug)) {
        errors.push('slug must use lowercase letters, numbers, and hyphens only');
    }

    if (normalized.stages) {
        const stageValidation = validateWorkflowStages(input, options);
        errors.push(...stageValidation.errors);
        return {
            normalized: {
                ...normalized,
                stages: stageValidation.stages,
            },
            errors,
        };
    }

    const availableAgents = new Set((options.availableAgents || []).map(agent => String(agent).trim().toLowerCase()));

    if (normalized.agents.length === 0) {
        errors.push('at least one implementing agent is required');
    }

    if (!ALLOWED_STOP_AFTER.has(normalized.stopAfter)) {
        errors.push('--stop-after must be one of: implement, eval, review, close');
    }

    if (availableAgents.size > 0) {
        const invalidAgents = normalized.agents.filter(agent => !availableAgents.has(agent));
        if (invalidAgents.length > 0) {
            errors.push(`unknown agent(s): ${invalidAgents.join(', ')}`);
        }
        if (normalized.evalAgent && !availableAgents.has(normalized.evalAgent)) {
            errors.push(`unknown eval agent: ${normalized.evalAgent}`);
        }
        if (normalized.reviewAgent && !availableAgents.has(normalized.reviewAgent)) {
            errors.push(`unknown review agent: ${normalized.reviewAgent}`);
        }
    }

    if (normalized.agents.length === 1 && normalized.evalAgent) {
        errors.push('solo workflows cannot set evalAgent');
    }
    if (normalized.agents.length > 1 && normalized.reviewAgent) {
        errors.push('fleet workflows cannot set reviewAgent');
    }
    if (normalized.stopAfter === 'review' && normalized.agents.length > 1) {
        errors.push('fleet workflows cannot stop after review');
    }
    if (normalized.stopAfter === 'review' && normalized.agents.length === 1 && !normalized.reviewAgent) {
        errors.push('stopAfter=review requires reviewAgent for solo workflows');
    }

    return { normalized, errors };
}

function readWorkflowFile(filePath, source) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const { normalized, errors } = validateWorkflowDefinition(parsed);
        if (errors.length > 0) {
            return { ok: false, source, path: filePath, errors };
        }
        return {
            ok: true,
            definition: {
                ...normalized,
                source,
                path: filePath,
                readOnly: false,
            },
        };
    } catch (error) {
        return { ok: false, source, path: filePath, errors: [error.message] };
    }
}

function readScopedWorkflows(scope, repoPath = process.cwd()) {
    const dir = scope === 'global' ? globalWorkflowDir() : projectWorkflowDir(repoPath);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .sort()
        .map(file => readWorkflowFile(path.join(dir, file), scope));
}

function listAvailableWorkflows(repoPath = process.cwd()) {
    const resolved = new Map();
    Object.values(BUILTIN_WORKFLOWS).forEach(definition => {
        resolved.set(definition.slug, {
            ...definition,
            source: 'built-in',
            path: null,
            readOnly: true,
        });
    });

    ['global', 'project'].forEach(scope => {
        readScopedWorkflows(scope, repoPath).forEach(entry => {
            if (!entry.ok) return;
            resolved.set(entry.definition.slug, entry.definition);
        });
    });

    return [...resolved.values()].sort((left, right) =>
        left.slug.localeCompare(right.slug, undefined, { numeric: true })
    );
}

function resolveWorkflowDefinition(repoPath, slug) {
    const normalizedSlug = normalizeWorkflowSlug(slug);
    if (!normalizedSlug) return null;
    return listAvailableWorkflows(repoPath).find(definition => definition.slug === normalizedSlug) || null;
}

function applyWorkflowDefinition(definition, explicit = {}) {
    const explicitAgents = Array.isArray(explicit.agents) ? explicit.agents.filter(Boolean) : [];
    if (definition && definition.version === 2 && Array.isArray(definition.stages)) {
        let stages = cloneStages(definition.stages);

        if (explicitAgents.length > 0) {
            stages = overrideStageAgents(stages, 'implement', explicitAgents);
        }
        if (explicit.reviewAgent !== undefined) {
            stages = overrideStageAgents(
                stages,
                'review',
                explicit.reviewAgent ? [String(explicit.reviewAgent).trim().toLowerCase()] : []
            );
        }
        if (explicit.evalAgent !== undefined) {
            stages = overrideStageAgents(
                stages,
                'eval',
                explicit.evalAgent ? [String(explicit.evalAgent).trim().toLowerCase()] : []
            );
        }
        if (explicit.stopAfter !== undefined) {
            stages = truncateStages(stages, explicit.stopAfter);
        }

        return {
            ...deriveStageRuntime(stages),
            label: definition.label,
            description: definition.description,
            slug: definition.slug,
        };
    }

    return {
        version: definition && definition.version === 2 ? 2 : 1,
        agents: explicitAgents.length > 0
            ? explicitAgents
            : (definition ? definition.agents.slice() : []),
        evalAgent: explicit.evalAgent !== undefined
            ? explicit.evalAgent
            : (definition ? (definition.evalAgent || null) : null),
        reviewAgent: explicit.reviewAgent !== undefined
            ? explicit.reviewAgent
            : (definition ? (definition.reviewAgent || null) : null),
        stopAfter: explicit.stopAfter !== undefined
            ? explicit.stopAfter
            : (definition ? definition.stopAfter : 'close'),
        stopAfterStage: explicit.stopAfter !== undefined
            ? explicit.stopAfter
            : (definition ? definition.stopAfter : 'close'),
    };
}

function getWorkflowDefinitionPath(definition, repoPath = process.cwd()) {
    if (!definition || !definition.path) return null;
    const absPath = path.resolve(definition.path);
    const repoRoot = path.resolve(repoPath);
    if (absPath.startsWith(repoRoot + path.sep)) {
        return path.relative(repoRoot, absPath);
    }
    const home = os.homedir();
    if (absPath.startsWith(home + path.sep)) {
        return `~/${path.relative(home, absPath)}`;
    }
    return absPath;
}

function saveWorkflowDefinition(scope, repoPath, input, options = {}) {
    if (!['project', 'global'].includes(scope)) {
        throw new Error(`Unsupported workflow scope: ${scope}`);
    }
    const { normalized, errors } = validateWorkflowDefinition(input, options);
    if (errors.length > 0) {
        throw new Error(errors.join('; '));
    }

    const targetPath = workflowFilePath(scope, repoPath, normalized.slug);
    if (fs.existsSync(targetPath)) {
        throw new Error(`${scope} workflow already exists: ${normalized.slug}`);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
    return {
        ...normalized,
        source: scope,
        path: targetPath,
        readOnly: false,
    };
}

function deleteWorkflowDefinition(repoPath, slug, scope = null) {
    const normalizedSlug = normalizeWorkflowSlug(slug);
    if (!normalizedSlug) {
        throw new Error('workflow slug is required');
    }

    if (scope && !['project', 'global'].includes(scope)) {
        throw new Error(`Unsupported workflow scope: ${scope}`);
    }

    const scopes = scope ? [scope] : ['project', 'global'];
    for (const candidateScope of scopes) {
        const targetPath = workflowFilePath(candidateScope, repoPath, normalizedSlug);
        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { force: true });
            return { slug: normalizedSlug, scope: candidateScope, path: targetPath };
        }
    }

    if (BUILTIN_WORKFLOWS[normalizedSlug]) {
        throw new Error(`workflow "${normalizedSlug}" is built-in and read-only`);
    }
    throw new Error(`workflow "${normalizedSlug}" was not found`);
}

function formatWorkflowSummary(definition) {
    if (definition.version === 2 && Array.isArray(definition.stages)) {
        const stageSummary = definition.stages
            .map(stage => `${stage.type}${stage.agents.length > 0 ? `(${stage.agents.join(',')})` : ''}`)
            .join(' > ');
        return `version=2 stages=${stageSummary}`;
    }

    const bits = [`agents=${definition.agents.join(',')}`];
    if (definition.evalAgent) bits.push(`eval=${definition.evalAgent}`);
    if (definition.reviewAgent) bits.push(`review=${definition.reviewAgent}`);
    if (definition.stopAfter) bits.push(`stop-after=${definition.stopAfter}`);
    return bits.join(' ');
}

module.exports = {
    BUILTIN_WORKFLOWS,
    normalizeAgentList,
    normalizeWorkflowSlug,
    normalizeWorkflowInput,
    normalizeWorkflowStage,
    validateWorkflowStages,
    buildStagesFromLegacy,
    validateWorkflowDefinition,
    listAvailableWorkflows,
    resolveWorkflowDefinition,
    applyWorkflowDefinition,
    getWorkflowDefinitionPath,
    saveWorkflowDefinition,
    deleteWorkflowDefinition,
    formatWorkflowSummary,
};
