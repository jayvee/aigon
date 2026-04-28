'use strict';

/**
 * Versioned migration framework for Aigon state files.
 *
 * Each migration targets a specific version and receives a context object
 * with the repo path and helpers. The framework handles backup, execution,
 * validation, and automatic rollback on failure.
 *
 * Consumers register migrations via `registerMigration(version, migrateFn)`.
 * `runPendingMigrations(repoPath)` is called from `check-version` after update.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const featureSpecResolver = require('./feature-spec-resolver');
const workflowEngine = require('./workflow-core/engine');
const {
    parseSpecReviewSubject,
    extractSpecReviewerId,
    normalizeEntityId,
} = require('./spec-review-state');

// ---------------------------------------------------------------------------
// Migration registry — consumers call registerMigration() to add entries
// ---------------------------------------------------------------------------

const migrations = new Map(); // version string → { version, migrate: async (ctx) => void }

/**
 * Register a migration for a specific version.
 * @param {string} version - semver string (e.g. "2.52.0")
 * @param {function} migrateFn - async (ctx) => void, where ctx = { repoPath, workflowsDir, log }
 */
function registerMigration(version, migrateFn) {
    if (migrations.has(version)) {
        throw new Error(`Migration already registered for version ${version}`);
    }
    migrations.set(version, { version, migrate: migrateFn });
}

// ---------------------------------------------------------------------------
// Backup & restore
// ---------------------------------------------------------------------------

function getMigrationsDir(repoPath) {
    return path.join(repoPath, '.aigon', 'migrations');
}

function getVersionDir(repoPath, version) {
    return path.join(getMigrationsDir(repoPath), version);
}

/**
 * Create a tarball backup of .aigon/workflows/ into the version migration dir.
 * Returns the path to the backup tarball.
 */
function createBackup(repoPath, version) {
    const versionDir = getVersionDir(repoPath, version);
    fs.mkdirSync(versionDir, { recursive: true });

    const workflowsDir = path.join(repoPath, '.aigon', 'workflows');
    const backupPath = path.join(versionDir, 'backup.tar.gz');

    if (!fs.existsSync(workflowsDir)) {
        // Nothing to back up — create an empty tarball marker
        fs.writeFileSync(backupPath, '');
        return backupPath;
    }

    execSync(`tar -czf ${JSON.stringify(backupPath)} -C ${JSON.stringify(path.join(repoPath, '.aigon'))} workflows`, {
        stdio: 'pipe',
    });

    return backupPath;
}

/**
 * Restore .aigon/workflows/ from backup tarball.
 */
function restoreBackup(repoPath, version) {
    const versionDir = getVersionDir(repoPath, version);
    const backupPath = path.join(versionDir, 'backup.tar.gz');

    if (!fs.existsSync(backupPath)) {
        throw new Error(`No backup found at ${backupPath}`);
    }

    const workflowsDir = path.join(repoPath, '.aigon', 'workflows');
    // Empty backup means the repo had no workflows dir before migration, so
    // rollback must remove anything the failed migration created.
    const stat = fs.statSync(backupPath);
    if (stat.size === 0) {
        if (fs.existsSync(workflowsDir)) {
            fs.rmSync(workflowsDir, { recursive: true, force: true });
        }
        return;
    }

    if (fs.existsSync(workflowsDir)) {
        fs.rmSync(workflowsDir, { recursive: true, force: true });
    }

    execSync(`tar -xzf ${JSON.stringify(backupPath)} -C ${JSON.stringify(path.join(repoPath, '.aigon'))}`, {
        stdio: 'pipe',
    });
}

// ---------------------------------------------------------------------------
// Manifest & log helpers
// ---------------------------------------------------------------------------

function writeManifest(repoPath, version, manifest) {
    const manifestPath = path.join(getVersionDir(repoPath, version), 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

function readManifest(repoPath, version) {
    const manifestPath = path.join(getVersionDir(repoPath, version), 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function createLogger(repoPath, version) {
    const versionDir = getVersionDir(repoPath, version);
    fs.mkdirSync(versionDir, { recursive: true });
    const logPath = path.join(versionDir, 'migration.log');
    const entries = [];

    function log(message) {
        const entry = `[${new Date().toISOString()}] ${message}`;
        entries.push(entry);
        // Append immediately so partial logs survive crashes
        fs.appendFileSync(logPath, entry + '\n');
    }

    return { log, entries };
}

// ---------------------------------------------------------------------------
// Entity discovery — used by manifest to list migrated entities
// ---------------------------------------------------------------------------

function discoverEntities(repoPath) {
    const result = { features: [], research: [], feedback: [] };
    const workflowsDir = path.join(repoPath, '.aigon', 'workflows');

    for (const entityType of ['features', 'research']) {
        const entityDir = path.join(workflowsDir, entityType);
        if (!fs.existsSync(entityDir)) continue;
        try {
            const entries = fs.readdirSync(entityDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    result[entityType].push(entry.name);
                }
            }
        } catch (_) { /* non-fatal */ }
    }

    // Feedback uses spec folders, not workflow-core
    const feedbackRoot = path.join(repoPath, 'docs', 'specs', 'feedback');
    if (fs.existsSync(feedbackRoot)) {
        try {
            const stageDirs = fs.readdirSync(feedbackRoot, { withFileTypes: true })
                .filter(d => d.isDirectory());
            for (const stageDir of stageDirs) {
                const files = fs.readdirSync(path.join(feedbackRoot, stageDir.name));
                for (const file of files) {
                    if (file.startsWith('feedback-') && file.endsWith('.md')) {
                        result.feedback.push(file.replace('.md', ''));
                    }
                }
            }
        } catch (_) { /* non-fatal */ }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Validation — confirm state files parse as valid JSON after migration
// ---------------------------------------------------------------------------

function validateWorkflows(repoPath) {
    const errors = [];
    const workflowsDir = path.join(repoPath, '.aigon', 'workflows');
    if (!fs.existsSync(workflowsDir)) return errors;

    for (const entityType of ['features', 'research']) {
        const entityDir = path.join(workflowsDir, entityType);
        if (!fs.existsSync(entityDir)) continue;

        const entityIds = fs.readdirSync(entityDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        for (const id of entityIds) {
            const entityRoot = path.join(entityDir, id);
            for (const jsonFile of ['snapshot.json', 'stats.json']) {
                const filePath = path.join(entityRoot, jsonFile);
                if (!fs.existsSync(filePath)) continue;
                try {
                    JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch (e) {
                    errors.push(`${entityType}/${id}/${jsonFile}: ${e.message}`);
                }
            }
        }
    }

    return errors;
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

/**
 * Run a single migration for a given version.
 * - Creates backup before running
 * - Runs the migration function
 * - Validates state after migration
 * - Restores backup on failure
 * - Writes manifest and log throughout
 *
 * @param {string} repoPath - absolute path to the repo root
 * @param {string} version - version string for this migration
 * @param {function} migrateFn - async (ctx) => void
 * @param {string|null} [fromVersion] - version being upgraded from
 * @returns {{ status: string, manifest: object }}
 */
async function runMigration(repoPath, version, migrateFn, fromVersion = null) {
    // Idempotency check
    const existing = readManifest(repoPath, version);
    if (existing && existing.status === 'success') {
        return { status: 'skipped', manifest: existing };
    }

    const { log } = createLogger(repoPath, version);
    const entitiesBefore = discoverEntities(repoPath);

    log(`Starting migration to ${version}`);
    log(`Entities before: features=${entitiesBefore.features.length}, research=${entitiesBefore.research.length}, feedback=${entitiesBefore.feedback.length}`);

    // Create backup
    log('Creating backup of .aigon/workflows/');
    try {
        createBackup(repoPath, version);
        log('Backup created successfully');
    } catch (e) {
        log(`Backup failed: ${e.message}`);
        const manifest = {
            fromVersion,
            toVersion: version,
            migratedAt: new Date().toISOString(),
            status: 'failed',
            error: `Backup failed: ${e.message}`,
            entities: entitiesBefore,
        };
        writeManifest(repoPath, version, manifest);
        return { status: 'failed', manifest };
    }

    // Run migration
    const ctx = {
        repoPath,
        workflowsDir: path.join(repoPath, '.aigon', 'workflows'),
        log,
    };

    try {
        log('Running migration function');
        await migrateFn(ctx);
        log('Migration function completed');

        // Validate
        log('Validating state files');
        const errors = validateWorkflows(repoPath);
        if (errors.length > 0) {
            throw new Error(`Validation failed:\n  ${errors.join('\n  ')}`);
        }
        log('Validation passed');

        const entitiesAfter = discoverEntities(repoPath);
        const manifest = {
            fromVersion,
            toVersion: version,
            migratedAt: new Date().toISOString(),
            status: 'success',
            entities: {
                features: { migrated: entitiesAfter.features, skipped: [] },
                research: { migrated: entitiesAfter.research, skipped: [] },
                feedback: { migrated: entitiesAfter.feedback, skipped: [] },
            },
        };
        writeManifest(repoPath, version, manifest);
        log('Migration completed successfully');

        return { status: 'success', manifest };
    } catch (e) {
        log(`Migration failed: ${e.message}`);
        log('Restoring from backup');

        try {
            restoreBackup(repoPath, version);
            log('Backup restored successfully');
        } catch (restoreErr) {
            log(`Restore failed: ${restoreErr.message} — manual intervention required`);
        }

        const manifest = {
            fromVersion,
            toVersion: version,
            migratedAt: new Date().toISOString(),
            status: 'restored',
            error: e.message,
            entities: entitiesBefore,
        };
        writeManifest(repoPath, version, manifest);

        return { status: 'restored', manifest };
    }
}

// ---------------------------------------------------------------------------
// Pending migrations runner — called from check-version
// ---------------------------------------------------------------------------

/**
 * Compare two semver strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareSemver(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * Run all registered migrations that haven't been applied yet.
 * Migrations are run in version order (ascending).
 *
 * @param {string} repoPath - absolute path to the repo root
 * @param {string} [fromVersion] - the version being upgraded from (for manifest metadata)
 * @returns {Array<{ version: string, status: string }>}
 */
async function runPendingMigrations(repoPath, fromVersion) {
    if (migrations.size === 0) return [];

    const results = [];
    // Sort migrations by version ascending
    const sorted = [...migrations.values()].sort((a, b) => compareSemver(a.version, b.version));

    for (const { version, migrate } of sorted) {
        // Skip migrations for versions at or below fromVersion
        if (fromVersion && compareSemver(version, fromVersion) <= 0) {
            continue;
        }

        const result = await runMigration(repoPath, version, migrate, fromVersion || null);
        results.push({ version, status: result.status });

        if (result.status === 'success') {
            console.log(`✅ Migration ${version} applied successfully`);
        } else if (result.status === 'skipped') {
            // Silent — already applied
        } else if (result.status === 'restored') {
            console.warn(`⚠️  Migration ${version} failed — state restored from backup. Error: ${result.manifest.error}`);
        } else {
            console.error(`❌ Migration ${version} failed: ${result.manifest.error}`);
        }
    }

    return results;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveCurrentEntityId(repoPath, entityType, rawEntityId) {
    const resolved = entityType === 'research'
        ? featureSpecResolver.resolveResearchSpec(repoPath, rawEntityId)
        : featureSpecResolver.resolveFeatureSpec(repoPath, rawEntityId);
    if (resolved && resolved.path) {
        return resolved.entityId;
    }

    const suffixPattern = entityType === 'research'
        ? new RegExp(`^research-(\\d+)-${escapeRegex(rawEntityId)}\\.md$`)
        : new RegExp(`^feature-(\\d+)-${escapeRegex(rawEntityId)}\\.md$`);
    const docsDir = entityType === 'research'
        ? path.join(repoPath, 'docs', 'specs', 'research-topics')
        : path.join(repoPath, 'docs', 'specs', 'features');
    const stageDirs = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
    const matches = [];
    stageDirs.forEach((dir) => {
        const fullDir = path.join(docsDir, dir);
        if (!fs.existsSync(fullDir)) return;
        fs.readdirSync(fullDir).forEach((file) => {
            const match = file.match(suffixPattern);
            if (match) matches.push(match);
        });
    });
    return matches.length > 0 ? matches[0][1] : normalizeEntityId(rawEntityId);
}

async function backfillSpecReviewWorkflowState(repoPath, log) {
    let output = '';
    try {
        output = execSync(
            "git log --all --reverse --format=%x1e%H%x1f%s%x1f%B --extended-regexp --grep='^spec-review'",
            { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }
        );
    } catch (_) {
        return;
    }

    for (const block of String(output || '').split('\x1e')) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        const firstSep = trimmed.indexOf('\x1f');
        const secondSep = trimmed.indexOf('\x1f', firstSep + 1);
        if (firstSep === -1 || secondSep === -1) continue;
        const sha = trimmed.slice(0, firstSep);
        const subject = trimmed.slice(firstSep + 1, secondSep);
        const body = trimmed.slice(secondSep + 1);
        const parsed = parseSpecReviewSubject(subject);
        if (!parsed) continue;

        const entityId = resolveCurrentEntityId(repoPath, parsed.entityType, parsed.entityId);

        if (parsed.isReview) {
            const reviewerId = extractSpecReviewerId(body);
            if (!reviewerId) {
                log(`Skipping legacy spec-review ${sha} (${parsed.entityType} ${parsed.entityId}) — invalid reviewer id`);
                continue;
            }
            await workflowEngine.recordSpecReviewSubmitted(repoPath, parsed.entityType, entityId, {
                reviewId: sha,
                reviewerId,
                summary: parsed.summary,
                commitSha: sha,
            });
            continue;
        }

        await workflowEngine.recordSpecReviewAcknowledged(repoPath, parsed.entityType, entityId, {
            commitSha: sha,
        });
    }
}

registerMigration('2.52.1', async ({ repoPath, log }) => {
    await backfillSpecReviewWorkflowState(repoPath, log);
});

/**
 * Feature 341 migration: promote sidecar `specReview` context into first-class
 * engine states. For every snapshot where:
 *   - `specReview.activeReviewers.length > 0` → re-project to
 *     `currentSpecState = 'spec_review_in_progress'`
 *   - `specReview.pendingCount > 0` (and no active reviewer) → re-project to
 *     `currentSpecState = 'spec_revision_in_progress'`
 *
 * Idempotent: snapshots already carrying the new states are left alone.
 * Writes only snapshot.json — the projector will pick up the new state
 * on next load without appending events. This keeps the migration pure
 * and reversible via the backup/restore framework.
 */
registerMigration('2.56.0', async ({ repoPath, log }) => {
    const workflowsDir = path.join(repoPath, '.aigon', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
        log('No workflows dir; migration 2.56.0 no-op.');
        return;
    }

    let rewritten = 0;
    const stateMap = new Set([
        'spec_review_in_progress',
        'spec_review_complete',
        'spec_revision_in_progress',
        'spec_revision_complete',
    ]);

    for (const entityDir of ['features', 'research']) {
        const entityRoot = path.join(workflowsDir, entityDir);
        if (!fs.existsSync(entityRoot)) continue;
        for (const idDir of fs.readdirSync(entityRoot)) {
            const snapshotPath = path.join(entityRoot, idDir, 'snapshot.json');
            if (!fs.existsSync(snapshotPath)) continue;
            let snapshot;
            try { snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')); } catch (_) { continue; }
            if (!snapshot || !snapshot.specReview) continue;

            const alreadyMigrated = stateMap.has(snapshot.lifecycle)
                || stateMap.has(snapshot.currentSpecState);
            if (alreadyMigrated) continue;

            const activeReviewers = Array.isArray(snapshot.specReview.activeReviewers)
                ? snapshot.specReview.activeReviewers
                : [];
            const pendingCount = Number(snapshot.specReview.pendingCount || 0);

            let nextState = null;
            if (activeReviewers.length > 0) {
                nextState = 'spec_review_in_progress';
            } else if (pendingCount > 0) {
                nextState = 'spec_revision_in_progress';
            }
            if (!nextState) continue;

            // Only rewrite if lifecycle is currently `inbox` or `backlog`
            // — other states own their own review semantics in the wider redesign.
            if (!['inbox', 'backlog'].includes(snapshot.lifecycle)
                && !['inbox', 'backlog'].includes(snapshot.currentSpecState)) {
                continue;
            }

            snapshot.lifecycle = nextState;
            snapshot.currentSpecState = nextState;
            snapshot.updatedAt = new Date().toISOString();
            fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
            rewritten += 1;
            log(`Migrated ${entityDir}/${idDir} → ${nextState}`);
        }
    }

    log(`Migration 2.56.0 complete — ${rewritten} snapshot(s) rewritten.`);
});

registerMigration('2.57.0', async ({ repoPath, log }) => {
    const workflowsDir = path.join(repoPath, '.aigon', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
        log('No workflows dir; migration 2.57.0 no-op.');
        return;
    }

    let rewritten = 0;
    for (const entityDir of ['features', 'research']) {
        const entityRoot = path.join(workflowsDir, entityDir);
        if (!fs.existsSync(entityRoot)) continue;
        for (const idDir of fs.readdirSync(entityRoot)) {
            const snapshotPath = path.join(entityRoot, idDir, 'snapshot.json');
            if (!fs.existsSync(snapshotPath)) continue;
            let snapshot;
            try { snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')); } catch (_) { continue; }
            if (!snapshot) continue;
            const nextLifecycle = snapshot.lifecycle === 'reviewing' ? 'code_review_in_progress' : snapshot.lifecycle;
            const nextCurrent = snapshot.currentSpecState === 'reviewing' ? 'code_review_in_progress' : snapshot.currentSpecState;
            if (nextLifecycle === snapshot.lifecycle && nextCurrent === snapshot.currentSpecState) continue;
            snapshot.lifecycle = nextLifecycle;
            snapshot.currentSpecState = nextCurrent;
            snapshot.updatedAt = new Date().toISOString();
            fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
            rewritten += 1;
            log(`Migrated ${entityDir}/${idDir} reviewing → code_review_in_progress`);
        }
    }

    log(`Migration 2.57.0 complete — ${rewritten} snapshot(s) rewritten.`);
});

registerMigration('2.55.0', async ({ repoPath, log }) => {
    // Rename counter-review → revision; *-review-check-pending → *-revision-pending;
    // code.review.checked → code.revised; spec.review.checked → spec.revised.
    function rewriteJsonFile(filePath, label) {
        let raw;
        try { raw = fs.readFileSync(filePath, 'utf8'); } catch (_) { return false; }
        const updated = raw
            .replace(/"counter-review"/g, '"revision"')
            .replace(/-review-check-pending"/g, '-revision-pending"')
            .replace(/"spec\.review\.checked"/g, '"spec.revised"')
            .replace(/"code\.review\.checked"/g, '"code.revised"');
        if (updated === raw) return false;
        fs.writeFileSync(filePath, updated, 'utf8');
        log(`Migrated ${label}`);
        return true;
    }

    let rewritten = 0;

    // Migrate workflow state (snapshots + event logs)
    const workflowsDir = path.join(repoPath, '.aigon', 'workflows');
    if (fs.existsSync(workflowsDir)) {
        for (const entityDir of ['features', 'research']) {
            const entityRoot = path.join(workflowsDir, entityDir);
            if (!fs.existsSync(entityRoot)) continue;
            for (const idDir of fs.readdirSync(entityRoot)) {
                for (const file of ['snapshot.json', 'events.json']) {
                    const filePath = path.join(entityRoot, idDir, file);
                    if (!fs.existsSync(filePath)) continue;
                    if (rewriteJsonFile(filePath, path.relative(repoPath, filePath))) rewritten++;
                }
            }
        }
    }

    // Migrate project-level workflow definitions
    const projectDefsDir = path.join(repoPath, '.aigon', 'workflow-definitions');
    if (fs.existsSync(projectDefsDir)) {
        for (const file of fs.readdirSync(projectDefsDir).filter(f => f.endsWith('.json'))) {
            const filePath = path.join(projectDefsDir, file);
            if (rewriteJsonFile(filePath, path.relative(repoPath, filePath))) rewritten++;
        }
    }

    // Migrate global workflow definitions
    const globalDefsDir = path.join(require('os').homedir(), '.aigon', 'workflow-definitions');
    if (fs.existsSync(globalDefsDir)) {
        for (const file of fs.readdirSync(globalDefsDir).filter(f => f.endsWith('.json'))) {
            const filePath = path.join(globalDefsDir, file);
            if (rewriteJsonFile(filePath, `~/.aigon/workflow-definitions/${file}`)) rewritten++;
        }
    }

    log(`Migration 2.55.0 complete — ${rewritten} file(s) rewritten.`);
});

registerMigration('2.58.0', async ({ repoPath, log }) => {
    const workflowsDir = path.join(repoPath, '.aigon', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
        log('No workflows dir; migration 2.58.0 no-op.');
        return;
    }

    const backupDir = path.join(repoPath, '.aigon', 'state', 'migrations-backup', '2.58.0');
    let migrated = 0;
    let deleted = 0;

    for (const entityType of ['features', 'research']) {
        const entityDir = path.join(workflowsDir, entityType);
        if (!fs.existsSync(entityDir)) continue;

        const entityIds = fs.readdirSync(entityDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        for (const entityId of entityIds) {
            const entityRoot = path.join(entityDir, entityId);
            const sidecarPath = path.join(entityRoot, 'review-state.json');
            if (!fs.existsSync(sidecarPath)) continue;

            let sidecar;
            try {
                sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
            } catch (_) {
                log(`  [${entityType}/${entityId}] Failed to parse review-state.json — skipping.`);
                continue;
            }

            const entries = [
                ...(sidecar.current && sidecar.current.status === 'in-progress' ? [sidecar.current] : []),
                ...(sidecar.current && sidecar.current.status === 'complete' ? [sidecar.current] : []),
                ...(Array.isArray(sidecar.history) ? sidecar.history : []),
            ].filter(Boolean);

            if (entries.length > 0) {
                const eventsPath = path.join(entityRoot, 'events.jsonl');
                const prefix = entityType === 'features' ? 'feature' : 'research';
                let existingContent = '';
                try {
                    existingContent = fs.readFileSync(eventsPath, 'utf8');
                } catch (_) { /* file may not exist */ }

                const existingSignatures = new Set(
                    existingContent.split('\n').filter(Boolean).map(line => {
                        try {
                            const e = JSON.parse(line);
                            return `${e.type}:${e.agentId || ''}:${e.at || ''}`;
                        } catch (_) { return ''; }
                    }).filter(Boolean)
                );

                const newLines = [];
                for (const entry of entries) {
                    if (entry.startedAt) {
                        const startSig = `${prefix}.code_review.started:${entry.agent || ''}:${entry.startedAt}`;
                        if (!existingSignatures.has(startSig)) {
                            newLines.push(JSON.stringify({
                                type: `${prefix}.code_review.started`,
                                [`${prefix === 'feature' ? 'featureId' : 'researchId'}`]: entityId,
                                agentId: entry.agent || null,
                                reviewerId: entry.agent || null,
                                at: entry.startedAt,
                                source: 'migration/2.58.0/sidecar-replay',
                            }));
                            existingSignatures.add(startSig);
                        }
                    }
                    if (entry.completedAt) {
                        const completedSig = `${prefix}.code_review.completed:${entry.agent || ''}:${entry.completedAt}`;
                        if (!existingSignatures.has(completedSig)) {
                            newLines.push(JSON.stringify({
                                type: `${prefix}.code_review.completed`,
                                [`${prefix === 'feature' ? 'featureId' : 'researchId'}`]: entityId,
                                agentId: entry.agent || null,
                                reviewerId: entry.agent || null,
                                requestRevision: true,
                                at: entry.completedAt,
                                source: 'migration/2.58.0/sidecar-replay',
                            }));
                            existingSignatures.add(completedSig);
                        }
                    }
                }

                if (newLines.length > 0) {
                    fs.appendFileSync(eventsPath, newLines.join('\n') + '\n');
                    log(`  [${entityType}/${entityId}] Replayed ${newLines.length} event(s) from review-state.json.`);
                    migrated++;
                }
            }

            // Back up sidecar before deleting
            fs.mkdirSync(path.join(backupDir, entityType), { recursive: true });
            fs.copyFileSync(sidecarPath, path.join(backupDir, entityType, `${entityId}-review-state.json`));
            fs.rmSync(sidecarPath, { force: true });
            deleted++;
            log(`  [${entityType}/${entityId}] Sidecar backed up and deleted.`);
        }
    }

    log(`Migration 2.58.0 complete — ${migrated} entity/entities replayed, ${deleted} sidecar(s) deleted.`);
});

// Feature 420 migrations: aigon no longer scaffolds consumer AGENTS.md
// or reads docs/aigon-project.md. Strip the legacy aigon-managed marker
// block from AGENTS.md and delete docs/aigon-project.md.
//
// Marker pattern matches the one used by templates/generic/agents-md.md:
// <!-- AIGON_START --> ... <!-- AIGON_END -->. The block, including the
// markers and any trailing newline, is removed; runs of 3+ blank lines
// left behind are collapsed to two so the file stays clean.
registerMigration('2.59.0', async ({ repoPath, log }) => {
    const agentsMdPath = path.join(repoPath, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) {
        log('migrate_drop_aigon_agents_md_block: AGENTS.md not present, skipping.');
        return;
    }
    const original = fs.readFileSync(agentsMdPath, 'utf8');
    const blockRe = /<!--\s*AIGON_START\s*-->[\s\S]*?<!--\s*AIGON_END\s*-->\n?/;
    if (!blockRe.test(original)) {
        log('migrate_drop_aigon_agents_md_block: no aigon marker block found, skipping.');
        return;
    }
    const stripped = original.replace(blockRe, '').replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(agentsMdPath, stripped);
    const relPath = path.relative(repoPath, agentsMdPath) || 'AGENTS.md';
    console.log(`✅ Migrated: removed legacy aigon marker block from ${relPath}`);
    log(`migrate_drop_aigon_agents_md_block: removed marker block from ${relPath}`);
});

registerMigration('2.59.1', async ({ repoPath, log }) => {
    const projectMdPath = path.join(repoPath, 'docs', 'aigon-project.md');
    if (!fs.existsSync(projectMdPath)) {
        log('migrate_drop_aigon_project_md: docs/aigon-project.md not present, skipping.');
        return;
    }
    fs.rmSync(projectMdPath, { force: true });
    console.log('✅ Migrated: removed obsolete docs/aigon-project.md (aigon no longer reads this file)');
    log('migrate_drop_aigon_project_md: deleted docs/aigon-project.md');
});

// Feature 421 migration: vendor aigon docs into `.aigon/docs/` instead of
// co-mingling with the consumer's `docs/` folder. Moves legacy
// `docs/development_workflow.md`, `docs/feature-sets.md`, and
// `docs/agents/<id>.md` into `.aigon/docs/`. Pristine copies (matching the
// shipped template) move silently. Diverged copies are left in place with a
// warning so the user can resolve the merge manually.
registerMigration('2.60.0', async ({ repoPath, log }) => {
    const crypto = require('crypto');
    const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

    const templatesDocsDir = path.join(__dirname, '..', 'templates', 'docs');
    const templatesAgentMd = path.join(__dirname, '..', 'templates', 'generic', 'docs', 'agent.md');

    const movedFiles = [];
    const warnings = [];

    function moveOrWarn(legacyAbsPath, targetAbsPath, expectedSha, label) {
        if (!fs.existsSync(legacyAbsPath)) {
            // Idempotent: silently skip if legacy not present (already migrated or never installed).
            return;
        }
        if (fs.existsSync(targetAbsPath)) {
            // Target exists. If legacy is identical to the new target, drop legacy.
            // Otherwise warn — we don't know which the user prefers.
            try {
                const legacyContent = fs.readFileSync(legacyAbsPath);
                const targetContent = fs.readFileSync(targetAbsPath);
                if (legacyContent.equals(targetContent)) {
                    fs.rmSync(legacyAbsPath, { force: true });
                    log(`migrate_vendored_docs_to_dot_aigon: removed redundant ${label} (matches ${path.relative(repoPath, targetAbsPath)})`);
                    return;
                }
                warnings.push(`${label} differs from existing ${path.relative(repoPath, targetAbsPath)} — left in place. Resolve manually.`);
                return;
            } catch (e) {
                warnings.push(`${label}: failed to compare with existing target (${e.message}) — left in place.`);
                return;
            }
        }

        // Target does not exist. Compare legacy against the shipped template.
        // If they match (pristine vendored copy), move it. If they differ, warn
        // and leave it — the user may have hand-edited.
        let legacyBuf;
        try {
            legacyBuf = fs.readFileSync(legacyAbsPath);
        } catch (e) {
            warnings.push(`${label}: failed to read (${e.message}) — left in place.`);
            return;
        }
        const legacySha = sha256(legacyBuf);
        if (expectedSha && legacySha !== expectedSha) {
            warnings.push(`${label} has been edited — sha256 differs from shipped template. Move it manually to ${path.relative(repoPath, targetAbsPath)} after reconciling.`);
            return;
        }

        try {
            fs.mkdirSync(path.dirname(targetAbsPath), { recursive: true });
            fs.renameSync(legacyAbsPath, targetAbsPath);
            movedFiles.push(`${path.relative(repoPath, legacyAbsPath)} → ${path.relative(repoPath, targetAbsPath)}`);
            log(`migrate_vendored_docs_to_dot_aigon: moved ${label}`);
        } catch (e) {
            warnings.push(`${label}: move failed (${e.message}) — left in place.`);
        }
    }

    // 1. Move every templates/docs/*.md (development_workflow.md, feature-sets.md, ...)
    if (fs.existsSync(templatesDocsDir)) {
        const docFiles = fs.readdirSync(templatesDocsDir).filter(f => f.endsWith('.md'));
        for (const file of docFiles) {
            const templateBuf = fs.readFileSync(path.join(templatesDocsDir, file));
            const expectedSha = sha256(templateBuf);
            const legacy = path.join(repoPath, 'docs', file);
            const target = path.join(repoPath, '.aigon', 'docs', file);
            moveOrWarn(legacy, target, expectedSha, `docs/${file}`);
        }
    }

    // 2. Move docs/agents/<id>.md files. The per-agent template is
    //    `templates/generic/docs/agent.md` processed with placeholders, so we
    //    can't sha-match it directly. Instead we accept any file under the
    //    legacy `docs/agents/` directory whose first line begins with the
    //    `<!-- AIGON_START -->` marker — that proves it was generated by
    //    `install-agent`. User-edited additions (after the marker block) are
    //    preserved by `upsertMarkedContent` on next install, so moving the
    //    file as-is is safe.
    const legacyAgentsDir = path.join(repoPath, 'docs', 'agents');
    const targetAgentsDir = path.join(repoPath, '.aigon', 'docs', 'agents');
    if (fs.existsSync(legacyAgentsDir)) {
        const agentFiles = fs.readdirSync(legacyAgentsDir).filter(f => f.endsWith('.md'));
        for (const file of agentFiles) {
            const legacy = path.join(legacyAgentsDir, file);
            const target = path.join(targetAgentsDir, file);
            // sha check is meaningless here; pass null to bypass content check
            // but require the install marker to confirm it's aigon-owned.
            const head = fs.readFileSync(legacy, 'utf8').slice(0, 200);
            if (!/<!--\s*AIGON_START\s*-->/.test(head)) {
                warnings.push(`docs/agents/${file} lacks the AIGON_START marker — not moving (may be user-owned).`);
                continue;
            }
            moveOrWarn(legacy, target, null, `docs/agents/${file}`);
        }

        // Best-effort cleanup: remove docs/agents/ if empty (consumer may have
        // added their own files there — leave them alone if so).
        try {
            const remaining = fs.readdirSync(legacyAgentsDir);
            if (remaining.length === 0) {
                fs.rmdirSync(legacyAgentsDir);
                log('migrate_vendored_docs_to_dot_aigon: removed empty docs/agents/ directory');
            }
        } catch (_) { /* non-fatal */ }
    }

    if (movedFiles.length > 0) {
        for (const moved of movedFiles) {
            console.log(`✅ Migrated: ${moved}`);
        }
    } else {
        log('migrate_vendored_docs_to_dot_aigon: nothing to migrate (already on .aigon/docs/ layout or no legacy files found).');
    }

    if (warnings.length > 0) {
        console.log('\n⚠️  vendored-docs migration warnings:');
        for (const w of warnings) {
            console.log(`   - ${w}`);
        }
    }
});

module.exports = {
    registerMigration,
    runMigration,
    runPendingMigrations,
    // Exported for testing
    _internals: {
        migrations,
        createBackup,
        restoreBackup,
        readManifest,
        writeManifest,
        discoverEntities,
        validateWorkflows,
        getMigrationsDir,
        getVersionDir,
    },
};
