'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { test, withTempDir, report } = require('../_helpers');
const {
    PROJECT_EXCLUDES,
    SETTINGS_STRIPPED_KEYS,
    applyTelemetryRetention,
    diffIndexes,
    pull,
    push,
} = require('../../lib/backup');
const { mergeJsonlByTimestamp } = require('../../lib/sync-merge');

function daysAgoMs(days) {
    return Date.now() - days * 24 * 60 * 60 * 1000;
}

function writeJsonFile(fp, obj) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(obj) + '\n', 'utf8');
}

// REGRESSION: telemetry must remain included in backup scope while sessions/locks stay excluded.
test('PROJECT_EXCLUDES keeps telemetry included and sessions/locks excluded', () => {
    assert.ok(!PROJECT_EXCLUDES.has('telemetry'));
    assert.ok(PROJECT_EXCLUDES.has('sessions'));
    assert.ok(PROJECT_EXCLUDES.has('locks'));
});

// REGRESSION: one machine's vault remote and schedule must never be backed up as portable settings.
test('backup configuration is machine-local', () => {
    assert.ok(SETTINGS_STRIPPED_KEYS.includes('backup'));
});

// REGRESSION: restore planning must distinguish incoming, changed, and stale managed files.
test('diffIndexes reports exact restore changes', () => {
    const diff = diffIndexes(
        { 'workflows/1.json': 'old', 'workflows/stale.json': 'stale' },
        { 'workflows/1.json': 'new', 'workflows/2.json': 'added' }
    );
    assert.deepStrictEqual(diff.added, ['workflows/2.json']);
    assert.deepStrictEqual(diff.changed, ['workflows/1.json']);
    assert.deepStrictEqual(diff.removed, ['workflows/stale.json']);
});

// REGRESSION: a pull used to overlay state, retain stale workflows, restore another machine's
// schedule, and let dashboard startup immediately push the mixed result back to the vault.
test('pull dry-run is read-only; real pull archives, mirrors, preserves runtime state, and disables schedule', () => withTempDir('backup-pull-', (dir) => {
    const previousHome = process.env.AIGON_HOME;
    const fakeHome = path.join(dir, 'home');
    const aigonHome = path.join(fakeHome, '.aigon');
    const projectName = 'backup-restore-fixture';
    const project = path.join(dir, projectName);
    const remote = path.join(dir, 'vault.git');
    const seed = path.join(dir, 'vault-seed');
    try {
        process.env.AIGON_HOME = fakeHome;
        execFileSync('git', ['init', project], { stdio: 'ignore' });
        execFileSync('git', ['-C', project, 'config', 'user.email', 'test@example.com']);
        execFileSync('git', ['-C', project, 'config', 'user.name', 'Backup Test']);
        writeJsonFile(path.join(project, '.aigon', 'context', 'tracked.json'), { version: 'new-from-git' });
        execFileSync('git', ['-C', project, 'add', '.aigon/context/tracked.json']);
        execFileSync('git', ['-C', project, 'commit', '-m', 'tracked state'], { stdio: 'ignore' });
        writeJsonFile(path.join(project, '.aigon', 'workflows', 'features', 'stale', 'snapshot.json'), { id: 'stale' });
        writeJsonFile(path.join(project, '.aigon', 'sessions', 'live.json'), { session: 'keep' });
        writeJsonFile(path.join(aigonHome, 'config.json'), {
            repos: [project],
            backup: { remote, schedule: 'daily' },
            defaultAgent: 'cc',
        });

        execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
        execFileSync('git', ['init', seed], { stdio: 'ignore' });
        execFileSync('git', ['-C', seed, 'config', 'user.email', 'test@example.com']);
        execFileSync('git', ['-C', seed, 'config', 'user.name', 'Backup Test']);
        writeJsonFile(path.join(seed, 'projects', projectName, 'workflows', 'features', 'fresh', 'snapshot.json'), { id: 'fresh' });
        writeJsonFile(path.join(seed, 'projects', projectName, 'context', 'tracked.json'), { version: 'old-from-vault' });
        writeJsonFile(path.join(seed, 'projects', projectName, 'sessions', 'remote.json'), { session: 'do-not-restore' });
        writeJsonFile(path.join(seed, 'settings', 'config.json'), {
            backup: { remote: 'wrong', schedule: 'weekly' },
            defaultAgent: 'cx',
        });
        execFileSync('git', ['-C', seed, 'add', '-A']);
        execFileSync('git', ['-C', seed, 'commit', '-m', 'seed'], { stdio: 'ignore' });
        execFileSync('git', ['-C', seed, 'branch', '-M', 'main']);
        execFileSync('git', ['-C', seed, 'remote', 'add', 'origin', remote]);
        execFileSync('git', ['-C', seed, 'push', '-u', 'origin', 'main'], { stdio: 'ignore' });

        const dryRun = pull({ dryRun: true });
        assert.strictEqual(dryRun.dryRun, true);
        assert.ok(!dryRun.plan.projects[0].diff.changed.includes('context/tracked.json'));
        assert.ok(fs.existsSync(path.join(project, '.aigon', 'workflows', 'features', 'stale', 'snapshot.json')));
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(aigonHome, 'config.json'), 'utf8')).backup.schedule, 'daily');

        const restored = pull();
        assert.ok(fs.existsSync(path.join(project, '.aigon', 'workflows', 'features', 'fresh', 'snapshot.json')));
        assert.ok(!fs.existsSync(path.join(project, '.aigon', 'workflows', 'features', 'stale', 'snapshot.json')));
        assert.ok(fs.existsSync(path.join(project, '.aigon', 'sessions', 'live.json')));
        assert.ok(!fs.existsSync(path.join(project, '.aigon', 'sessions', 'remote.json')));
        assert.deepStrictEqual(
            JSON.parse(fs.readFileSync(path.join(project, '.aigon', 'context', 'tracked.json'), 'utf8')),
            { version: 'new-from-git' }
        );
        assert.ok(fs.existsSync(path.join(restored.archiveRoot, 'projects', projectName, 'workflows', 'features', 'stale', 'snapshot.json')));
        const archivedConfig = JSON.parse(fs.readFileSync(path.join(restored.archiveRoot, 'settings', 'config.json'), 'utf8'));
        assert.strictEqual(archivedConfig.backup.schedule, 'daily');
        const config = JSON.parse(fs.readFileSync(path.join(aigonHome, 'config.json'), 'utf8'));
        assert.strictEqual(config.defaultAgent, 'cx');
        assert.strictEqual(config.backup.remote, remote);
        assert.strictEqual(config.backup.schedule, 'off');
    } finally {
        if (previousHome === undefined) delete process.env.AIGON_HOME;
        else process.env.AIGON_HOME = previousHome;
    }
}));

// REGRESSION: pushing from a machine with only some Vault projects used to erase every
// remote project snapshot that was not cloned and registered on that machine.
test('push refreshes local projects without deleting unavailable remote projects', () => withTempDir('backup-push-', (dir) => {
    const previousHome = process.env.AIGON_HOME;
    const fakeHome = path.join(dir, 'home');
    const aigonHome = path.join(fakeHome, '.aigon');
    const project = path.join(dir, 'local-project');
    const remote = path.join(dir, 'vault.git');
    const seed = path.join(dir, 'vault-seed');
    try {
        process.env.AIGON_HOME = fakeHome;
        execFileSync('git', ['init', project], { stdio: 'ignore' });
        execFileSync('git', ['-C', project, 'config', 'user.email', 'test@example.com']);
        execFileSync('git', ['-C', project, 'config', 'user.name', 'Backup Test']);
        writeJsonFile(path.join(project, '.aigon', 'context', 'tracked.json'), { owner: 'git' });
        execFileSync('git', ['-C', project, 'add', '.aigon/context/tracked.json']);
        execFileSync('git', ['-C', project, 'commit', '-m', 'tracked state'], { stdio: 'ignore' });
        writeJsonFile(path.join(project, '.aigon', 'workflows', 'features', 'new.json'), { id: 'new' });
        writeJsonFile(path.join(aigonHome, 'config.json'), {
            repos: [project],
            backup: { remote, schedule: 'off' },
        });
        execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
        execFileSync('git', ['init', seed], { stdio: 'ignore' });
        execFileSync('git', ['-C', seed, 'config', 'user.email', 'test@example.com']);
        execFileSync('git', ['-C', seed, 'config', 'user.name', 'Backup Test']);
        writeJsonFile(path.join(seed, 'projects', 'unavailable-project', 'workflows', 'keep.json'), { id: 'keep' });
        execFileSync('git', ['-C', seed, 'add', '-A']);
        execFileSync('git', ['-C', seed, 'commit', '-m', 'seed'], { stdio: 'ignore' });
        execFileSync('git', ['-C', seed, 'branch', '-M', 'main']);
        execFileSync('git', ['-C', seed, 'remote', 'add', 'origin', remote]);
        execFileSync('git', ['-C', seed, 'push', '-u', 'origin', 'main'], { stdio: 'ignore' });

        push();
        const helper = path.join(aigonHome, '.vault', 'repo', 'projects');
        assert.ok(fs.existsSync(path.join(helper, 'unavailable-project', 'workflows', 'keep.json')));
        assert.ok(fs.existsSync(path.join(helper, 'local-project', 'workflows', 'features', 'new.json')));
        assert.ok(!fs.existsSync(path.join(helper, 'local-project', 'context', 'tracked.json')));
    } finally {
        if (previousHome === undefined) delete process.env.AIGON_HOME;
        else process.env.AIGON_HOME = previousHome;
    }
}));

// REGRESSION: retention compresses aged per-session telemetry and preserves recent files.
test('retention compress: per-session json older than compressAfterDays becomes .json.gz', () => withTempDir('backup-test-', (repo) => {
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-100-cc-abc.json');
    writeJsonFile(oldFile, { featureId: '100', endAt: new Date(daysAgoMs(91)).toISOString() });

    const newFile = path.join(telDir, 'feature-100-cc-def.json');
    writeJsonFile(newFile, { featureId: '100', endAt: new Date(daysAgoMs(10)).toISOString() });

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile));
    assert.ok(fs.existsSync(oldFile + '.gz'));
    const decompressed = zlib.gunzipSync(fs.readFileSync(oldFile + '.gz')).toString('utf8');
    assert.strictEqual(JSON.parse(decompressed).featureId, '100');
    assert.ok(fs.existsSync(newFile));
    assert.ok(!fs.existsSync(newFile + '.gz'));
}));

// REGRESSION: retention drop deletes telemetry older than dropAfterDays.
test('retention drop: per-session json older than dropAfterDays is deleted', () => withTempDir('backup-test-', (repo) => {
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-200-cc-xyz.json');
    writeJsonFile(oldFile, { featureId: '200', endAt: new Date(daysAgoMs(400)).toISOString() });

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile));
    assert.ok(!fs.existsSync(oldFile + '.gz'));
}));

// REGRESSION: null dropAfterDays must leave telemetry untouched like other disable paths.
test('retention disabled when dropAfterDays=null', () => withTempDir('backup-test-', (repo) => {
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-400-cc-bbb.json');
    writeJsonFile(oldFile, { featureId: '400', endAt: new Date(daysAgoMs(400)).toISOString() });

    applyTelemetryRetention(repo, { compressAfterDays: null, dropAfterDays: null });

    assert.ok(fs.existsSync(oldFile));
}));

// REGRESSION: retention can be disabled without mutating existing telemetry files.
test('retention disabled when compressAfterDays=0', () => withTempDir('backup-test-', (repo) => {
    const telDir = path.join(repo, '.aigon', 'telemetry');
    fs.mkdirSync(telDir, { recursive: true });

    const oldFile = path.join(telDir, 'feature-300-cc-aaa.json');
    writeJsonFile(oldFile, { featureId: '300', endAt: new Date(daysAgoMs(200)).toISOString() });

    applyTelemetryRetention(repo, { compressAfterDays: 0, dropAfterDays: 0 });

    assert.ok(fs.existsSync(oldFile));
    assert.ok(!fs.existsSync(oldFile + '.gz'));
}));

// REGRESSION: signal-health jsonl retention compresses aged daily files by filename date.
test('retention: signal-health jsonl older than compressAfterDays becomes .jsonl.gz', () => withTempDir('backup-test-', (repo) => {
    const shDir = path.join(repo, '.aigon', 'telemetry', 'signal-health');
    fs.mkdirSync(shDir, { recursive: true });

    const oldDate = new Date(daysAgoMs(100));
    const oldFile = path.join(shDir, `${oldDate.toISOString().slice(0, 10)}.jsonl`);
    fs.writeFileSync(oldFile, '{"t":"2025-01-01T00:00:00Z","type":"nudge"}\n', 'utf8');

    const recentDate = new Date(daysAgoMs(5));
    const recentFile = path.join(shDir, `${recentDate.toISOString().slice(0, 10)}.jsonl`);
    fs.writeFileSync(recentFile, '{"t":"2026-04-24T00:00:00Z","type":"nudge"}\n', 'utf8');

    applyTelemetryRetention(repo);

    assert.ok(!fs.existsSync(oldFile));
    assert.ok(fs.existsSync(oldFile + '.gz'));
    assert.ok(fs.existsSync(recentFile));
}));

// REGRESSION: sync merge must union jsonl events, sort by timestamp, and deduplicate.
test('mergeJsonlByTimestamp: union + sort by t + dedup', () => withTempDir('backup-test-', (dir) => {
    const local = path.join(dir, 'local.jsonl');
    const imported = path.join(dir, 'imported.jsonl');

    const e1 = JSON.stringify({ t: '2026-04-29T10:00:00Z', type: 'a' });
    const e2 = JSON.stringify({ t: '2026-04-29T09:00:00Z', type: 'b' });
    const e3 = JSON.stringify({ t: '2026-04-29T11:00:00Z', type: 'c' });

    fs.writeFileSync(local, `${e1}\n${e2}\n`, 'utf8');
    fs.writeFileSync(imported, `${e1}\n${e3}\n`, 'utf8');

    mergeJsonlByTimestamp(local, imported);

    const parsed = fs.readFileSync(local, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.strictEqual(parsed.length, 3);
    assert.strictEqual(parsed[0].type, 'b');
    assert.strictEqual(parsed[1].type, 'a');
    assert.strictEqual(parsed[2].type, 'c');
}));

// REGRESSION: jsonl merge must tolerate non-JSON lines without throwing.
test('mergeJsonlByTimestamp: falls back gracefully for non-JSON lines', () => withTempDir('backup-test-', (dir) => {
    const local = path.join(dir, 'local.jsonl');
    const imported = path.join(dir, 'imported.jsonl');

    fs.writeFileSync(local, 'not-json\n{"t":"2026-01-01T00:00:00Z","x":1}\n', 'utf8');
    fs.writeFileSync(imported, '{"t":"2025-12-31T00:00:00Z","x":2}\n', 'utf8');

    assert.doesNotThrow(() => mergeJsonlByTimestamp(local, imported));
    assert.ok(fs.readFileSync(local, 'utf8').split('\n').filter(Boolean).length >= 2);
}));

report();
