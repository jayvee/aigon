'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const VALID_STAGE_TYPES = ['implement', 'review', 'counter-review', 'eval', 'close'];
const VALID_STOP_AFTER = ['implement', 'eval', 'review', 'close'];

const BUILT_IN_WORKFLOWS = [
    {
        slug: 'solo-cc',
        label: 'Solo CC',
        description: 'Implement with CC, close automatically when ready',
        stages: [
            { type: 'implement', agents: ['cc'] },
            { type: 'close' },
        ],
    },
    {
        slug: 'solo-cc-reviewed-cx',
        label: 'Solo CC Reviewed CX',
        description: 'Implement with CC, review with CX',
        stages: [
            { type: 'implement', agents: ['cc'] },
            { type: 'review', agents: ['cx'] },
            { type: 'counter-review', agents: ['cc'] },
            { type: 'close' },
        ],
    },
    {
        slug: 'solo-cx-reviewed-cc',
        label: 'Solo CX Reviewed CC',
        description: 'Implement with CX, review with CC',
        stages: [
            { type: 'implement', agents: ['cc'] },
            { type: 'review', agents: ['cx'] },
            { type: 'counter-review', agents: ['cc'] },
            { type: 'close' },
        ],
    },
    {
        slug: 'fleet-all-evaluate-with-cc',
        label: 'Fleet All, Eval with CC',
        description: 'Implement with All, CC evaluates',
        stages: [
            { type: 'implement', agents: ['cc', 'cx','gg'] },
            { type: 'eval', agents: ['cc'] },
            { type: 'close' },
        ],
    },
];

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidSlug(slug) {
    return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(slug);
}

function validateWorkflow(def) {
    if (!isObject(def)) throw new Error('Workflow must be an object');
    if (!isValidSlug(def.slug)) {
        throw new Error('Workflow slug must match /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/');
    }
    if (def.label != null && typeof def.label !== 'string') {
        throw new Error('Workflow label must be a string');
    }
    if (def.description != null && typeof def.description !== 'string') {
        throw new Error('Workflow description must be a string');
    }
    if (!Array.isArray(def.stages) || def.stages.length === 0) {
        throw new Error('Workflow must have a non-empty stages array');
    }

    def.stages.forEach((stage, idx) => {
        if (!isObject(stage)) throw new Error(`Stage ${idx} must be an object`);
        if (!VALID_STAGE_TYPES.includes(stage.type)) {
            throw new Error(`Stage ${idx} has invalid type "${stage.type}"; valid types: ${VALID_STAGE_TYPES.join(', ')}`);
        }
        if (stage.type !== 'close') {
            if (!Array.isArray(stage.agents) || stage.agents.length === 0) {
                throw new Error(`Stage ${idx} (${stage.type}) requires a non-empty agents array`);
            }
            stage.agents.forEach(agent => {
                if (typeof agent !== 'string' || !agent) {
                    throw new Error(`Stage ${idx} (${stage.type}) has an invalid agent id`);
                }
            });
        }
        if (stage.models != null && !isObject(stage.models)) {
            throw new Error(`Stage ${idx} (${stage.type}) models must be an object { agentId: modelId }`);
        }
        if (stage.params != null && !isObject(stage.params)) {
            throw new Error(`Stage ${idx} (${stage.type}) params must be an object { agentId: { key: value } }`);
        }
    });

    if (def.stages[0].type !== 'implement') {
        throw new Error('First stage must be "implement"');
    }

    const closeIndex = def.stages.findIndex(s => s.type === 'close');
    if (closeIndex !== -1 && closeIndex !== def.stages.length - 1) {
        throw new Error('"close" must be the final stage if present');
    }

    const implementStages = def.stages.filter(s => s.type === 'implement');
    if (implementStages.length !== 1) {
        throw new Error('Exactly one "implement" stage is required');
    }

    const reviewStages = def.stages.filter(s => s.type === 'review');
    const counterReviewStages = def.stages.filter(s => s.type === 'counter-review');
    const evalStages = def.stages.filter(s => s.type === 'eval');

    if (reviewStages.length > 1) throw new Error('At most one "review" stage allowed');
    if (counterReviewStages.length > 1) throw new Error('At most one "counter-review" stage allowed');
    if (evalStages.length > 1) throw new Error('At most one "eval" stage allowed');

    if ((reviewStages.length > 0 || counterReviewStages.length > 0) && evalStages.length > 0) {
        throw new Error('Review-based and eval-based workflows cannot be combined');
    }

    if (reviewStages.length > 0 && reviewStages[0].agents.length !== 1) {
        throw new Error('"review" stage must have exactly one agent');
    }
    if (counterReviewStages.length > 0 && counterReviewStages[0].agents.length !== 1) {
        throw new Error('"counter-review" stage must have exactly one agent');
    }
    if (evalStages.length > 0 && evalStages[0].agents.length !== 1) {
        throw new Error('"eval" stage must have exactly one agent');
    }

    if ((reviewStages.length > 0 || counterReviewStages.length > 0) && implementStages[0].agents.length !== 1) {
        throw new Error('Review-based workflows require exactly one implementing agent');
    }
    if (evalStages.length > 0 && implementStages[0].agents.length < 2) {
        throw new Error('Eval-based workflows require at least two implementing agents');
    }

    return true;
}

function normalizeWorkflow(def) {
    validateWorkflow(def);
    return {
        slug: def.slug,
        label: def.label || def.slug,
        description: def.description || '',
        stages: def.stages.map(stage => {
            const out = { type: stage.type };
            if (stage.type !== 'close') {
                out.agents = [...stage.agents];
            }
            if (stage.models && Object.keys(stage.models).length > 0) {
                out.models = { ...stage.models };
            }
            if (stage.params && Object.keys(stage.params).length > 0) {
                out.params = JSON.parse(JSON.stringify(stage.params));
            }
            return out;
        }),
    };
}

function resolveAutonomousInputs(def) {
    const norm = normalizeWorkflow(def);
    const implementStage = norm.stages.find(s => s.type === 'implement');
    const reviewStage = norm.stages.find(s => s.type === 'review');
    const evalStage = norm.stages.find(s => s.type === 'eval');
    const hasClose = norm.stages.some(s => s.type === 'close');

    let stopAfter;
    if (hasClose) {
        stopAfter = 'close';
    } else if (reviewStage) {
        stopAfter = 'review';
    } else if (evalStage) {
        stopAfter = 'eval';
    } else {
        stopAfter = 'implement';
    }

    const models = {};
    const params = {};
    norm.stages.forEach(stage => {
        if (stage.models) {
            Object.entries(stage.models).forEach(([agent, modelId]) => {
                if (!models[agent]) models[agent] = {};
                models[agent][stage.type] = modelId;
            });
        }
        if (stage.params) {
            Object.entries(stage.params).forEach(([agent, map]) => {
                if (!params[agent]) params[agent] = {};
                params[agent][stage.type] = { ...map };
            });
        }
    });

    return {
        agents: [...implementStage.agents],
        evalAgent: evalStage ? evalStage.agents[0] : null,
        reviewAgent: reviewStage ? reviewStage.agents[0] : null,
        stopAfter,
        models,
        params,
    };
}

function projectDir(repoPath) {
    return path.join(repoPath, '.aigon', 'workflow-definitions');
}

function globalDir() {
    return path.join(os.homedir(), '.aigon', 'workflow-definitions');
}

function readDirDefinitions(dir) {
    if (!fs.existsSync(dir)) return [];
    const entries = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const full = path.join(dir, file);
        try {
            const raw = fs.readFileSync(full, 'utf8');
            const data = JSON.parse(raw);
            if (!data.slug) data.slug = file.replace(/\.json$/, '');
            entries.push(normalizeWorkflow(data));
        } catch (error) {
            const err = new Error(`Invalid workflow file ${full}: ${error.message}`);
            err.file = full;
            throw err;
        }
    }
    return entries;
}

function loadBuiltIns() {
    return BUILT_IN_WORKFLOWS.map(def => ({
        ...normalizeWorkflow(def),
        source: 'built-in',
        readOnly: true,
    }));
}

function loadGlobal() {
    return readDirDefinitions(globalDir()).map(def => ({ ...def, source: 'global', readOnly: false }));
}

function loadProject(repoPath) {
    return readDirDefinitions(projectDir(repoPath)).map(def => ({ ...def, source: 'project', readOnly: false }));
}

function loadAll(repoPath) {
    const merged = new Map();
    for (const def of loadBuiltIns()) merged.set(def.slug, def);
    for (const def of loadGlobal()) merged.set(def.slug, { ...def, overrides: merged.has(def.slug) ? merged.get(def.slug).source : null });
    if (repoPath) {
        for (const def of loadProject(repoPath)) {
            merged.set(def.slug, { ...def, overrides: merged.has(def.slug) ? merged.get(def.slug).source : null });
        }
    }
    return Array.from(merged.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

function resolve(slug, repoPath) {
    if (!slug) return null;
    const all = loadAll(repoPath);
    return all.find(def => def.slug === slug) || null;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function saveToDir(dir, def) {
    const normalized = normalizeWorkflow(def);
    ensureDir(dir);
    const filePath = path.join(dir, `${normalized.slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
    return filePath;
}

function saveProject(repoPath, def) {
    return saveToDir(projectDir(repoPath), def);
}

function saveGlobal(def) {
    return saveToDir(globalDir(), def);
}

function deleteFromDir(dir, slug) {
    if (!isValidSlug(slug)) throw new Error(`Invalid slug: ${slug}`);
    const filePath = path.join(dir, `${slug}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
}

function deleteProject(repoPath, slug) {
    return deleteFromDir(projectDir(repoPath), slug);
}

function deleteGlobal(slug) {
    return deleteFromDir(globalDir(), slug);
}

function isBuiltIn(slug) {
    return BUILT_IN_WORKFLOWS.some(def => def.slug === slug);
}

module.exports = {
    BUILT_IN_WORKFLOWS,
    VALID_STAGE_TYPES,
    VALID_STOP_AFTER,
    isValidSlug,
    validateWorkflow,
    normalizeWorkflow,
    resolveAutonomousInputs,
    loadBuiltIns,
    loadGlobal,
    loadProject,
    loadAll,
    resolve,
    saveProject,
    saveGlobal,
    deleteProject,
    deleteGlobal,
    isBuiltIn,
    projectDir,
    globalDir,
};
