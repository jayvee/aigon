#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');
const {
    getISOWeek,
    getISOMonth,
    getISOQuarter,
    listRecurringStatus,
    markRecurringInstanceDeleted,
} = require('../../lib/recurring');

const FEATURE_FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function git(root, args) {
    return execFileSync('git', args, {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function initRepo(root) {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'test@aigon.test']);
    git(root, ['config', 'user.name', 'Aigon Test']);
    fs.writeFileSync(path.join(root, '.gitkeep'), '');
    git(root, ['add', '.gitkeep']);
    git(root, ['commit', '-m', 'chore: init']);
    for (const folder of FEATURE_FOLDERS) {
        fs.mkdirSync(path.join(root, 'docs', 'specs', 'features', folder), { recursive: true });
    }
    fs.mkdirSync(path.join(root, 'docs', 'specs', 'recurring'), { recursive: true });
}

function runCli(root, args) {
    const cli = path.join(__dirname, '..', '..', 'aigon-cli.js');
    const result = spawnSync('node', [cli, ...args], {
        cwd: root,
        env: { ...process.env, ...GIT_SAFE_ENV },
        encoding: 'utf8',
    });
    return { code: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function writeTemplate(root, { slug, schedule, pattern }) {
    const content = [
        '---',
        `schedule: ${schedule}`,
        `name_pattern: "${pattern}"`,
        `recurring_slug: ${slug}`,
        'complexity: low',
        '---',
        '',
        `# ${pattern}`,
        '',
        'Recurring test task.',
        '',
    ].join('\n');
    fs.writeFileSync(path.join(root, 'docs', 'specs', 'recurring', `${slug}.md`), content);
}

function seedRecurringFeature(root, { name, slug, periodField, period }) {
    const content = [
        '---',
        'complexity: low',
        `recurring_slug: ${slug}`,
        `${periodField}: ${period}`,
        `recurring_template: ${slug}.md`,
        '---',
        '',
        `# Feature: ${name}`,
        '',
    ].join('\n');
    const inboxPath = path.join(root, 'docs', 'specs', 'features', '01-inbox', `feature-${name}.md`);
    fs.writeFileSync(inboxPath, content);
    git(root, ['add', path.relative(root, inboxPath)]);
    git(root, ['commit', '-m', `chore: seed ${name}`]);
    const prioritise = runCli(root, ['feature-prioritise', name]);
    assert.strictEqual(prioritise.code, 0, prioritise.stdout + prioritise.stderr);
    const file = fs.readdirSync(path.join(root, 'docs', 'specs', 'features', '02-backlog'))
        .find(candidate => candidate.endsWith(`-${name}.md`));
    assert.ok(file, `missing prioritised spec for ${name}`);
    return file.match(/^feature-(\d+)-/)[1];
}

// REGRESSION: Deleting a generated recurring instance used to make its template
// immediately due, so the dashboard server recreated the deleted feature.
test('feature-delete skips the exact weekly, monthly, and quarterly periods', () => withTempDir('aigon-recurring-delete-', (root) => {
    initRepo(root);
    const cases = [
        { slug: 'weekly-maintenance', schedule: 'weekly', pattern: 'weekly-maintenance-{{YYYY-WW}}', periodField: 'recurring_week', stateField: 'lastWeek', period: getISOWeek() },
        { slug: 'monthly-maintenance', schedule: 'monthly', pattern: 'monthly-maintenance-{{YYYY-MM}}', periodField: 'recurring_month', stateField: 'lastMonth', period: getISOMonth() },
        { slug: 'quarterly-maintenance', schedule: 'quarterly', pattern: 'quarterly-maintenance-{{YYYY-Q}}', periodField: 'recurring_quarter', stateField: 'lastQuarter', period: getISOQuarter() },
    ];
    for (const item of cases) writeTemplate(root, item);
    git(root, ['add', 'docs/specs/recurring/']);
    git(root, ['commit', '-m', 'chore: add recurring templates']);

    for (const item of cases) {
        const id = seedRecurringFeature(root, {
            ...item,
            name: `${item.slug}-current`,
        });
        const deleted = runCli(root, ['feature-delete', id]);
        assert.strictEqual(deleted.code, 0, deleted.stdout + deleted.stderr);
        assert.match(deleted.stdout, new RegExp(`Skipped ${item.slug} for ${item.period}`));
    }

    const state = JSON.parse(fs.readFileSync(path.join(root, '.aigon', 'recurring-state.json'), 'utf8'));
    for (const item of cases) {
        assert.strictEqual(state[item.slug][item.stateField], item.period);
        assert.match(state[item.slug].deletedAt, /^\d{4}-\d{2}-\d{2}T/);
    }

    const rerun = runCli(root, ['recurring-run']);
    assert.strictEqual(rerun.code, 0, rerun.stdout + rerun.stderr);
    assert.match(rerun.stdout, /Created: 0/);
    const backlogDir = path.join(root, 'docs', 'specs', 'features', '02-backlog');
    assert.ok(!fs.existsSync(backlogDir) || fs.readdirSync(backlogDir).length === 0);
}));

// REGRESSION: A deletion tombstone must cover only its recorded cadence period,
// not disable future instances of the recurring template.
test('an older deleted period leaves the current period due', () => withTempDir('aigon-recurring-next-', (root) => {
    initRepo(root);
    writeTemplate(root, { slug: 'weekly-next', schedule: 'weekly', pattern: 'weekly-next-{{YYYY-WW}}' });
    markRecurringInstanceDeleted(root, [
        '---',
        'recurring_slug: weekly-next',
        'recurring_week: 2000-W01',
        '---',
    ].join('\n'));
    const [status] = listRecurringStatus(root);
    assert.strictEqual(status.isDue, true);
    assert.strictEqual(status.lastWeek, '2000-W01');
}));

// REGRESSION: If recurring state cannot be persisted, deleting the only open
// instance would allow the background runner to recreate it immediately.
test('feature-delete fails closed when recurring state is unwritable', () => withTempDir('aigon-recurring-delete-fail-', (root) => {
    initRepo(root);
    const id = seedRecurringFeature(root, {
        name: 'cannot-mark-delete',
        slug: 'cannot-mark',
        periodField: 'recurring_week',
        period: getISOWeek(),
    });
    const statePath = path.join(root, '.aigon', 'recurring-state.json');
    fs.mkdirSync(statePath, { recursive: true });
    const deleted = runCli(root, ['feature-delete', id]);
    assert.notStrictEqual(deleted.code, 0);
    assert.match(deleted.stderr, /Cannot delete recurring feature/);
    assert.ok(fs.readdirSync(path.join(root, 'docs', 'specs', 'features', '02-backlog'))
        .some(file => file.includes('cannot-mark-delete')));
}));

// REGRESSION: The background recurring runner used to stage the entire features
// tree and accidentally commit concurrent operator edits with the generated spec.
test('recurring-run commits only its generated spec', () => withTempDir('aigon-recurring-stage-', (root) => {
    initRepo(root);
    writeTemplate(root, { slug: 'weekly-stage', schedule: 'weekly', pattern: 'weekly-stage-{{YYYY-WW}}' });
    fs.writeFileSync(path.join(root, 'operator.txt'), 'original\n');
    git(root, ['add', 'docs/specs/recurring/', 'operator.txt']);
    git(root, ['commit', '-m', 'chore: seed recurring staging case']);
    fs.writeFileSync(path.join(root, 'operator.txt'), 'operator change\n');
    git(root, ['add', 'operator.txt']);

    const run = runCli(root, ['recurring-run']);
    assert.strictEqual(run.code, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /Created: 1/);
    const committed = git(root, ['show', '--pretty=format:', '--name-only', 'HEAD']);
    assert.match(committed, /feature-\d+-weekly-stage-/);
    assert.doesNotMatch(committed, /operator\.txt/);
    assert.strictEqual(git(root, ['diff', '--cached', '--name-only']), 'operator.txt');
}));

report();
