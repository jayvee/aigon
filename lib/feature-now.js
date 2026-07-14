'use strict';

const fs = require('fs');
const path = require('path');
const { STAGE_FOLDERS } = require('./workflow-core/paths');
const { refreshFeatureDependencyGraphs } = require('./feature-dependencies');
const { stageAndCommitPaths } = require('./git-staging');
const { shouldWriteImplementationLogStarter } = require('./profile-placeholders');

async function run(args, deps) {
    const { ctx, PATHS, findFile, getNextId, runPreHook, runPostHook, readTemplate, runGit, loadProjectConfig, u, workflow } = deps;

            const name = args.join(' ').trim();
            if (!name) return console.error("Usage: aigon feature-now <name>\nFast-track: create + prioritise + setup in one step (Drive mode)\nExample: aigon feature-now dark-mode");

            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

            // Check for existing feature with same slug
            const existing = findFile(PATHS.features, slug);
            if (existing) {
                return console.error(`❌ Feature already exists: ${existing.file} (in ${existing.folder})`);
            }

            // Assign ID
            const nextId = getNextId(PATHS.features);
            const paddedId = String(nextId).padStart(2, '0');
            const filename = `feature-${paddedId}-${slug}.md`;

            // Run pre-hook
            const hookContext = {
                featureId: paddedId,
                featureName: slug,
                mode: 'drive',
                agents: []
            };
            if (!runPreHook('feature-now', hookContext)) {
                return;
            }

            // Ensure in-progress directory exists
            const inProgressDir = path.join(PATHS.features.root, STAGE_FOLDERS.IN_PROGRESS);
            if (!fs.existsSync(inProgressDir)) {
                fs.mkdirSync(inProgressDir, { recursive: true });
            }

            // Create spec directly in the in-progress stage.
            const template = readTemplate('specs/feature-template.md');
            const content = template.replace(/\{\{NAME\}\}/g, name);
            const specPath = path.join(inProgressDir, filename);
            fs.writeFileSync(specPath, content);
            console.log(`✅ Created spec: ./docs/specs/features/${STAGE_FOLDERS.IN_PROGRESS}/${filename}`);

            // Create branch
            const branchName = `feature-${paddedId}-${slug}`;
            try {
                runGit(`git checkout -b ${branchName}`);
                console.log(`🌿 Created branch: ${branchName}`);
            } catch (e) {
                try {
                    runGit(`git checkout ${branchName}`);
                    console.log(`🌿 Switched to branch: ${branchName}`);
                } catch (e2) {
                    console.error(`❌ Failed to create/switch branch: ${e2.message}`);
                    return;
                }
            }

            // feature-now bypasses feature-start, so it must persist the same
            // canonical start event itself before claiming the feature is ready.
            try {
                await workflow.startFeature(
                    process.cwd(),
                    paddedId,
                    workflow.FeatureMode.SOLO_BRANCH,
                    ['solo'],
                    { authorAgentId: process.env.AIGON_AGENT_ID || null },
                );
                console.log(`🔧 Feature ${paddedId} started via workflow-core engine`);
            } catch (e) {
                process.exitCode = 1;
                console.error(`❌ Could not initialize workflow state: ${e.message}`);
                return;
            }

            const logsDir = path.join(PATHS.features.root, 'logs');
            const logName = `feature-${paddedId}-${slug}-log.md`;
            const logPath = path.join(logsDir, logName);
            const _projCfgNow = loadProjectConfig(process.cwd());
            const writeNowLog = shouldWriteImplementationLogStarter({
                mode: 'drive',
                loggingLevel: _projCfgNow.logging_level,
                instructions: _projCfgNow.instructions,
            });
            let logStagePath = null;
            if (writeNowLog) {
                if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
                if (!fs.existsSync(logPath)) {
                    logStagePath = logPath;
                    const logTemplate = `# Implementation Log: Feature ${paddedId} - ${slug}\n\n## Plan\n\n## Progress\n\n## Decisions\n`;
                    fs.writeFileSync(logPath, logTemplate);
                    console.log(`📝 Log: ./docs/specs/features/logs/${logName}`);
                }
            }

            let graphUpdatedPaths = [];
            try {
                const graphResult = refreshFeatureDependencyGraphs(PATHS.features, u);
                if (graphResult.changedSpecs > 0) {
                    console.log(`🕸️  Updated dependency graphs in ${graphResult.changedSpecs} feature spec(s)`);
                }
                graphUpdatedPaths = graphResult.updatedPaths || [];
            } catch (e) {
                console.warn(`⚠️  Could not refresh dependency graphs: ${e.message}`);
            }

            // Single atomic commit
            try {
                const stagedPaths = [specPath];
                if (logStagePath && fs.existsSync(logStagePath)) stagedPaths.push(logStagePath);
                stagedPaths.push(...graphUpdatedPaths);
                // Stage only files this command produced. If you add another file-writing step above,
                // append its path to stagedPaths — directory-level git add is not allowed (sweeps unrelated changes).
                stageAndCommitPaths(runGit, process.cwd(), stagedPaths, `chore: create and start feature ${paddedId} - ${slug}`);
                console.log(`📝 Committed feature creation and setup`);
            } catch (e) {
                console.warn(`⚠️  Could not commit: ${e.message}`);
            }

            // Run post-hook
            runPostHook('feature-now', hookContext);

            console.log(`\n🚗 Feature ${paddedId} ready for implementation!`);
            console.log(`   Spec: ./docs/specs/features/${STAGE_FOLDERS.IN_PROGRESS}/${filename}`);
            if (writeNowLog) console.log(`   Log:  ./docs/specs/features/logs/${logName}`);
            console.log(`   Branch: ${branchName}`);
            console.log(`\n📝 Next: Write the spec, then implement.`);
            console.log(`   When done: aigon feature-close ${paddedId}`);
}

module.exports = { run };
