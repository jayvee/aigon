'use strict';

const fs = require('fs');
const path = require('path');

const { parseCliOptions, getOptionValue } = require('../cli-parse');
const registry = require('../agent-registry');
const runner = require('../aigon-eval-runner');

function collectActivePairs(filterAgent, filterModel) {
    const pairs = [];
    registry.getAllAgents().forEach(agent => {
        if (filterAgent && agent.id !== filterAgent) return;
        const options = Array.isArray(agent.cli && agent.cli.modelOptions) ? agent.cli.modelOptions : [];
        options.forEach(option => {
            if (!option || !option.value || option.quarantined || option.archived) return;
            if (filterModel && option.value !== filterModel) return;
            pairs.push({ agent: agent.id, model: option.value, label: option.label || option.value });
        });
    });
    return pairs;
}

function agentTemplatePath(agentId, repoPath = process.cwd()) {
    return path.join(repoPath, 'templates', 'agents', `${agentId}.json`);
}

function dominantFailure(row) {
    const entries = Object.entries(row.failureCounts || {}).sort((a, b) => b[1] - a[1]);
    return entries.length > 0 ? entries[0][0] : 'unknown';
}

function updateQuarantineForMatrix(matrix, options = {}) {
    const changed = [];
    (matrix.pairs || []).forEach(row => {
        if (!row.agent || !row.model) return;
        const file = agentTemplatePath(row.agent, options.repoPath || process.cwd());
        if (!fs.existsSync(file)) return;
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const modelOptions = data.cli && Array.isArray(data.cli.modelOptions) ? data.cli.modelOptions : [];
        const opt = modelOptions.find(item => item && item.value === row.model);
        if (!opt) return;
        const shouldQuarantine = row.runs >= 2 && row.failed >= 2;
        if (shouldQuarantine) {
            const reason = `aigon-eval failure: ${dominantFailure(row)}`;
            if (opt.quarantined !== true || opt.quarantineReason !== reason) {
                opt.quarantined = true;
                opt.quarantineReason = reason;
                opt.lastAigonEvalAt = matrix.updatedAt;
                opt.aigonEvalReliability = row.reliability;
                fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
                changed.push({ agent: row.agent, model: row.model, action: 'quarantined', reason });
            }
            return;
        }
        if (row.failed === 0 && opt.quarantined) {
            delete opt.quarantined;
            delete opt.quarantineReason;
            opt.lastAigonEvalAt = matrix.updatedAt;
            opt.aigonEvalReliability = row.reliability;
            fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
            changed.push({ agent: row.agent, model: row.model, action: 'cleared' });
        } else {
            opt.lastAigonEvalAt = matrix.updatedAt;
            opt.aigonEvalReliability = row.reliability;
            fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
        }
    });
    if (!options.quiet) {
        changed.forEach(item => {
            const suffix = item.reason ? ` (${item.reason})` : '';
            console.log(`   ${item.action}: ${item.agent}/${item.model}${suffix}`);
        });
    }
    return changed;
}

function renderReport(matrix) {
    const lines = ['| Agent | Model | Reliability | Runs | Failures |', '|---|---|---:|---:|---|'];
    (matrix.pairs || []).forEach(row => {
        const badge = row.reliability >= 90 ? 'green' : 'red';
        const failures = Object.entries(row.failureCounts || {})
            .map(([name, count]) => `${name}:${count}`)
            .join(', ') || '-';
        lines.push(`| ${row.agent} | ${row.model || '-'} | ${badge} ${row.reliability}% | ${row.passed}/${row.runs} | ${failures} |`);
    });
    return lines.join('\n');
}

function createAigonEvalCommands() {
    return {
        eval: async (args = []) => {
            const options = parseCliOptions(args);
            const agent = getOptionValue(options, 'agent') || null;
            const model = getOptionValue(options, 'model') || null;
            const workload = getOptionValue(options, 'workload') || 'both';
            const runs = parseInt(getOptionValue(options, 'runs') || runner.DEFAULT_RUNS, 10);
            const repoPath = process.cwd();

            if (options.report && !options.all && !agent && !model) {
                const matrixPath = path.join(runner.benchmarksDir(repoPath), 'matrix.json');
                if (!fs.existsSync(matrixPath)) {
                    console.error('❌ No aigon-eval matrix found. Run `aigon eval` first.');
                    process.exitCode = 1;
                    return;
                }
                console.log(renderReport(JSON.parse(fs.readFileSync(matrixPath, 'utf8'))));
                return;
            }

            const pairs = options.all
                ? collectActivePairs(agent, model)
                : collectActivePairs(agent, model).slice(0, 1);

            if (pairs.length === 0) {
                console.error('❌ No active non-quarantined (agent, model) pairs matched.');
                process.exitCode = 1;
                return;
            }
            if (!options.all && !agent) {
                console.error('❌ Usage: aigon eval --agent <id> [--model <id>] [--workload feature|research|both] [--runs N]');
                process.exitCode = 1;
                return;
            }

            console.log(`aigon-eval: ${pairs.length} pair(s), workload=${workload}, runs=${Number.isFinite(runs) ? runs : runner.DEFAULT_RUNS}`);
            const { results, matrix } = await runner.runEvaluationMatrix({
                repoPath,
                pairs,
                workload,
                runs: Number.isFinite(runs) ? runs : runner.DEFAULT_RUNS,
                slaSeconds: getOptionValue(options, 'sla-seconds') || undefined,
            });
            updateQuarantineForMatrix(matrix);
            results.forEach(result => {
                console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.agent}/${result.model || '-'} ${result.workload} -> ${path.relative(repoPath, result.path)}`);
            });
            console.log(`Matrix: ${path.relative(repoPath, path.join(runner.benchmarksDir(repoPath), 'matrix.json'))}`);
            if (options.report) console.log('\n' + renderReport(matrix));
        },
    };
}

module.exports = {
    createAigonEvalCommands,
    collectActivePairs,
    updateQuarantineForMatrix,
    renderReport,
};
