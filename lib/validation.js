'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const utils = require('./utils');
const { findFile } = require('./spec-crud');
const { parseCliOptions, getOptionValue } = require('./cli-parse');
const git = require('./git');

function formatTimestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseRalphProgress(progressContent) {
    const iterations = [];
    if (!progressContent) return iterations;

    const headerRegex = /^## Iteration (\d+) \(([^)]+)\)$/gm;
    const headers = [];
    let headerMatch;
    while ((headerMatch = headerRegex.exec(progressContent)) !== null) {
        headers.push({
            number: parseInt(headerMatch[1], 10),
            timestamp: headerMatch[2],
            index: headerMatch.index,
            headerTextLength: headerMatch[0].length
        });
    }

    headers.forEach((header, idx) => {
        const start = header.index + header.headerTextLength;
        const end = idx + 1 < headers.length ? headers[idx + 1].index : progressContent.length;
        const body = progressContent.slice(start, end);
        const statusMatch = body.match(/^\*\*Status:\*\*\s*(.+)$/m);
        const status = statusMatch ? statusMatch[1].trim() : 'Unknown';
        iterations.push({
            number: header.number,
            timestamp: header.timestamp,
            status,
            success: /^success$/i.test(status)
        });
    });

    return iterations;
}

function parseFeatureValidation(specContent) {
    // Extract commands from an optional "## Validation" section in the feature spec.
    // Accepts fenced bash blocks or plain indented/bullet lines.
    // Returns an array of command strings, or empty array if section absent.
    if (!specContent) return [];
    const sectionMatch = specContent.match(/^## Validation\s*\n([\s\S]*?)(?=^## |\Z)/m);
    if (!sectionMatch) return [];
    const body = sectionMatch[1];
    // Pull commands from fenced code block first
    const fencedMatch = body.match(/```(?:bash|sh|shell)?\n([\s\S]*?)\n```/);
    const rawText = fencedMatch ? fencedMatch[1] : body;
    return rawText
        .split('\n')
        .map(line => line.replace(/#.*$/, '').replace(/^[-*]\s+/, '').trim())
        .filter(Boolean);
}

function detectNodePackageManager() {
    if (fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(process.cwd(), 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(process.cwd(), 'bun.lockb'))) return 'bun';
    return 'npm';
}

function detectNodeTestCommand() {
    if (fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm test';
    if (fs.existsSync(path.join(process.cwd(), 'yarn.lock'))) return 'yarn test';
    if (fs.existsSync(path.join(process.cwd(), 'bun.lockb'))) return 'bun test';
    if (fs.existsSync(path.join(process.cwd(), 'package.json'))) return 'npm test';
    return null;
}

function detectValidationCommand(profileName, projectConfig = {}) {
    const configured = projectConfig?.iterate?.validationCommand
        || projectConfig?.autonomous?.validationCommand
        || projectConfig?.ralph?.validationCommand;
    if (configured && typeof configured === 'string' && configured.trim()) {
        return configured.trim();
    }

    switch (profileName) {
        case 'ios':
            return 'xcodebuild test';
        case 'android':
            return './gradlew test';
        case 'web':
        case 'api':
        case 'library':
        case 'generic':
        default: {
            if (fs.existsSync(path.join(process.cwd(), 'Cargo.toml'))) return 'cargo test';
            if (fs.existsSync(path.join(process.cwd(), 'go.mod'))) return 'go test ./...';
            if (fs.existsSync(path.join(process.cwd(), 'pyproject.toml')) || fs.existsSync(path.join(process.cwd(), 'requirements.txt'))) return 'pytest';
            return detectNodeTestCommand();
        }
    }
}

function buildRalphPrompt({
    featureNum,
    featureDesc,
    iteration,
    maxIterations,
    profileValidations,
    featureValidationCommands,
    specContent,
    priorProgress,
    criteriaFeedback
}) {
    const validationLines = [];
    (profileValidations || []).forEach(({ label, cmd }) => validationLines.push(`  [${label}] ${cmd}`));
    featureValidationCommands.forEach(cmd => validationLines.push(`  [Feature] ${cmd}`));
    const validationBlock = validationLines.length
        ? validationLines.join('\n')
        : '  (none configured — loop will mark success automatically)';

    const criteriaSection = criteriaFeedback
        ? `\nCriteria feedback from previous iteration (items that still need attention):\n${criteriaFeedback}\n`
        : '';

    const template = utils.readTemplate('prompts/ralph-iteration.txt');
    return utils.processTemplate(template, {
        ITERATION: String(iteration),
        MAX_ITERATIONS: String(maxIterations),
        FEATURE_NUM: String(featureNum),
        FEATURE_DESC: String(featureDesc),
        CRITERIA_SECTION: criteriaSection,
        VALIDATION_BLOCK: validationBlock,
        SPEC_CONTENT: specContent,
        PRIOR_PROGRESS: priorProgress || '(no prior progress)'
    });
}

// Delegated to lib/git.js — single source of truth for git operations
const getCurrentHead = git.getCurrentHead;
const getGitStatusPorcelain = git.getStatus;
const getChangedFilesInRange = git.getChangedFiles;
const getCommitSummariesInRange = git.getCommitSummaries;

function ensureRalphCommit(featureNum, iteration) {
    const message = `chore: autopilot iteration ${iteration} for feature ${String(featureNum).padStart(2, '0')}`;
    const result = git.ensureCommit(message);
    // Patch the message for backward-compatible wording used by Ralph progress logging
    if (result.ok && !result.committed) {
        return { ...result, message: 'No uncommitted changes after iteration.' };
    }
    if (result.ok && result.committed) {
        return { ...result, message: `Auto-committed pending changes: ${message}` };
    }
    return result;
}

function runRalphAgentIteration(agentId, prompt, dryRun = false) {
    const cliConfig = utils.getAgentCliConfig(agentId);
    const command = cliConfig?.command;
    if (!command) {
        return {
            ok: false,
            exitCode: 1,
            signal: null,
            summary: `No CLI command configured for agent '${agentId}'.`
        };
    }

    const flagTokens = utils.getAgentLaunchFlagTokens(command, cliConfig.implementFlag, { autonomous: true });
    // Claude needs -p (print mode) so it exits after completing the prompt
    if (command === 'claude' && !flagTokens.includes('-p') && !flagTokens.includes('--print')) {
        flagTokens.unshift('-p');
    }
    const args = [...flagTokens, prompt];

    if (dryRun) {
        return {
            ok: true,
            exitCode: 0,
            signal: null,
            summary: `[dry-run] ${command} ${args.join(' ')}`
        };
    }

    const env = { ...process.env };
    if (command === 'claude') {
        delete env.CLAUDECODE;
    }

    const result = spawnSync(command, args, { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
        stdio: 'inherit',
        env
    });

    if (result.error) {
        return {
            ok: false,
            exitCode: 1,
            signal: null,
            summary: `Agent CLI failed to start: ${result.error.message}`
        };
    }

    if (result.signal) {
        return {
            ok: false,
            exitCode: 130,
            signal: result.signal,
            summary: `Agent exited via signal ${result.signal}`
        };
    }

    const exitCode = typeof result.status === 'number' ? result.status : 1;
    return {
        ok: exitCode === 0,
        exitCode,
        signal: null,
        summary: `Agent exited with code ${exitCode}`
    };
}

function runRalphValidation(validationCommand, dryRun = false) {
    if (!validationCommand) {
        return {
            ok: false,
            exitCode: 1,
            summary: 'Validation command not configured'
        };
    }

    if (dryRun) {
        return {
            ok: true,
            exitCode: 0,
            summary: `[dry-run] ${validationCommand}`
        };
    }

    const result = spawnSync(validationCommand, { // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true,javascript.lang.security.detect-child-process.detect-child-process
        stdio: 'inherit',
        shell: true
    });

    if (result.error) {
        return {
            ok: false,
            exitCode: 1,
            summary: `Validation failed to start: ${result.error.message}`
        };
    }
    if (result.signal) {
        return {
            ok: false,
            exitCode: 130,
            summary: `Validation exited via signal ${result.signal}`
        };
    }

    const exitCode = typeof result.status === 'number' ? result.status : 1;
    return {
        ok: exitCode === 0,
        exitCode,
        summary: `${validationCommand} exited with code ${exitCode}`
    };
}

function appendRalphProgressEntry(progressPath, featureNum, featureDesc, entry) {
    if (!fs.existsSync(progressPath)) {
        const header = `# Autopilot Progress: Feature ${featureNum} - ${featureDesc}\n\n`;
        utils.safeWrite(progressPath, header);
    }

    const lines = [];
    lines.push(`## Iteration ${entry.iteration} (${entry.timestamp})`);
    lines.push(`**Status:** ${entry.status}`);
    lines.push(`**Agent:** ${entry.agent}`);
    lines.push(`**Validation:** ${entry.validation}`);
    lines.push(`**Summary:** ${entry.summary}`);
    lines.push(`**Files changed:** ${entry.filesChanged.length ? entry.filesChanged.join(', ') : 'none'}`);
    lines.push(`**Commits:** ${entry.commits.length ? entry.commits.join(' | ') : 'none'}`);
    if (entry.criteriaResults && entry.criteriaResults.length > 0) {
        const passCount = entry.criteriaResults.filter(r => r.passed === true).length;
        const failCount = entry.criteriaResults.filter(r => r.passed === false).length;
        lines.push(`**Criteria:** ${passCount} passed, ${failCount} failed`);
        entry.criteriaResults.forEach(r => {
            const icon = r.skipped ? '⏭' : r.passed ? '✅' : '❌';
            lines.push(`  ${icon} ${r.text}${r.reasoning ? ` (${r.reasoning})` : ''}`);
        });
    }
    lines.push('');

    fs.appendFileSync(progressPath, `${lines.join('\n')}\n`);
}

const CARRY_FORWARD_MAX_CHARS = 2000;

function buildIterationCarryForward({ iteration, commits, filesChanged, validationSummary }) {
    const lines = [];
    lines.push(`Previous attempt (iteration ${iteration}):`);
    if (commits && commits.length > 0) {
        lines.push(`Commits: ${commits.slice(0, 5).join(' | ')}`);
    }
    if (filesChanged && filesChanged.length > 0) {
        lines.push(`Changed: ${filesChanged.slice(0, 10).join(', ')}`);
    }
    if (validationSummary) {
        lines.push(`Validation: ${validationSummary}`);
    }
    const raw = lines.join('\n');
    return raw.length > CARRY_FORWARD_MAX_CHARS ? raw.slice(0, CARRY_FORWARD_MAX_CHARS - 3) + '...' : raw;
}

function runRalphCommand(args) {
    const options = parseCliOptions(args);
    const id = options._[0];
    if (!id) {
        console.error(`Usage: aigon feature-do <feature-id> --iterate [--max-iterations=N] [--agent=<id>] [--auto-submit] [--no-auto-submit] [--dry-run]`);
        console.error(`\nExamples:`);
        console.error(`  aigon feature-do 16 --iterate`);
        console.error(`  aigon feature-do 16 --iterate --max-iterations=8 --agent=cx`);
        console.error(`  aigon feature-do 16 --iterate --auto-submit   # auto-submit on success`);
        process.exitCode = 1;
        return;
    }

    const found = findFile(utils.PATHS.features, id, ['03-in-progress']);
    if (!found) {
        console.error(`❌ Could not find feature "${id}" in 03-in-progress.`);
        process.exitCode = 1;
        return;
    }

    const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    if (!match) {
        console.error(`❌ Could not parse feature filename: ${found.file}`);
        process.exitCode = 1;
        return;
    }
    const [, featureNum, featureDesc] = match;

    const availableAgents = utils.getAvailableAgents();
    const pc = utils.loadProjectConfig();
    const configuredDefaultMax = pc?.iterate?.maxIterations || pc?.autonomous?.maxIterations || pc?.ralph?.maxIterations;
    const defaultMaxIterations = Number.isInteger(configuredDefaultMax) && configuredDefaultMax > 0
        ? configuredDefaultMax
        : 5;
    const maxIterationsRaw = getOptionValue(options, 'max-iterations');
    const maxIterations = maxIterationsRaw !== undefined ? parseInt(maxIterationsRaw, 10) : defaultMaxIterations;
    if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
        console.error(`❌ Invalid --max-iterations value: ${maxIterationsRaw}`);
        process.exitCode = 1;
        return;
    }

    const selectedAgentRaw = String(getOptionValue(options, 'agent') || 'cc').toLowerCase();
    if (!availableAgents.includes(selectedAgentRaw)) {
        console.error(`❌ Unknown agent '${selectedAgentRaw}'. Available: ${availableAgents.join(', ')}`);
        process.exitCode = 1;
        return;
    }
    const selectedAgent = selectedAgentRaw;

    const dryRun = Boolean(getOptionValue(options, 'dry-run'));

    // --auto-submit / --no-auto-submit
    // Fleet mode defaults to auto-submit (user isn't watching); drive mode defaults to off.
    // We'll resolve the actual default after detecting fleet mode below.
    const autoSubmitFlagExplicit = getOptionValue(options, 'auto-submit');
    const noAutoSubmitFlagExplicit = getOptionValue(options, 'no-auto-submit');

    const profile = utils.getActiveProfile();
    const projectConfig = utils.loadProjectConfig();
    const profileValidations = getProfileValidationCommands(profile.name, projectConfig);

    let specContent;
    const progressPath = path.join(utils.PATHS.features.root, 'logs', `feature-${featureNum}-ralph-progress.md`);
    const existingProgress = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8') : '';
    const previousIterations = parseRalphProgress(existingProgress);
    const completedSuccess = previousIterations.find(entry => entry.success);
    // skipToAutoSubmit: loop already passed; honour --auto-submit if requested
    let skipToAutoSubmit = false;
    if (completedSuccess) {
        console.log(`✅ Autopilot loop already succeeded on iteration ${completedSuccess.number}.`);
        console.log(`   Progress file: ./docs/specs/features/logs/feature-${featureNum}-ralph-progress.md`);
        skipToAutoSubmit = true;
    }

    const startIteration = previousIterations.length
        ? Math.max(...previousIterations.map(entry => entry.number)) + 1
        : 1;

    if (!skipToAutoSubmit && startIteration > maxIterations) {
        console.error(`❌ No iterations remaining. Last recorded iteration is ${startIteration - 1}, max is ${maxIterations}.`);
        console.error(`   Re-run with a higher limit: --max-iterations=<N>`);
        process.exitCode = 1;
        return;
    }

    if (!skipToAutoSubmit) {
        const validationDisplay = profileValidations.map(v => v.cmd).join(', ') || '(not configured)';
        console.log(`\n🔁 Autopilot: Feature ${featureNum} - ${featureDesc}`);
        console.log(`   Agent: ${selectedAgent}`);
        console.log(`   Iterations: ${startIteration}..${maxIterations}`);
        console.log(`   Validation: ${validationDisplay}`);
        console.log(`   Progress: ./docs/specs/features/logs/feature-${featureNum}-ralph-progress.md`);
        if (dryRun) {
            console.log(`   Mode: dry-run`);
        }
    }

    // Write auto-submit marker so the feature-do skill template knows
    // to skip manual verification gates and auto-invoke submission signaling.
    if (autoSubmitFlagExplicit !== undefined && noAutoSubmitFlagExplicit === undefined) {
        const markerDir = path.join(process.cwd(), '.aigon');
        if (!fs.existsSync(markerDir)) fs.mkdirSync(markerDir, { recursive: true });
        const markerPath = path.join(markerDir, 'auto-submit');
        fs.writeFileSync(markerPath, JSON.stringify({ featureId: featureNum, agent: selectedAgent, createdAt: new Date().toISOString() }) + '\n');
    }

    let interrupted = false;
    const sigintHandler = () => {
        interrupted = true;
    };
    process.on('SIGINT', sigintHandler);

    let loopSucceeded = skipToAutoSubmit; // already succeeded if skipping loop
    let criteriaFeedback = null;
    let iterationCarryForward = null;
    try {
        for (let iteration = skipToAutoSubmit ? maxIterations + 1 : startIteration; iteration <= maxIterations; iteration++) {
            // Re-read spec each iteration to reflect any checkbox updates
            specContent = fs.readFileSync(found.fullPath, 'utf8');
            const timestamp = formatTimestamp();
            const progressBeforeIteration = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8') : existingProgress;
            const featureValidationCommands = parseFeatureValidation(specContent);
            // Iterations 2+ (within this run) use a compact carry-forward instead of the
            // full growing progress file, reducing first-turn input tokens materially.
            // Safety: fall back to full progress if carry-forward is absent.
            const priorProgressForPrompt = (iteration > startIteration && iterationCarryForward)
                ? iterationCarryForward
                : (progressBeforeIteration || '(no prior progress)');
            const prompt = buildRalphPrompt({
                featureNum,
                featureDesc,
                iteration,
                maxIterations,
                profileValidations,
                featureValidationCommands,
                specContent,
                priorProgress: priorProgressForPrompt,
                criteriaFeedback
            });

            console.log(`\n🚀 Iteration ${iteration}/${maxIterations}`);
            const headBefore = dryRun ? null : getCurrentHead();
            const agentResult = runRalphAgentIteration(selectedAgent, prompt, dryRun);

            let status = 'Failed';
            let summary = agentResult.summary;
            let validationResult = { ok: false, exitCode: 1, summary: 'Validation skipped (agent step did not complete)' };
            let smartResult = null;

            if (interrupted || agentResult.signal === 'SIGINT' || agentResult.exitCode === 130) {
                status = 'Interrupted';
                summary = 'Interrupted by Ctrl+C';
            } else if (agentResult.ok) {
                const currentFeatureValidationCommands = parseFeatureValidation(specContent);
                const allValidations = [
                    ...profileValidations,
                    ...currentFeatureValidationCommands.map(cmd => ({ label: 'Feature', cmd }))
                ];

                if (allValidations.length === 0) {
                    console.log(`\n⚠️  No validation configured — marking as success.`);
                    validationResult = { ok: true, exitCode: 0, summary: 'No validation configured' };
                } else {
                    console.log(`\n🧪 Running validation (${allValidations.length} check${allValidations.length > 1 ? 's' : ''}):`);
                    let allPassed = true;
                    const summaries = [];
                    for (const { label, cmd } of allValidations) {
                        console.log(`   [${label}] ${cmd}`);
                        const result = runRalphValidation(cmd, dryRun);
                        summaries.push(`${label}: ${result.summary}`);
                        if (!result.ok) {
                            validationResult = result;
                            allPassed = false;
                            break;
                        }
                        validationResult = result;
                    }
                    validationResult = { ...validationResult, summary: summaries.join(' | ') };
                    if (allPassed) validationResult.ok = true;
                }

                status = validationResult.ok ? 'Success' : 'Failed';
                summary = validationResult.ok
                    ? `Validation passed on iteration ${iteration}`
                    : `Validation failed on iteration ${iteration}`;

                // Smart validation: evaluate acceptance criteria when commands pass
                if (validationResult.ok) {
                    smartResult = runSmartValidation({
                        featureNum,
                        specPath: found.fullPath,
                        specContent,
                        dryRun,
                        updateSpec: !dryRun
                    });
                    if (smartResult.criteriaResults.length > 0) {
                        console.log(`\n🧠 Criteria evaluation:`);
                        console.log(formatCriteriaResults(smartResult.criteriaResults));
                        console.log(`   ${smartResult.summary}`);
                    }
                    if (!smartResult.allPassed) {
                        status = 'Failed';
                        summary = `Criteria check: ${smartResult.summary}`;
                        criteriaFeedback = formatCriteriaResults(
                            smartResult.criteriaResults.filter(r => r.passed === false)
                        );
                    } else {
                        criteriaFeedback = null;
                    }
                }
            }

            let commitResult;
            if (dryRun) {
                commitResult = { ok: true, committed: false, autoCommitted: false, message: 'Skipped commit step in dry-run mode.' };
            } else if (status === 'Interrupted') {
                commitResult = { ok: true, committed: false, autoCommitted: false, message: 'Skipped commit step because iteration was interrupted.' };
            } else {
                commitResult = ensureRalphCommit(featureNum, iteration);
            }
            if (!commitResult.ok) {
                status = 'Failed';
                summary = `Commit step failed: ${commitResult.message}`;
            }

            const headAfter = dryRun ? null : getCurrentHead();
            const filesChanged = dryRun ? [] : getChangedFilesInRange(headBefore, headAfter);
            const commits = dryRun ? [] : getCommitSummariesInRange(headBefore, headAfter);
            const validationSummary = validationResult.summary || 'Validation not run';

            if (!dryRun) {
                appendRalphProgressEntry(progressPath, featureNum, featureDesc, {
                    iteration,
                    timestamp,
                    status,
                    agent: selectedAgent,
                    validation: validationSummary,
                    summary,
                    filesChanged,
                    commits,
                    criteriaResults: smartResult ? smartResult.criteriaResults : null
                });
            }

            // Build carry-forward for next iteration (deterministic, no LLM call).
            // Safety: if this throws, iterationCarryForward stays null and the loop
            // falls back to full cold-start progress for the next prompt.
            if (status !== 'Success' && status !== 'Interrupted') {
                try {
                    iterationCarryForward = buildIterationCarryForward({
                        iteration,
                        commits,
                        filesChanged,
                        validationSummary
                    });
                } catch (_e) {
                    iterationCarryForward = null;
                }
            }

            if (status === 'Success') {
                loopSucceeded = true;
                console.log(`✅ Autopilot loop succeeded on iteration ${iteration}.`);
                break;
            }
            if (status === 'Interrupted') {
                console.log(`⏸️  Autopilot loop interrupted on iteration ${iteration}. Re-run to resume.`);
                process.exitCode = 130;
                break;
            }
            if (iteration === maxIterations) {
                console.log(`❌ Autopilot loop reached max iterations (${maxIterations}) without passing validation.`);
                process.exitCode = 1;
                break;
            }
            console.log(`↩️  Iteration ${iteration} failed. Continuing to next iteration...`);
        }
    } finally {
        process.removeListener('SIGINT', sigintHandler);
    }

    if (loopSucceeded) {
        // Detect fleet mode: count worktrees matching this feature ID
        let isFleetMode = false;
        try {
            isFleetMode = git.filterWorktreesByFeature(git.listWorktrees(), featureNum).length >= 1;
        } catch (e) { /* not in a git repo or no worktrees */ } // probe

        // Resolve auto-submit: explicit flags win; otherwise fleet=on, drive=off
        let autoSubmit;
        if (noAutoSubmitFlagExplicit !== undefined) {
            autoSubmit = false;
        } else if (autoSubmitFlagExplicit !== undefined) {
            autoSubmit = true;
        } else {
            autoSubmit = isFleetMode;
        }

        if (autoSubmit && !dryRun) {
            console.log(`\n🚀 Auto-submitting (${isFleetMode ? 'Fleet' : 'Drive'} mode)...`);

            // 1. Write/update the implementation log
            const logsDir = path.join(utils.PATHS.features.root, 'logs');
            const logPattern = `feature-${featureNum}-`;
            let logFile = null;
            if (fs.existsSync(logsDir)) {
                const all = fs.readdirSync(logsDir)
                    .filter(f => f.startsWith(logPattern) && f.endsWith('-log.md'));
                // In fleet/worktree, prefer agent-specific log
                const branch = git.getCurrentBranch();
                const agentMatch = branch.match(/^feature-\d+-([a-z]{2})-/);
                if (agentMatch) {
                    logFile = all.find(f => f.startsWith(`feature-${featureNum}-${agentMatch[1]}-`)) || all[0];
                } else {
                    logFile = all.filter(f => !f.match(new RegExp(`^feature-${featureNum}-[a-z]{2}-`))).find(Boolean) || all[0];
                }
            }
            let submissionSignaled = true;

            if (logFile) {
                const logPath = path.join(utils.PATHS.features.root, 'logs', logFile);
                const progressContent = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8') : '';
                const iterations = parseRalphProgress(progressContent);
                const successEntry = iterations.find(e => e.success);
                const numIterations = iterations.length;
                const logSummary = `\n## Autopilot Auto-Submit\n\nCompleted in ${numIterations} iteration${numIterations !== 1 ? 's' : ''}.\n` +
                    (successEntry ? `Passed validation on iteration ${successEntry.number}: ${successEntry.validation || 'OK'}\n` : '') +
                    `\nProgress: \`docs/specs/features/logs/feature-${featureNum}-ralph-progress.md\`\n`;

                let logContent = fs.readFileSync(logPath, 'utf8');
                // Append Autopilot summary to log
                logContent = logContent.trimEnd() + '\n' + logSummary;
                fs.writeFileSync(logPath, logContent);

                // 2. Commit the log
                try {
                    execSync(`git add "${logPath}"`, { stdio: 'pipe' });
                    execSync(`git commit -m "docs: auto-submit log for feature ${featureNum} (autopilot)"`, { stdio: 'pipe' });
                    console.log(`   ✅ Log committed: ${logFile}`);
                } catch (e) {
                    // Nothing to commit or already committed
                    console.log(`   ℹ️  Log commit skipped (no changes or already committed)`);
                }
            }

            // Route readiness through the main agent-status path so workflow-core
            // receives the same signal as manual submissions.
            try {
                execSync('aigon agent-status submitted', { stdio: 'pipe' });
            } catch (e) {
                submissionSignaled = false;
                const stderr = e && e.stderr ? String(e.stderr).trim() : '';
                const stdout = e && e.stdout ? String(e.stdout).trim() : '';
                const detail = stderr || stdout || e.message;
                console.error('   ❌ Auto-submit failed: could not signal `aigon agent-status submitted`.');
                if (detail) console.error(`      ${detail}`);
                console.error('      Run `aigon agent-status submitted` manually after resolving the issue.');
                process.exitCode = 1;
            }

            if (submissionSignaled) {
                console.log(`\n✅ Auto-submitted. Ready for ${isFleetMode ? 'evaluation' : 'review'}.`);
                if (isFleetMode) {
                    console.log(`   Next: return to main repo and run: aigon feature-eval ${featureNum}`);
                } else {
                    console.log(`   Next: run: aigon feature-close ${featureNum}`);
                }
            } else {
                console.log(`\n⚠️  Autopilot completed implementation, but submission signaling failed.`);
                console.log('   The feature may remain in implementing until `aigon agent-status submitted` succeeds.');
            }
        } else {
            if (autoSubmit && dryRun) {
                console.log(`\n[dry-run] Would auto-submit feature ${featureNum}`);
            }
            console.log(`\n📌 Next: review progress in ./docs/specs/features/logs/feature-${featureNum}-ralph-progress.md`);
            if (!autoSubmit) {
                console.log('   Then complete your implementation flow in this order:');
                console.log('   1) commit your code and log updates');
                console.log('   2) run: aigon agent-status submitted');
                console.log('   Tip: use --auto-submit to signal submission automatically next time');
            }
        }
    }
}

// --- Smart Validation ---

function parseAcceptanceCriteria(specContent) {
    const criteria = [];
    if (!specContent) return criteria;
    const lines = specContent.split('\n');
    let inSection = false;
    for (const line of lines) {
        if (/^## Acceptance Criteria/.test(line)) { inSection = true; continue; }
        if (inSection && /^## /.test(line)) break;
        if (!inSection) continue;
        const match = line.match(/^- \[([ x])\] (.+)$/);
        if (match) {
            criteria.push({
                checked: match[1] === 'x',
                text: match[2].trim(),
                type: classifyCriterion(match[2].trim())
            });
        }
    }
    return criteria;
}

function classifyCriterion(text) {
    const objectivePatterns = [
        /\btests?\s*(pass|fail|run|suite)/i,
        /\bbuilds?\s*(succeed|pass|fail|compil)/i,
        /\blint/i,
        /\btype.?check/i,
        /\bno\s+errors?/i,
        /\bcompiles?\b/i,
        /\bexit\s+code/i,
        /\bsyntax\s*(check|valid)/i,
    ];
    return objectivePatterns.some(p => p.test(text)) ? 'objective' : 'subjective';
}

function getPackageJsonScripts() {
    try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        if (!fs.existsSync(pkgPath)) return {};
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.scripts || {};
    } catch (e) {
        return {};
    }
}

function getProfileValidationCommands(profileName, projectConfig = {}) {
    // 1. Explicit config takes priority (iterate is canonical; autonomous/ralph are legacy aliases)
    const configured = projectConfig?.iterate?.validationCommand
        || projectConfig?.autonomous?.validationCommand
        || projectConfig?.ralph?.validationCommand;
    if (configured && typeof configured === 'string' && configured.trim()) {
        return [{ label: 'Project', cmd: configured.trim() }];
    }

    // 2. Custom .aigon/validation.sh replaces profile presets
    const customScript = path.join(process.cwd(), '.aigon', 'validation.sh');
    if (fs.existsSync(customScript)) {
        return [{ label: 'Custom', cmd: 'bash .aigon/validation.sh' }];
    }

    // 3. Profile-specific presets
    switch (profileName) {
        case 'ios':
            return [{ label: 'Test', cmd: 'xcodebuild test' }];
        case 'android':
            return [{ label: 'Test', cmd: './gradlew test' }];
        case 'web':
        case 'api':
        case 'library':
        case 'generic':
        default: {
            if (fs.existsSync(path.join(process.cwd(), 'Cargo.toml'))) {
                return [{ label: 'Test', cmd: 'cargo test' }];
            }
            if (fs.existsSync(path.join(process.cwd(), 'go.mod'))) {
                return [{ label: 'Test', cmd: 'go test ./...' }];
            }
            if (fs.existsSync(path.join(process.cwd(), 'pyproject.toml')) ||
                fs.existsSync(path.join(process.cwd(), 'requirements.txt'))) {
                return [{ label: 'Test', cmd: 'pytest' }];
            }
            // Node.js: multi-command based on available scripts
            const scripts = getPackageJsonScripts();
            const pm = detectNodePackageManager();
            const cmds = [];
            const nodeTestCmd = detectNodeTestCommand();
            if (nodeTestCmd) cmds.push({ label: 'Test', cmd: nodeTestCmd });
            if (profileName === 'web' && scripts.build) {
                cmds.push({ label: 'Build', cmd: `${pm} run build` });
            }
            if (scripts.lint) {
                cmds.push({ label: 'Lint', cmd: `${pm} run lint` });
            }
            if (scripts['type-check'] || scripts.typecheck) {
                const script = scripts['type-check'] ? 'type-check' : 'typecheck';
                cmds.push({ label: 'TypeCheck', cmd: `${pm} run ${script}` });
            }
            return cmds;
        }
    }
}

function evaluateAllSubjectiveCriteria(criteria, { diff, logContent }) {
    if (criteria.length === 0) return [];
    const criteriaList = criteria.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
    const diffSnippet = diff ? diff.slice(0, 4000) : '(not available)';
    const logSnippet = logContent ? logContent.slice(0, 1000) : '(not available)';

    const prompt = `You are evaluating whether a software implementation satisfies acceptance criteria.

Criteria to evaluate:
${criteriaList}

Code changes (git diff, truncated):
${diffSnippet}

Implementation notes:
${logSnippet}

For each criterion, respond with one line in this exact format:
1. YES: <brief reason>
2. NO: <brief reason>
(one line per criterion, numbered to match the list above)`;

    const env = { ...process.env };
    delete env.CLAUDECODE;

    try {
        const result = spawnSync('claude', ['-p', prompt], {
            encoding: 'utf8',
            timeout: 180000,
            env
        });

        if (result.error || result.status !== 0) {
            const reason = result.error ? result.error.message : `claude exited with status ${result.status}`;
            console.warn(`   ⚠️  LLM criteria evaluation failed: ${reason}`);
            if (result.stderr) console.warn(`   stderr: ${result.stderr.trim().slice(0, 200)}`);
            return criteria.map(() => ({ passed: null, reasoning: 'LLM evaluation unavailable', skipped: true }));
        }

        const outputLines = (result.stdout || '').trim().split('\n');
        return criteria.map((_, i) => {
            const line = outputLines.find(l => l.match(new RegExp(`^${i + 1}\\.\\s*(YES|NO)`, 'i'))) || '';
            const yesMatch = line.match(/^\d+\.\s*YES[:\s]*(.*)/i);
            const noMatch = line.match(/^\d+\.\s*NO[:\s]*(.*)/i);
            if (yesMatch) return { passed: true, reasoning: yesMatch[1].trim(), skipped: false };
            if (noMatch) return { passed: false, reasoning: noMatch[1].trim(), skipped: false };
            return { passed: null, reasoning: 'No response for this criterion', skipped: true };
        });
    } catch (e) {
        return criteria.map(() => ({ passed: null, reasoning: e.message, skipped: true }));
    }
}

function updateSpecCheckboxes(specPath, checkedTexts) {
    if (!checkedTexts || checkedTexts.length === 0) return;
    let content = fs.readFileSync(specPath, 'utf8');
    for (const text of checkedTexts) {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(`^- \\[ \\] ${escaped}$`, 'm'), `- [x] ${text}`);
    }
    fs.writeFileSync(specPath, content, 'utf8');
}

function runSmartValidation({ featureNum, specPath, specContent, dryRun = false, updateSpec = true }) {
    const criteria = parseAcceptanceCriteria(specContent);

    if (criteria.length === 0) {
        return { allPassed: true, criteriaResults: [], summary: 'No acceptance criteria found' };
    }

    if (dryRun) {
        const results = criteria.map(c => ({
            ...c, passed: null, reasoning: '[dry-run] evaluation skipped', skipped: true
        }));
        const report = criteria.map(c => `  [${c.type}] ${c.checked ? '[x]' : '[ ]'} ${c.text}`).join('\n');
        return { allPassed: true, criteriaResults: results, summary: `[dry-run] Would evaluate ${criteria.length} criteria:\n${report}` };
    }

    // Get git diff for LLM context
    let diff = '';
    try {
        diff = git.getRecentDiff(5000);
    } catch (e) { /* no diff available */ } // probe

    // Find implementation log for context
    let logContent = '';
    try {
        const logsDir = path.join(utils.PATHS.features.root, 'logs');
        const prefix = `feature-${featureNum}-`;
        const logFiles = fs.readdirSync(logsDir)
            .filter(f => f.startsWith(prefix) && f.endsWith('-log.md'));
        if (logFiles.length > 0) {
            logContent = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf8').slice(0, 2000);
        }
    } catch (e) { /* no log */ } // probe

    // Separate unchecked subjective criteria for batched LLM call
    const uncheckedSubjective = criteria.filter(c => !c.checked && c.type === 'subjective');
    const subjectiveEvals = evaluateAllSubjectiveCriteria(uncheckedSubjective, { diff, logContent });

    const criteriaResults = [];
    const passedTexts = [];
    let allPassed = true;
    let subjIdx = 0;

    for (const criterion of criteria) {
        if (criterion.checked) {
            criteriaResults.push({ ...criterion, passed: true, reasoning: 'Previously verified', skipped: false });
            continue;
        }

        if (criterion.type === 'objective') {
            // Objective criteria: considered passed when all validation commands passed
            criteriaResults.push({ ...criterion, passed: true, reasoning: 'Objective — validation commands passed', skipped: false });
            passedTexts.push(criterion.text);
        } else {
            const evalResult = subjectiveEvals[subjIdx++] || { passed: null, reasoning: 'No evaluation', skipped: true };
            criteriaResults.push({ ...criterion, ...evalResult });
            if (evalResult.passed === true) {
                passedTexts.push(criterion.text);
            } else if (evalResult.passed === false) {
                allPassed = false;
            }
            // skipped (null) does not block success
        }
    }

    // Update spec checkboxes for newly-passed criteria
    if (updateSpec && passedTexts.length > 0) {
        try {
            updateSpecCheckboxes(specPath, passedTexts);
        } catch (e) { /* non-fatal */ } // optional
    }

    const passCount = criteriaResults.filter(r => r.passed === true).length;
    const failCount = criteriaResults.filter(r => r.passed === false).length;
    const skipCount = criteriaResults.filter(r => r.skipped).length;

    // If no criteria actually passed and some were skipped (e.g. LLM unavailable),
    // don't treat it as success — nothing was actually validated
    if (passCount === 0 && skipCount > 0) {
        allPassed = false;
    }

    return {
        allPassed,
        criteriaResults,
        summary: `Criteria: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`
    };
}

function formatCriteriaResults(criteriaResults) {
    if (!criteriaResults || criteriaResults.length === 0) return '';
    return criteriaResults.map(r => {
        const icon = r.skipped ? '⏭' : r.passed ? '✅' : '❌';
        const tag = r.skipped ? 'skip' : r.passed ? 'pass' : 'FAIL';
        const note = r.reasoning ? ` — ${r.reasoning}` : '';
        return `  ${icon} [${tag}] ${r.text}${note}`;
    }).join('\n');
}

function runFeatureValidateCommand(args) {
    const options = parseCliOptions(args);
    const id = options._[0];
    if (!id) {
        console.error('Usage: aigon feature-validate <ID> [--dry-run] [--no-update]');
        process.exitCode = 1;
        return;
    }

    const found = findFile(utils.PATHS.features, id, ['03-in-progress']);
    if (!found) {
        console.error(`❌ Could not find feature "${id}" in 03-in-progress.`);
        process.exitCode = 1;
        return;
    }

    const match = found.file.match(/^feature-(\d+)-(.*)\.md$/);
    if (!match) {
        console.error(`❌ Could not parse feature filename: ${found.file}`);
        process.exitCode = 1;
        return;
    }
    const [, featureNum] = match;

    const dryRun = Boolean(getOptionValue(options, 'dry-run'));
    const noUpdate = Boolean(getOptionValue(options, 'no-update'));

    const specContent = fs.readFileSync(found.fullPath, 'utf8');
    const criteria = parseAcceptanceCriteria(specContent);

    if (criteria.length === 0) {
        console.log('ℹ️  No acceptance criteria found in spec.');
        return;
    }

    const profile = utils.getActiveProfile();
    const projectConfig = utils.loadProjectConfig();
    const profileValidations = getProfileValidationCommands(profile.name, projectConfig);
    const featureValidationCommands = parseFeatureValidation(specContent);
    const allValidations = [
        ...profileValidations,
        ...featureValidationCommands.map(cmd => ({ label: 'Feature', cmd }))
    ];

    console.log(`\n🔍 Smart Validation: Feature ${featureNum}`);
    console.log(`   Profile: ${profile.name}`);
    if (dryRun) console.log(`   Mode: dry-run`);

    if (allValidations.length > 0) {
        console.log(`\nValidation commands:`);
        allValidations.forEach(({ label, cmd }) => console.log(`  [${label}] ${cmd}`));
    }

    console.log(`\nAcceptance criteria (${criteria.length} total):`);
    criteria.forEach(c => {
        const icon = c.checked ? '[x]' : '[ ]';
        console.log(`  ${icon} [${c.type}] ${c.text}`);
    });

    if (dryRun) {
        console.log('\n[dry-run] No validation run. Use without --dry-run to execute.');
        return;
    }

    // Run validation commands
    console.log('\n🧪 Running validation:');
    let validationPassed = true;
    if (allValidations.length === 0) {
        console.log('  (no validation commands configured)');
    } else {
        for (const { label, cmd } of allValidations) {
            console.log(`  [${label}] ${cmd}`);
            const result = runRalphValidation(cmd, false);
            if (!result.ok) {
                console.log(`  ❌ Failed: ${result.summary}`);
                validationPassed = false;
                break;
            }
        }
    }

    if (!validationPassed) {
        console.log('\n❌ Validation commands failed. Fix before running smart validation.');
        process.exitCode = 1;
        return;
    }

    // Run smart validation
    console.log('\n🧠 Evaluating acceptance criteria:');
    const result = runSmartValidation({
        featureNum,
        specPath: found.fullPath,
        specContent,
        dryRun: false,
        updateSpec: !noUpdate
    });

    const formatted = formatCriteriaResults(result.criteriaResults);
    if (formatted) console.log(formatted);

    console.log(`\n${result.summary}`);
    if (result.allPassed) {
        console.log('✅ All criteria satisfied.');
        if (!noUpdate) console.log('   Spec checkboxes updated.');
    } else {
        console.log('❌ Some criteria not satisfied. Review and address failing items.');
        process.exitCode = 1;
    }
}

module.exports = {
    CARRY_FORWARD_MAX_CHARS,
    buildIterationCarryForward,
    formatTimestamp,
    parseRalphProgress,
    parseFeatureValidation,
    detectNodePackageManager,
    detectNodeTestCommand,
    detectValidationCommand,
    buildRalphPrompt,
    getCurrentHead,
    getGitStatusPorcelain,
    getChangedFilesInRange,
    getCommitSummariesInRange,
    ensureRalphCommit,
    runRalphAgentIteration,
    runRalphValidation,
    appendRalphProgressEntry,
    runRalphCommand,
    parseAcceptanceCriteria,
    classifyCriterion,
    getPackageJsonScripts,
    getProfileValidationCommands,
    evaluateAllSubjectiveCriteria,
    updateSpecCheckboxes,
    runSmartValidation,
    formatCriteriaResults,
    runFeatureValidateCommand,
};
