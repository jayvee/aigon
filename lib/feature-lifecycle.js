'use strict';

const fs = require('fs');
const path = require('path');
const entity = require('./entity');
const wf = require('./workflow-core');
const cliParse = require('./cli-parse');
const { STAGE_FOLDERS } = require('./workflow-core/paths');
const { stageAndCommitSpecMove } = require('./git-staging');
const { operatorPauseScopeHint, operatorPauseUsageLine } = require('./pause-semantics');

async function runPause(args, deps) {
    const { ctx, def, persistAndRunEffects, findFile, PATHS } = deps;

            const id = args[0];
            if (!id) return console.error(operatorPauseUsageLine('feature-pause'));

            const prestartPause = await entity.pausePrestartEntity(def, id, ctx);
            if (prestartPause && prestartPause.handled) return;

            const isNumeric = /^\d+$/.test(id);
            if (!isNumeric) {
                return console.error(
                    `❌ Could not pause feature "${id}" (no matching inbox/backlog spec or pre-start workflow). ` +
                    'If the spec was moved on disk, run `aigon doctor --fix` or use a numeric id after prioritise.',
                );
            }

            // ID-based pause — engine path
            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const engineOpts = args.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};

            // Missing workflow snapshot: refuse to bootstrap from folder position
            // (feature 270). Point the operator to the explicit migration path.
            if (!(await wf.showFeatureOrNull(repoPath, paddedId))) {
                process.exitCode = 1;
                return console.error(`❌ Feature ${paddedId} has no workflow-core snapshot.\n   Run \`aigon doctor --fix\` to migrate legacy features, then retry.`);
            }

            const snapshot = await wf.showFeature(repoPath, paddedId);

            if (snapshot.currentSpecState === 'paused') {
                const hasPending = snapshot.effects.some(e => e.status !== 'succeeded');
                if (!hasPending) {
                    console.log(`✅ Feature ${paddedId} is already paused.`);
                    return;
                }
                // Resume pending effects from interrupted pause
                const effectResult = await persistAndRunEffects(repoPath, paddedId, [], engineOpts);
                if (effectResult.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${effectResult.message}`); }
                console.log(`✅ Paused: completed pending effects for ${paddedId}`);
                return;
            }

            if (snapshot.currentSpecState !== 'implementing') {
                process.exitCode = 1;
                return console.error(
                    `❌ Cannot pause feature ${paddedId} from state "${snapshot.currentSpecState}".\n   ${operatorPauseScopeHint('feature')}`,
                );
            }

            const found = findFile(PATHS.features, paddedId, [STAGE_FOLDERS.IN_PROGRESS, STAGE_FOLDERS.PAUSED]);
            if (!found) return console.error(`❌ Could not find feature "${paddedId}" in in-progress or paused.`);
            const specFromPath = path.join(PATHS.features.root, STAGE_FOLDERS.IN_PROGRESS, found.file);
            const specToPath = path.join(PATHS.features.root, STAGE_FOLDERS.PAUSED, found.file);

            await wf.pauseFeature(repoPath, paddedId);

            const pauseEffects = (specFromPath && specToPath && specFromPath !== specToPath)
                ? [{ id: 'pause.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } }]
                : [];
            const result = await persistAndRunEffects(repoPath, paddedId, pauseEffects, engineOpts);

            if (result.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${result.message}`); }
            if (result.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${result.message}`); }

            try {
                stageAndCommitSpecMove(ctx.git.runGit, repoPath, {
                    fromPath: specFromPath,
                    toPath: specToPath,
                    message: `chore: pause feature ${paddedId} - move spec to paused`,
                });
                console.log(`📝 Committed feature pause`);
            } catch (e) {
                console.warn(`⚠️  Could not commit feature pause: ${e.message}`);
            }

            try {
                const { createSpecStore, resolveStorageConfig } = require('../spec-store');
                const { releaseLeasesAfterResetOrPause } = require('../spec-store/lease-coordination');
                const storage = resolveStorageConfig(repoPath);
                const store = createSpecStore({ repoPath, storage });
                const ref = { entityType: 'feature', entityId: paddedId };
                await releaseLeasesAfterResetOrPause(store, ref, 'feature', process.env.AIGON_AGENT_ID || null);
            } catch (e) {
                console.warn(`⚠️  Could not release impl lease: ${e.message}`);
            }

            console.log(`✅ Paused: ${found.file} -> 06-paused/`);
}

async function runResume(args, deps) {
    const { ctx, def, persistAndRunEffects, findFile, PATHS } = deps;

            const id = args[0];
            if (!id) return console.error(operatorPauseUsageLine('feature-resume'));

            const prestartResume = await entity.resumePrestartEntity(def, id, ctx);
            if (prestartResume && prestartResume.handled) return;

            // Check if this is a name (no ID) — find in paused and move to inbox
            const isNumeric = /^\d+$/.test(id);
            const pausedDir = path.join(PATHS.features.root, STAGE_FOLDERS.PAUSED);
            if (!isNumeric) {
                const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const candidates = fs.existsSync(pausedDir) ? fs.readdirSync(pausedDir).filter(f => f.includes(slug) && f.endsWith('.md')) : [];
                if (candidates.length === 0) return console.error(`❌ No paused feature matching "${id}"`);
                const specFile = candidates[0];
                const targetDir = path.join(PATHS.features.root, STAGE_FOLDERS.INBOX);
                fs.renameSync(path.join(pausedDir, specFile), path.join(targetDir, specFile));
                console.log(`✅ Resumed: ${specFile} -> 01-inbox/`);
                return;
            }

            // ID-based resume — engine path
            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const engineOpts = args.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};

            // Missing workflow snapshot: refuse to bootstrap from folder position
            // (feature 270). Point the operator to the explicit migration path.
            if (!(await wf.showFeatureOrNull(repoPath, paddedId))) {
                process.exitCode = 1;
                return console.error(`❌ Feature ${paddedId} has no workflow-core snapshot.\n   Run \`aigon doctor --fix\` to migrate legacy features, then retry.`);
            }

            const snapshot = await wf.showFeature(repoPath, paddedId);

            if (snapshot.currentSpecState === 'implementing') {
                const hasPending = snapshot.effects.some(e => e.status !== 'succeeded');
                if (!hasPending) {
                    console.log(`✅ Feature ${paddedId} is already implementing.`);
                    return;
                }
                const effectResult = await persistAndRunEffects(repoPath, paddedId, [], engineOpts);
                if (effectResult.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${effectResult.message}`); }
                console.log(`✅ Resumed: completed pending effects for ${paddedId}`);
                return;
            }

            if (snapshot.currentSpecState !== 'paused') {
                process.exitCode = 1;
                return console.error(
                    `❌ Cannot resume feature ${paddedId} from state "${snapshot.currentSpecState}".\n   ${operatorPauseScopeHint('feature')}`,
                );
            }

            const found = findFile(PATHS.features, paddedId, [STAGE_FOLDERS.PAUSED, STAGE_FOLDERS.IN_PROGRESS]);
            if (!found) return console.error(`❌ Could not find feature "${paddedId}" in paused or in-progress.`);
            const specFromPath = path.join(PATHS.features.root, STAGE_FOLDERS.PAUSED, found.file);
            const specToPath = path.join(PATHS.features.root, STAGE_FOLDERS.IN_PROGRESS, found.file);

            await wf.resumeFeature(repoPath, paddedId);

            const resumeEffects = (specFromPath && specToPath && specFromPath !== specToPath)
                ? [{ id: 'resume.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } }]
                : [];
            const result = await persistAndRunEffects(repoPath, paddedId, resumeEffects, engineOpts);

            if (result.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${result.message}`); }
            if (result.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${result.message}`); }

            console.log(`✅ Resumed: ${found.file} -> 03-in-progress/`);
}

async function runUnprioritise(args, deps) {
    const { ctx, persistAndRunEffects, findFile, PATHS } = deps;

            const id = args[0];
            if (!id) return console.error("Usage: aigon feature-unprioritise <ID>");

            const paddedId = String(id).padStart(2, '0');
            const repoPath = process.cwd();
            const engineOpts = args.includes('--reclaim') ? { claimTimeoutMs: 1 } : {};

            if (!(await wf.showFeatureOrNull(repoPath, paddedId))) {
                process.exitCode = 1;
                return console.error(`❌ Feature ${paddedId} has no workflow-core snapshot.\n   Run \`aigon doctor --fix\` to migrate legacy features, then retry.`);
            }

            const snapshot = await wf.showFeature(repoPath, paddedId);
            const workflowId = String(snapshot.featureId || paddedId);

            if (snapshot.currentSpecState !== 'backlog') {
                process.exitCode = 1;
                return console.error(`❌ Cannot unprioritise feature ${paddedId} from state "${snapshot.currentSpecState}". Feature must be in backlog.`);
            }

            const found = findFile(PATHS.features, paddedId, [STAGE_FOLDERS.BACKLOG]);
            if (!found) return console.error(`❌ Could not find feature "${paddedId}" in backlog.`);

            const specFromPath = path.join(PATHS.features.root, STAGE_FOLDERS.BACKLOG, found.file);
            const specContent = fs.readFileSync(specFromPath, 'utf8');
            const { data: specFm } = cliParse.parseFrontMatter(specContent);
            const numericNamed = /^feature-\d+-(.+)\.md$/.exec(found.file);
            const legacySlugStrip = numericNamed && !specFm.aigon_id;
            let inboxFilename = found.file;
            if (legacySlugStrip) {
                inboxFilename = `feature-${numericNamed[1]}.md`;
            }
            const specToPath = path.join(PATHS.features.root, STAGE_FOLDERS.INBOX, inboxFilename);

            if (legacySlugStrip && fs.existsSync(specToPath)) {
                process.exitCode = 1;
                return console.error(`❌ Inbox already contains ${inboxFilename}; refusing to overwrite.`);
            }

            let effectFeatureId = workflowId;
            if (legacySlugStrip) {
                const slugId = numericNamed[1];
                try {
                    wf.migrateEntityWorkflowIdSync(repoPath, 'feature', workflowId, slugId, specToPath, 'inbox');
                } catch (err) {
                    process.exitCode = 1;
                    return console.error(`❌ ${err.message}`);
                }
                effectFeatureId = slugId;
            } else if (numericNamed) {
                try {
                    wf.transitionEntityLifecycleSync(repoPath, 'feature', workflowId, 'inbox', specToPath);
                } catch (err) {
                    process.exitCode = 1;
                    return console.error(`❌ ${err.message}`);
                }
            } else {
                await wf.persistEvents(repoPath, workflowId, [{
                    type: 'feature.bootstrapped',
                    featureId: workflowId,
                    stage: 'inbox',
                    lifecycle: 'inbox',
                    at: new Date().toISOString(),
                }]);
            }

            const unprioritiseEffects = [
                { id: 'unprioritise.move_spec', type: 'move_spec', payload: { fromPath: specFromPath, toPath: specToPath } }
            ];
            const result = await persistAndRunEffects(repoPath, effectFeatureId, unprioritiseEffects, engineOpts);

            if (result.kind === 'error') { process.exitCode = 1; return console.error(`❌ ${result.message}`); }
            if (result.kind === 'busy') { process.exitCode = 1; return console.error(`⏳ ${result.message}`); }

            try {
                const { runGit } = ctx.git;
                // specFromPath is the pre-move 02-backlog path; including it stages the deletion
                // that the move_spec effect made on disk but git did not see.
                stageAndCommitSpecMove(runGit, process.cwd(), {
                    fromPath: specFromPath,
                    toPath: specToPath,
                    message: `chore: unprioritise feature ${workflowId} - move to inbox`,
                });
                console.log(`📝 Committed feature unprioritisation`);
            } catch (e) {
                console.warn(`⚠️  Could not commit: ${e.message}`);
            }

            console.log(`✅ Moved: ${found.file} -> 01-inbox/${inboxFilename}`);
}

module.exports = { runPause, runResume, runUnprioritise };
