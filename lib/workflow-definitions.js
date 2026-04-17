'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_DIRNAME = path.join('.aigon', 'workflow-definitions');
const GLOBAL_DIRNAME = path.join('.aigon', 'workflow-definitions');
const ALLOWED_STOP_AFTER = new Set(['implement', 'eval', 'review', 'close']);

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
    const agents = normalizeAgentList(input.agents);
    const evalAgent = input.evalAgent ? String(input.evalAgent).trim().toLowerCase() : null;
    const reviewAgent = input.reviewAgent ? String(input.reviewAgent).trim().toLowerCase() : null;
    const stopAfter = String(input.stopAfter || 'close').trim().toLowerCase();

    return {
        slug,
        label,
        description,
        agents,
        evalAgent,
        reviewAgent,
        stopAfter,
    };
}

function validateWorkflowDefinition(input, options = {}) {
    const normalized = normalizeWorkflowInput(input);
    const availableAgents = new Set((options.availableAgents || []).map(agent => String(agent).trim().toLowerCase()));
    const errors = [];

    if (!normalized.slug) {
        errors.push('slug is required');
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized.slug)) {
        errors.push('slug must use lowercase letters, numbers, and hyphens only');
    }

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
    validateWorkflowDefinition,
    listAvailableWorkflows,
    resolveWorkflowDefinition,
    getWorkflowDefinitionPath,
    saveWorkflowDefinition,
    deleteWorkflowDefinition,
    formatWorkflowSummary,
};
