'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const { HOOKS_FILE_PATH } = require('./config');

/**
 * Parse hooks file and extract all defined hooks
 * @returns {Object} Map of hook names to their shell scripts
 */
function parseHooksFile() {
    if (!fs.existsSync(HOOKS_FILE_PATH)) {
        return {};
    }

    const content = fs.readFileSync(HOOKS_FILE_PATH, 'utf8');
    const hooks = {};

    // Match ## hook-name sections followed by ```bash code blocks
    const hookPattern = /^##\s+(pre-|post-)([a-z-]+)\s*\n[\s\S]*?```bash\n([\s\S]*?)```/gm;
    let match;

    while ((match = hookPattern.exec(content)) !== null) {
        const hookType = match[1]; // 'pre-' or 'post-'
        const commandName = match[2]; // e.g., 'feature-start'
        const script = match[3].trim();
        const hookName = `${hookType}${commandName}`;
        hooks[hookName] = script;
    }

    return hooks;
}

/**
 * Get all defined hooks from the hooks file
 * @returns {Array} Array of {name, type, command, script} objects
 */
function getDefinedHooks() {
    const hooks = parseHooksFile();
    return Object.entries(hooks).map(([name, script]) => {
        const match = name.match(/^(pre|post)-(.+)$/);
        return {
            name,
            type: match ? match[1] : 'unknown',
            command: match ? match[2] : name,
            script
        };
    });
}

/**
 * Execute a hook with the given context
 * @param {string} hookName - Name of the hook (e.g., 'pre-feature-start')
 * @param {Object} context - Context variables to pass as environment variables
 * @returns {Object} {success: boolean, output?: string, error?: string}
 */
function executeHook(hookName, context = {}) {
    const hooks = parseHooksFile();
    const script = hooks[hookName];

    if (!script) {
        return { success: true, skipped: true };
    }

    console.log(`\n🪝 Running hook: ${hookName}`);

    // Build environment variables
    const env = {
        ...process.env,
        AIGON_PROJECT_ROOT: process.cwd(),
        AIGON_COMMAND: context.command || '',
        AIGON_FEATURE_ID: context.featureId || '',
        AIGON_FEATURE_NAME: context.featureName || '',
        AIGON_MODE: context.mode || '',  // 'drive', 'fleet', 'autopilot', or 'swarm'
        AIGON_AGENTS: context.agents ? context.agents.join(' ') : '',
        AIGON_AGENT: context.agent || '',
        AIGON_WORKTREE_PATH: context.worktreePath || ''
    };

    try {
        const output = execSync(script, {
            encoding: 'utf8',
            env,
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        if (output.trim()) {
            console.log(output.trim().split('\n').map(line => `   ${line}`).join('\n'));
        }
        console.log(`   ✅ Hook completed: ${hookName}`);
        return { success: true, output };
    } catch (e) {
        const errorOutput = e.stderr || e.message;
        console.error(`   ❌ Hook failed: ${hookName}`);
        if (errorOutput) {
            console.error(errorOutput.trim().split('\n').map(line => `   ${line}`).join('\n'));
        }
        return { success: false, error: errorOutput };
    }
}

/**
 * Run pre-hook for a command. Aborts if hook fails.
 * @param {string} commandName - Name of the command (e.g., 'feature-start')
 * @param {Object} context - Context variables to pass to the hook
 * @returns {boolean} true if should continue, false if should abort
 */
function runPreHook(commandName, context = {}) {
    const hookName = `pre-${commandName}`;
    const result = executeHook(hookName, { ...context, command: commandName });

    if (result.skipped) {
        return true; // No hook defined, continue
    }

    if (!result.success) {
        console.error(`\n❌ Pre-hook failed. Command '${commandName}' aborted.`);
        return false;
    }

    return true;
}

/**
 * Run post-hook for a command. Warns but doesn't fail on error.
 * @param {string} commandName - Name of the command (e.g., 'feature-start')
 * @param {Object} context - Context variables to pass to the hook
 */
function runPostHook(commandName, context = {}) {
    const hookName = `post-${commandName}`;
    const result = executeHook(hookName, { ...context, command: commandName });

    if (!result.skipped && !result.success) {
        console.warn(`\n⚠️  Post-hook '${hookName}' failed but command completed.`);
    }
}

module.exports = {
    parseHooksFile,
    getDefinedHooks,
    executeHook,
    runPreHook,
    runPostHook,
};
