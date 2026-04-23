'use strict';

const path = require('path');
const featureSets = require('../feature-sets');
const { parseCliOptions } = require('../cli-parse');
const setConductor = require('../set-conductor');
const { readSetAutoState } = require('../auto-session-state');

function padCell(value, width) {
    const s = String(value);
    if (s.length >= width) return s;
    return s + ' '.repeat(width - s.length);
}

function printTable(rows) {
    if (rows.length === 0) return;
    const widths = rows[0].map((_, col) => rows.reduce((max, row) => Math.max(max, String(row[col] ?? '').length), 0));
    rows.forEach((row, i) => {
        const line = row.map((cell, col) => padCell(cell ?? '', widths[col])).join('  ').trimEnd();
        console.log(line);
        if (i === 0) console.log(widths.map(w => '-'.repeat(w)).join('  '));
    });
}

function handleList(options) {
    const summaries = featureSets.summarizeSets();
    const showAll = Boolean(options.all);
    const visible = showAll ? summaries : summaries.filter(s => !s.isComplete);

    if (options.json) {
        console.log(JSON.stringify(visible, null, 2));
        return;
    }

    if (summaries.length === 0) {
        console.log('No feature sets found. Tag a spec with `set: <slug>` in its frontmatter to create one.');
        return;
    }

    if (visible.length === 0) {
        console.log('All feature sets are complete. Re-run with --all to include them.');
        return;
    }

    const header = ['SLUG', 'MEMBERS', 'DONE', 'INBOX', 'BACKLOG', 'IN-PROG', 'EVAL', 'PAUSED', 'LAST UPDATED'];
    const rows = [header];
    for (const s of visible) {
        rows.push([
            s.slug,
            `${s.completed}/${s.memberCount}`,
            String(s.counts.done || 0),
            String(s.counts.inbox || 0),
            String(s.counts.backlog || 0),
            String(s.counts['in-progress'] || 0),
            String(s.counts['in-evaluation'] || 0),
            String(s.counts.paused || 0),
            s.lastUpdatedAt ? s.lastUpdatedAt.slice(0, 10) : '—',
        ]);
    }
    printTable(rows);
    if (!showAll) {
        const hiddenComplete = summaries.length - visible.length;
        if (hiddenComplete > 0) {
            console.log(`\n(${hiddenComplete} completed set${hiddenComplete === 1 ? '' : 's'} hidden — add --all to show.)`);
        }
    }
}

function handleShow(args, options) {
    const slug = args[0];
    if (!slug) {
        console.error('Usage: aigon set show <slug> [--json]');
        process.exitCode = 1;
        return;
    }

    if (!featureSets.isValidSetSlug(slug)) {
        console.error(`❌ Invalid set slug: "${slug}"`);
        console.error('   Slugs must match [a-z0-9][a-z0-9-]* (no slashes or whitespace).');
        process.exitCode = 1;
        return;
    }

    const members = featureSets.getSetMembersSorted(slug);
    const edges = featureSets.getSetDependencyEdges(slug);
    const autoState = readSetAutoState(process.cwd(), slug);

    if (options.json) {
        console.log(JSON.stringify({
            slug,
            members: members.map(m => ({
                id: m.paddedId,
                slug: m.slug,
                stage: m.stage,
                specPath: m.fullPath,
            })),
            dependencies: edges,
            autonomous: autoState || null,
        }, null, 2));
        return;
    }

    if (members.length === 0) {
        console.log(`No features tagged with set: ${slug}`);
        return;
    }

    const failedFeature = autoState && autoState.failedFeature ? String(autoState.failedFeature) : null;
    const failedSet = new Set(Array.isArray(autoState && autoState.failed) ? autoState.failed.map(String) : []);
    const completedSet = new Set(Array.isArray(autoState && autoState.completed) ? autoState.completed.map(String) : []);

    const isPaused = autoState && autoState.status === 'paused-on-failure';
    if (isPaused) {
        const pausedAt = autoState.endedAt ? ` at ${autoState.endedAt.slice(0, 19).replace('T', ' ')}` : '';
        const failLabel = failedFeature ? ` (feature #${parseInt(failedFeature, 10) || failedFeature})` : '';
        console.log(`⚠️  Set paused on failure${failLabel}${pausedAt}`);
        console.log(`   Run: aigon set-autonomous-resume ${slug}   (after fixing the failing feature)\n`);
    }

    console.log(`Set: ${slug}`);
    console.log(`Members: ${members.length} (topological order)\n`);

    const rows = [['ID', 'STAGE', 'FEATURE', 'STATUS', 'DEPS']];
    for (const m of members) {
        const id = m.paddedId ? `#${m.paddedId}` : '—';
        const deps = edges.filter(e => e.from === m.paddedId).map(e => `#${e.to}`).join(' ');
        let status = '';
        if (m.paddedId) {
            if (completedSet.has(m.paddedId)) status = '✓ done';
            else if (failedSet.has(m.paddedId)) status = '✗ failed';
            else if (autoState && autoState.currentFeature === m.paddedId) status = '▶ running';
        }
        rows.push([id, m.stage, m.slug, status, deps || '']);
    }
    printTable(rows);

    if (edges.length > 0) {
        console.log('\nIntra-set dependencies:');
        for (const edge of edges) {
            console.log(`  #${edge.from} → #${edge.to}`);
        }
    }
}

function printHelp() {
    console.log('Feature sets — group related features by a shared `set:` frontmatter slug.');
    console.log('');
    console.log('Usage:');
    console.log('  aigon set list [--all] [--json]');
    console.log('  aigon set show <slug> [--json]');
    console.log('  aigon set-autonomous-start <slug> [agents...] [--mode=sequential] [--review-agent=<agent>] [--stop-after=close]');
    console.log('  aigon set-autonomous-stop <slug>');
    console.log('  aigon set-autonomous-resume <slug>');
    console.log('  aigon set-autonomous-reset <slug>');
    console.log('');
    console.log('Tag a spec by adding `set: <slug>` to its YAML frontmatter.');
    console.log('Set list/show state is derived from member workflow state.');
}

function createSetCommands() {
    return {
        set: (rawArgs) => {
            const options = parseCliOptions(rawArgs || []);
            const subcommand = options._[0];
            const rest = options._.slice(1);
            switch (subcommand) {
                case 'list':
                case 'ls':
                    return handleList(options);
                case 'show':
                case 'info':
                    return handleShow(rest, options);
                case undefined:
                case 'help':
                case '--help':
                case '-h':
                    return printHelp();
                default:
                    console.error(`Unknown set subcommand: ${subcommand}`);
                    console.error('Try: aigon set help');
                    process.exitCode = 1;
                    return;
            }
        },
        'set-autonomous-start': (rawArgs) => setConductor.run('set-autonomous-start', rawArgs || []),
        'set-autonomous-stop': (rawArgs) => setConductor.run('set-autonomous-stop', rawArgs || []),
        'set-autonomous-resume': (rawArgs) => setConductor.run('set-autonomous-resume', rawArgs || []),
        'set-autonomous-reset': (rawArgs) => setConductor.run('set-autonomous-reset', rawArgs || []),
    };
}

module.exports = { createSetCommands };
