#!/usr/bin/env node
// check-module-graph.js — require-graph cycle detection + declarative boundary rules.
// Pins existing violations in scripts/module-graph-baseline.json (ratchet: baseline only shrinks).
// Follows scripts/check-template-leaks.js precedent — runs in test:core.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'module-graph-baseline.json');
const SCAN_GLOBS = ['lib', 'aigon-cli.js'];

// --- Boundary rules (data, not scattered logic) ---

const RULES = [
    {
        id: 'agent-sessions-domain',
        description: 'agent-sessions domain files must not import worktree/workflow-core/dashboard/commands (F554)',
        check(fromFile, toFile) {
            if (!fromFile.startsWith('lib/agent-sessions/')) return null;
            if (fromFile.startsWith('lib/agent-sessions/hosts/')) return null;
            const forbidden = [
                'lib/worktree.js',
                'lib/workflow-core/',
                'lib/dashboard-server.js',
                'lib/dashboard-routes/',
                'lib/dashboard-actions/',
                'lib/dashboard-status-collector.js',
                'lib/dashboard-detail.js',
                'lib/dashboard-settings.js',
                'lib/commands/',
            ];
            for (const prefix of forbidden) {
                if (prefix.endsWith('/') ? toFile.startsWith(prefix) : toFile === prefix) {
                    return `${fromFile}->${toFile}`;
                }
            }
            return null;
        },
    },
    {
        id: 'workflow-core-barrel',
        description: 'outside workflow-core: import workflow-core only via index.js barrel (exceptions in baseline)',
        check(fromFile, toFile) {
            if (fromFile.startsWith('lib/workflow-core/')) return null;
            if (!toFile.startsWith('lib/workflow-core/')) return null;
            if (toFile === 'lib/workflow-core/index.js') return null;
            // Documented exception modules may import workflow-core internals directly.
            const exceptionModules = new Set([
                'lib/workflow-snapshot-adapter.js',
                'lib/spec-store/local-backend.js',
                'lib/spec-store/projection.js',
            ]);
            if (exceptionModules.has(fromFile)) return null;
            return `${fromFile}->${toFile}`;
        },
    },
    {
        id: 'dashboard-read-only',
        description: 'dashboard-server + dashboard-routes must not import file-format owners outside the allowlist',
        check(fromFile, toFile) {
            const isDashboard = fromFile === 'lib/dashboard-server.js'
                || fromFile.startsWith('lib/dashboard-routes/');
            if (!isDashboard) return null;
            const allowed = new Set([
                'lib/state-queries.js',
                'lib/workflow-snapshot-adapter.js',
                'lib/action-command-mapper.js',
                'lib/spec-reconciliation.js',
                'lib/agent-status.js',
                'lib/feature-spec-resolver.js',
                'lib/dashboard-status-collector.js',
            ]);
            if (allowed.has(toFile)) return null;
            const forbiddenOwners = [
                'lib/workflow-core/engine.js',
                'lib/workflow-core/event-store.js',
                'lib/workflow-core/snapshot-store.js',
                'lib/workflow-core/effects.js',
                'lib/spec-crud.js',
                'lib/workflow-read-model.js',
                'lib/analytics.js',
            ];
            if (forbiddenOwners.includes(toFile)) {
                return `${fromFile}->${toFile}`;
            }
            return null;
        },
    },
    {
        id: 'commands-one-way',
        description: 'lib domain modules must not import lib/commands/**',
        check(fromFile, toFile) {
            if (fromFile.startsWith('lib/commands/')) return null;
            if (!fromFile.startsWith('lib/')) return null;
            if (toFile.startsWith('lib/commands/')) {
                return `${fromFile}->${toFile}`;
            }
            return null;
        },
    },
    {
        id: 'dashboard-collect-boundary',
        description: 'dashboard-collect package must not import dashboard server shell or commands (F633)',
        check(fromFile, toFile) {
            if (!fromFile.startsWith('lib/dashboard-collect/')) return null;
            const forbidden = [
                'lib/dashboard-server.js',
                'lib/dashboard-routes/',
                'lib/dashboard-actions/',
                'lib/commands/',
            ];
            for (const prefix of forbidden) {
                if (prefix.endsWith('/') ? toFile.startsWith(prefix) : toFile === prefix) {
                    return `${fromFile}->${toFile}`;
                }
            }
            return null;
        },
    },
    {
        id: 'telemetry-boundary',
        description: 'telemetry providers must not import agent-registry or sibling providers (F634)',
        check(fromFile, toFile) {
            if (!fromFile.startsWith('lib/telemetry/providers/')) return null;
            if (fromFile.endsWith('/registry.js')) return null;
            if (toFile === 'lib/agent-registry.js' || toFile.startsWith('lib/telemetry/providers/')) {
                return `${fromFile}->${toFile}`;
            }
            return null;
        },
    },
];

// --- Graph construction ---

function listJsFiles() {
    const files = [];
    for (const entry of SCAN_GLOBS) {
        const abs = path.join(ROOT, entry);
        if (!fs.existsSync(abs)) continue;
        const stat = fs.statSync(abs);
        if (stat.isFile() && entry.endsWith('.js')) {
            files.push(entry.replace(/\\/g, '/'));
            continue;
        }
        if (!stat.isDirectory()) continue;
        walk(abs, entry);
    }
    return files.sort();

    function walk(dir, rel) {
        for (const name of fs.readdirSync(dir)) {
            const absChild = path.join(dir, name);
            const relChild = `${rel}/${name}`.replace(/\\/g, '/');
            const childStat = fs.statSync(absChild);
            if (childStat.isDirectory()) {
                walk(absChild, relChild);
            } else if (name.endsWith('.js')) {
                files.push(relChild);
            }
        }
    }
}

function resolveRequire(fromRel, reqPath) {
    if (!reqPath.startsWith('.')) return null;
    const fromDir = path.dirname(path.join(ROOT, fromRel));
    let resolved = path.resolve(fromDir, reqPath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        resolved = path.join(resolved, 'index.js');
    } else if (!resolved.endsWith('.js')) {
        if (fs.existsSync(resolved + '.js')) resolved += '.js';
        else if (fs.existsSync(path.join(resolved, 'index.js'))) {
            resolved = path.join(resolved, 'index.js');
        } else return null;
    }
    const rel = path.relative(ROOT, resolved).replace(/\\/g, '/');
    if (rel.startsWith('..')) return null;
    return rel;
}

const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function parseRequires(fileRel) {
    const src = fs.readFileSync(path.join(ROOT, fileRel), 'utf8');
    const edges = [];
    let dynamic = 0;
    let m;
    const staticRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = staticRe.exec(src)) !== null) {
        const target = resolveRequire(fileRel, m[1]);
        if (target) edges.push(target);
    }
    const dynamicRe = /\brequire\s*\(\s*(?!['"])/g;
    while (dynamicRe.exec(src) !== null) dynamic++;
    return { edges, dynamic };
}

function buildGraph(files) {
    const graph = new Map();
    let unanalyzable = 0;
    for (const file of files) {
        const { edges, dynamic } = parseRequires(file);
        unanalyzable += dynamic;
        graph.set(file, [...new Set(edges)]);
    }
    return { graph, unanalyzable };
}

// --- Cycle detection (Tarjan SCC + bounded enumeration per component) ---

function canonicalCycle(nodes) {
    const n = nodes.length;
    if (n === 0) return '';
    let best = null;
    let bestStart = nodes[0];
    for (let rot = 0; rot < n; rot++) {
        const rotated = [];
        for (let i = 0; i < n; i++) rotated.push(nodes[(rot + i) % n]);
        const key = rotated.join(' -> ');
        if (!best || key < best) {
            best = key;
            bestStart = rotated[0];
        }
    }
    return `${best} -> ${bestStart}`;
}

function tarjanScc(graph) {
    let index = 0;
    const stack = [];
    const onStack = new Set();
    const indices = new Map();
    const lowlink = new Map();
    const sccs = [];

    function strongConnect(v) {
        indices.set(v, index);
        lowlink.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);

        for (const w of graph.get(v) || []) {
            if (!indices.has(w)) {
                strongConnect(w);
                lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
            } else if (onStack.has(w)) {
                lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
            }
        }

        if (lowlink.get(v) === indices.get(v)) {
            const component = [];
            let w;
            do {
                w = stack.pop();
                onStack.delete(w);
                component.push(w);
            } while (w !== v);
            sccs.push(component);
        }
    }

    for (const v of graph.keys()) {
        if (!indices.has(v)) strongConnect(v);
    }
    return sccs;
}

function shortestCycleFrom(graph, start, member) {
    const queue = [[start, [start], new Set([start])]];

    while (queue.length) {
        const [node, path, seen] = queue.shift();
        for (const next of graph.get(node) || []) {
            if (!member.has(next)) continue;
            if (next === start && path.length > 1) return path;
            if (!seen.has(next)) {
                const nextSeen = new Set(seen);
                nextSeen.add(next);
                queue.push([next, [...path, next], nextSeen]);
            }
        }
    }
    return null;
}

function findCycles(graph) {
    const sccs = tarjanScc(graph).filter(c => c.length > 1);
    const cycles = new Set();

    for (const component of sccs) {
        const member = new Set(component);
        for (const start of component) {
            const path = shortestCycleFrom(graph, start, member);
            if (path && path.length > 1) {
                cycles.add(canonicalCycle(path));
            }
        }
    }
    return [...cycles].sort();
}

function cyclesByHub(cycles) {
    const hubCounts = new Map();
    for (const cycle of cycles) {
        const parts = cycle.split(' -> ').slice(0, -1);
        for (const part of parts) {
            hubCounts.set(part, (hubCounts.get(part) || 0) + 1);
        }
    }
    return [...hubCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
}

// --- Boundary violations ---

function findViolations(graph) {
    const violations = [];
    for (const [fromFile, targets] of graph) {
        for (const toFile of targets) {
            for (const rule of RULES) {
                const hit = rule.check(fromFile, toFile);
                if (hit) violations.push(`${rule.id}:${hit}`);
            }
        }
    }
    return [...new Set(violations)].sort();
}

// --- Baseline ratchet ---

function loadBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) {
        return { cycles: [], violations: [] };
    }
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function diffBaseline(current, baseline) {
    const curCycles = new Set(current.cycles);
    const baseCycles = new Set(baseline.cycles || []);
    const curViol = new Set(current.violations);
    const baseViol = new Set(baseline.violations || []);

    const newCycles = [...curCycles].filter(c => !baseCycles.has(c));
    const staleCycles = [...baseCycles].filter(c => !curCycles.has(c));
    const newViol = [...curViol].filter(v => !baseViol.has(v));
    const staleViol = [...baseViol].filter(v => !curViol.has(v));

    return { newCycles, staleCycles, newViol, staleViol };
}

function analyze() {
    const files = listJsFiles();
    const { graph, unanalyzable } = buildGraph(files);
    const cycles = findCycles(graph);
    const violations = findViolations(graph);
    return { files: files.length, unanalyzable, cycles, violations, graph };
}

// REGRESSION F636: AGENTS.md module-map paths must exist on disk (path-existence only).
function findMissingAgentsMdModulePaths() {
    const agentsPath = path.join(ROOT, 'AGENTS.md');
    if (!fs.existsSync(agentsPath)) return [];
    const text = fs.readFileSync(agentsPath, 'utf8');
    const tableStart = text.indexOf('## Module Map');
    if (tableStart === -1) return [];
    const afterHeader = text.slice(tableStart);
    const nextHeader = afterHeader.slice(1).search(/^##\s+/m);
    const tableSection = nextHeader === -1 ? afterHeader : afterHeader.slice(0, nextHeader + 1);
    const missing = [];
    const rowRe = /^\|\s*(.*?)\s*\|/gm;
    let match;
    while ((match = rowRe.exec(tableSection)) !== null) {
        const cell = match[1];
        const paths = [];
        const codeRe = /`((?:lib|aigon-cli\.js)[^`]+)`/g;
        let codeMatch;
        while ((codeMatch = codeRe.exec(cell)) !== null) {
            paths.push(codeMatch[1].trim());
        }
        for (const modPath of paths) {
            const normalized = modPath.replace(/\\/g, '/');
            // Skip directory-only rows (e.g. lib/dashboard-collect/)
            if (normalized.endsWith('/')) continue;
            const abs = path.join(ROOT, normalized);
            if (!fs.existsSync(abs)) {
                missing.push(normalized);
            }
        }
    }
    return [...new Set(missing)];
}

function printReport(result) {
    const { files, unanalyzable, cycles, violations } = result;
    console.log(`Module graph: ${files} files, ${unanalyzable} dynamic require() sites`);
    console.log(`Cycles: ${cycles.length}`);
    console.log(`Boundary violations: ${violations.length}`);
    console.log('\nTop cycle hubs:');
    for (const [hub, count] of cyclesByHub(cycles)) {
        console.log(`  ${count.toString().padStart(4)}  ${hub}`);
    }
    if (violations.length) {
        console.log('\nViolations by rule:');
        const byRule = new Map();
        for (const v of violations) {
            const rule = v.split(':')[0];
            byRule.set(rule, (byRule.get(rule) || 0) + 1);
        }
        for (const [rule, count] of [...byRule.entries()].sort()) {
            console.log(`  ${count.toString().padStart(4)}  ${rule}`);
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    const reportMode = args.includes('--report');
    const writeBaseline = args.includes('--write-baseline');

    const result = analyze();

    if (writeBaseline) {
        const payload = {
            cycles: result.cycles,
            violations: result.violations,
        };
        fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
        console.log(`Wrote baseline: ${result.cycles.length} cycles, ${result.violations.length} violations`);
        return;
    }

    if (reportMode) {
        printReport(result);
        const baseline = loadBaseline();
        const diff = diffBaseline(result, baseline);
        console.log('\nBaseline delta:');
        console.log(`  new cycles: ${diff.newCycles.length}`);
        console.log(`  fixed cycles (shrink): ${diff.staleCycles.length}`);
        console.log(`  new violations: ${diff.newViol.length}`);
        console.log(`  fixed violations (shrink): ${diff.staleViol.length}`);
        return;
    }

    const baseline = loadBaseline();
    const diff = diffBaseline(result, baseline);
    const failures = [];

    const missingAgentsPaths = findMissingAgentsMdModulePaths();
    for (const p of missingAgentsPaths) {
        failures.push(`AGENTS.md module map path missing: ${p}`);
    }

    for (const c of diff.newCycles) failures.push(`NEW CYCLE: ${c}`);
    for (const c of diff.staleCycles) failures.push(`STALE BASELINE CYCLE (fixed — update baseline): ${c}`);
    for (const v of diff.newViol) failures.push(`NEW VIOLATION: ${v}`);
    for (const v of diff.staleViol) failures.push(`STALE BASELINE VIOLATION (fixed — update baseline): ${v}`);

    if (failures.length) {
        console.error('Module graph check failed:\n');
        for (const f of failures) console.error(`  ${f}`);
        console.error(`\n${result.cycles.length} cycles, ${result.violations.length} violations total.`);
        console.error('Run: node scripts/check-module-graph.js --report');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    RULES,
    listJsFiles,
    resolveRequire,
    buildGraph,
    findCycles,
    findViolations,
    canonicalCycle,
    diffBaseline,
    analyze,
    findMissingAgentsMdModulePaths,
};
