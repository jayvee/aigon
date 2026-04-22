'use strict';

const fs = require('fs');
const path = require('path');
const workflowDefs = require('../workflow-definitions');
const { parseCliOptions, getOptionValue } = require('../cli-parse');
const git = require('../git');

function resolveRepoPath() {
    try {
        return git.resolveMainRepoPath(process.cwd(), git);
    } catch (_) {
        return process.cwd();
    }
}

function splitAgents(value) {
    if (!value) return [];
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function buildDefinitionFromOptions(slug, options) {
    const def = { slug };
    const label = getOptionValue(options, 'label');
    if (typeof label === 'string' && label) def.label = label;
    const description = getOptionValue(options, 'description');
    if (typeof description === 'string' && description) def.description = description;

    const fileValue = getOptionValue(options, 'file');
    const jsonValue = getOptionValue(options, 'json');
    const fromValue = getOptionValue(options, 'from');

    if (typeof fileValue === 'string' && fileValue) {
        const absPath = path.resolve(process.cwd(), fileValue);
        const raw = fs.readFileSync(absPath, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...parsed, slug };
    }
    if (typeof jsonValue === 'string' && jsonValue) {
        const parsed = JSON.parse(jsonValue);
        return { ...parsed, slug };
    }
    if (typeof fromValue === 'string' && fromValue) {
        const base = workflowDefs.resolve(fromValue, resolveRepoPath());
        if (!base) throw new Error(`Source workflow "${fromValue}" not found`);
        return {
            slug,
            label: def.label || `${base.label} (copy)`,
            description: def.description || base.description,
            stages: JSON.parse(JSON.stringify(base.stages)),
        };
    }

    const implementAgents = splitAgents(getOptionValue(options, 'implement'));
    if (implementAgents.length === 0) {
        throw new Error('Provide --file=<path>, --json=<inline>, --from=<slug>, or --implement=<agents> (comma-separated)');
    }
    const stages = [{ type: 'implement', agents: implementAgents }];

    const reviewAgent = getOptionValue(options, 'review');
    const counterReviewAgent = getOptionValue(options, 'counter-review');
    const evalAgent = getOptionValue(options, 'eval');

    if (typeof reviewAgent === 'string' && reviewAgent) {
        stages.push({ type: 'review', agents: [reviewAgent] });
        if (typeof counterReviewAgent === 'string' && counterReviewAgent) {
            stages.push({ type: 'counter-review', agents: [counterReviewAgent] });
        } else {
            stages.push({ type: 'counter-review', agents: [implementAgents[0]] });
        }
    }
    if (typeof evalAgent === 'string' && evalAgent) {
        stages.push({ type: 'eval', agents: [evalAgent] });
    }

    const noClose = getOptionValue(options, 'no-close') === true;
    if (!noClose) stages.push({ type: 'close' });

    return { ...def, stages };
}

function formatStageLine(stage) {
    if (stage.type === 'close') return 'close';
    const agentPart = stage.agents.join(',');
    const modelPart = stage.models ? ` models=${JSON.stringify(stage.models)}` : '';
    return `${stage.type}(${agentPart})${modelPart}`;
}

function printTable(rows) {
    if (rows.length === 0) {
        console.log('No workflows found.');
        return;
    }
    const cols = ['slug', 'source', 'stages', 'label'];
    const widths = cols.map(col => Math.max(col.length, ...rows.map(r => String(r[col] || '').length)));
    const header = cols.map((col, i) => col.padEnd(widths[i])).join('  ');
    console.log(header);
    console.log(widths.map(w => '-'.repeat(w)).join('  '));
    rows.forEach(row => {
        console.log(cols.map((col, i) => String(row[col] || '').padEnd(widths[i])).join('  '));
    });
}

async function handleList(options) {
    const repoPath = resolveRepoPath();
    const all = workflowDefs.loadAll(repoPath);
    if (getOptionValue(options, 'json') === true) {
        console.log(JSON.stringify(all, null, 2));
        return;
    }
    const rows = all.map(def => ({
        slug: def.slug,
        source: def.source + (def.overrides ? ` (overrides ${def.overrides})` : ''),
        stages: def.stages.map(formatStageLine).join(' → '),
        label: def.label,
    }));
    printTable(rows);
}

async function handleShow(args, options) {
    const slug = args._[1];
    if (!slug) {
        console.error('Usage: aigon workflow show <slug> [--json]');
        process.exitCode = 1;
        return;
    }
    const repoPath = resolveRepoPath();
    const def = workflowDefs.resolve(slug, repoPath);
    if (!def) {
        console.error(`❌ Workflow not found: ${slug}`);
        process.exitCode = 1;
        return;
    }
    if (getOptionValue(options, 'json') === true) {
        console.log(JSON.stringify(def, null, 2));
        return;
    }
    console.log(`slug:        ${def.slug}`);
    console.log(`label:       ${def.label}`);
    console.log(`source:      ${def.source}${def.overrides ? ` (overrides ${def.overrides})` : ''}`);
    console.log(`description: ${def.description || '(none)'}`);
    console.log('stages:');
    def.stages.forEach((stage, idx) => {
        console.log(`  ${idx + 1}. ${formatStageLine(stage)}`);
    });
    const resolved = workflowDefs.resolveAutonomousInputs(def);
    console.log('');
    console.log('resolves to autonomous inputs:');
    console.log(`  agents:       ${resolved.agents.join(', ')}`);
    console.log(`  evalAgent:    ${resolved.evalAgent || '(none)'}`);
    console.log(`  reviewAgent:  ${resolved.reviewAgent || '(none)'}`);
    console.log(`  stopAfter:    ${resolved.stopAfter}`);
    if (Object.keys(resolved.models).length > 0) {
        console.log(`  models:       ${JSON.stringify(resolved.models)}`);
    }
}

async function handleCreate(args, options) {
    const slug = args._[1];
    if (!slug) {
        console.error('Usage: aigon workflow create <slug> [--file=<path> | --json=<inline> | --from=<slug> | --implement=<agents> [--review=<agent>] [--counter-review=<agent>] [--eval=<agent>] [--no-close]] [--label=<label>] [--description=<desc>] [--global]');
        process.exitCode = 1;
        return;
    }
    if (!workflowDefs.isValidSlug(slug)) {
        console.error(`❌ Invalid slug "${slug}". Use lowercase letters, digits, and hyphens (2-50 chars).`);
        process.exitCode = 1;
        return;
    }
    if (workflowDefs.isBuiltIn(slug)) {
        console.error(`❌ "${slug}" is a built-in workflow and cannot be overwritten. Pick a different slug.`);
        process.exitCode = 1;
        return;
    }
    let def;
    try {
        def = buildDefinitionFromOptions(slug, options);
        workflowDefs.validateWorkflow(def);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
        return;
    }
    const isGlobal = getOptionValue(options, 'global') === true;
    const targetPath = isGlobal
        ? workflowDefs.saveGlobal(def)
        : workflowDefs.saveProject(resolveRepoPath(), def);
    console.log(`✅ Saved workflow "${slug}" (${isGlobal ? 'global' : 'project'})`);
    console.log(`   ${targetPath}`);
}

async function handleDelete(args, options) {
    const slug = args._[1];
    if (!slug) {
        console.error('Usage: aigon workflow delete <slug> [--global]');
        process.exitCode = 1;
        return;
    }
    if (workflowDefs.isBuiltIn(slug)) {
        console.error(`❌ "${slug}" is a built-in workflow and cannot be deleted.`);
        process.exitCode = 1;
        return;
    }
    const isGlobal = getOptionValue(options, 'global') === true;
    const removed = isGlobal
        ? workflowDefs.deleteGlobal(slug)
        : workflowDefs.deleteProject(resolveRepoPath(), slug);
    if (!removed) {
        console.error(`❌ Workflow "${slug}" not found in ${isGlobal ? 'global' : 'project'} scope`);
        process.exitCode = 1;
        return;
    }
    console.log(`🗑️  Deleted workflow "${slug}" (${isGlobal ? 'global' : 'project'})`);
}

function createWorkflowCommands() {
    return {
        workflow: async (rawArgs) => {
            const options = parseCliOptions(rawArgs || []);
            const subcommand = options._[0];
            switch (subcommand) {
                case 'list':
                    return handleList(options);
                case 'show':
                    return handleShow(options, options);
                case 'create':
                    return handleCreate(options, options);
                case 'delete':
                case 'rm':
                case 'remove':
                    return handleDelete(options, options);
                case undefined:
                case 'help':
                case '--help':
                    console.log('Workflow definitions (autonomous orchestration templates)');
                    console.log('');
                    console.log('Usage:');
                    console.log('  aigon workflow list [--json]');
                    console.log('  aigon workflow show <slug> [--json]');
                    console.log('  aigon workflow create <slug> [options]');
                    console.log('  aigon workflow delete <slug> [--global]');
                    console.log('');
                    console.log('Create options:');
                    console.log('  --file=<path>                     Read JSON definition from file');
                    console.log('  --json=<inline>                   Inline JSON definition');
                    console.log('  --from=<slug>                     Copy from an existing workflow');
                    console.log('  --implement=<a,b,c>               Implementation agents');
                    console.log('  --review=<agent>                  Solo review agent');
                    console.log('  --counter-review=<agent>          Agent to address review feedback (default: first implementer)');
                    console.log('  --eval=<agent>                    Fleet eval agent');
                    console.log('  --no-close                        Omit the trailing close stage');
                    console.log('  --label=<label>                   Human label');
                    console.log('  --description=<text>              Description');
                    console.log('  --global                          Save to ~/.aigon/workflow-definitions/');
                    console.log('');
                    console.log('Use a workflow:');
                    console.log('  aigon feature-autonomous-start <id> --workflow=<slug>');
                    return;
                default:
                    console.error(`Unknown workflow subcommand: ${subcommand}`);
                    console.error('Try: aigon workflow help');
                    process.exitCode = 1;
                    return;
            }
        },
    };
}

module.exports = { createWorkflowCommands };
