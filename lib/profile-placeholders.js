'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Lazy-loaded references to config.js to avoid circular deps
let _config;
function config() {
    if (!_config) _config = require('./config');
    return _config;
}

const ROOT_DIR = path.join(__dirname, '..');
const TEMPLATES_ROOT = path.join(ROOT_DIR, 'templates');

// --- Profile preset data (loaded from templates/profiles.json) ---

const PROFILES_JSON_PATH = path.join(TEMPLATES_ROOT, 'profiles.json');

const PROFILE_PRESET_STRING_FILES = JSON.parse(
    fs.readFileSync(PROFILES_JSON_PATH, 'utf8')
).stringFiles;

function loadProfilePresetStrings(profileName) {
    const profileDir = path.join(TEMPLATES_ROOT, 'profiles', profileName);
    const readField = fileName => {
        const fieldPath = path.join(profileDir, fileName);
        if (!fs.existsSync(fieldPath)) return '';
        return fs.readFileSync(fieldPath, 'utf8').trimEnd();
    };

    return {
        testInstructions: readField(PROFILE_PRESET_STRING_FILES.testInstructions),
        manualTestingGuidance: readField(PROFILE_PRESET_STRING_FILES.manualTestingGuidance),
        depCheck: readField(PROFILE_PRESET_STRING_FILES.depCheck),
        playwrightVerification: readField(PROFILE_PRESET_STRING_FILES.playwrightVerification)
    };
}

function loadProfilePresets() {
    const profilesData = JSON.parse(fs.readFileSync(PROFILES_JSON_PATH, 'utf8'));
    const presets = {};
    for (const [name, data] of Object.entries(profilesData.profiles)) {
        presets[name] = { ...data };
        Object.assign(presets[name], loadProfilePresetStrings(name));
    }
    return presets;
}

const PROFILE_PRESETS = loadProfilePresets();

function buildAgentPortMap(basePort) {
    const agentOffsets = require('./agent-registry').getPortOffsets();
    const ports = {};
    for (const [agentId, offset] of Object.entries(agentOffsets)) {
        ports[agentId] = Number(basePort) + Number(offset);
    }
    return ports;
}

// --- Profile detection ---

/**
 * Auto-detect project profile from project files
 * @param {string} [repoPath] - Path to the repository root (defaults to process.cwd())
 * @returns {string} Profile name (web, api, ios, android, library, generic)
 */
function detectProjectProfile(repoPath) {
    const cwd = repoPath ? path.resolve(repoPath) : process.cwd();

    // iOS: Xcode project, workspace, or Swift Package Manager (root or ios/ subdir)
    const entries = fs.readdirSync(cwd);
    const hasIosFiles = (dir) => {
        try {
            return fs.readdirSync(dir).some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'));
        } catch (e) { return false; }
    };
    if (hasIosFiles(cwd) || hasIosFiles(path.join(cwd, 'ios')) ||
        fs.existsSync(path.join(cwd, 'Package.swift'))) {
        return 'ios';
    }

    // Android: Gradle build file (root or android/ subdir)
    if (fs.existsSync(path.join(cwd, 'build.gradle')) || fs.existsSync(path.join(cwd, 'build.gradle.kts')) ||
        fs.existsSync(path.join(cwd, 'android', 'build.gradle')) || fs.existsSync(path.join(cwd, 'android', 'build.gradle.kts'))) {
        return 'android';
    }

    // Web: package.json with dev script + framework config
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.scripts && pkg.scripts.dev) {
                // Check for web framework indicators
                if (entries.some(f => f.startsWith('next.config')) ||
                    entries.some(f => f.startsWith('vite.config')) ||
                    entries.some(f => f.startsWith('nuxt.config')) ||
                    entries.some(f => f.startsWith('svelte.config')) ||
                    entries.some(f => f.startsWith('astro.config')) ||
                    entries.some(f => f.startsWith('remix.config')) ||
                    entries.some(f => f.startsWith('angular.json'))) {
                    return 'web';
                }
            }
        } catch (e) { /* ignore parse errors */ }
    }

    // API: server entry points
    if (fs.existsSync(path.join(cwd, 'manage.py')) ||
        fs.existsSync(path.join(cwd, 'app.py')) ||
        fs.existsSync(path.join(cwd, 'main.go')) ||
        fs.existsSync(path.join(cwd, 'server.js')) ||
        fs.existsSync(path.join(cwd, 'server.ts'))) {
        return 'api';
    }

    // Library: build system config without dev server indicators
    if (fs.existsSync(path.join(cwd, 'Cargo.toml')) ||
        fs.existsSync(path.join(cwd, 'go.mod')) ||
        fs.existsSync(path.join(cwd, 'pyproject.toml')) ||
        fs.existsSync(path.join(cwd, 'setup.py'))) {
        return 'library';
    }

    // Library: package.json without dev script (npm library)
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (!pkg.scripts || !pkg.scripts.dev) {
                return 'library';
            }
            // Has dev script but no framework config — still treat as web
            return 'web';
        } catch (e) { /* ignore */ }
    }

    return 'generic';
}

/**
 * Get the active profile: explicit config > auto-detect
 * Merges user overrides on top of preset defaults
 * @param {string} [repoPath] - Path to the repository root (defaults to process.cwd())
 * @returns {Object} Resolved profile with devServer, testInstructions, depCheck, setupEnvLine, and metadata
 */
function getActiveProfile(repoPath) {
    const cwd = repoPath ? path.resolve(repoPath) : process.cwd();
    const projectConfigPath = path.join(cwd, '.aigon', 'config.json');
    let projectConfig = {};
    if (fs.existsSync(projectConfigPath)) {
        try {
            projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
        } catch (_) { /* ignore */ }
    }

    const profileName = projectConfig.profile || detectProjectProfile(cwd);
    const preset = PROFILE_PRESETS[profileName] || PROFILE_PRESETS.generic;

    // Start with preset defaults
    const profile = {
        name: profileName,
        detected: !projectConfig.profile,
        devServer: {
            ...preset.devServer,
            ports: preset.devServer.basePort != null
                ? buildAgentPortMap(preset.devServer.basePort)
                : { ...preset.devServer.ports }
        },
        testInstructions: preset.testInstructions,
        manualTestingGuidance: preset.manualTestingGuidance || '',
        playwrightVerification: preset.playwrightVerification || '',
        depCheck: preset.depCheck,
        setupEnvLine: preset.setupEnvLine,
        worktreeSetup: null
    };

    // worktreeSetup from project config — shell command to run after worktree creation
    if (projectConfig.worktreeSetup) {
        profile.worktreeSetup = projectConfig.worktreeSetup;
    }

    // Apply user overrides from .aigon/config.json (fleet is the new name; arena is legacy alias)
    const fleetConfig = projectConfig.fleet || projectConfig.arena;
    if (fleetConfig) {
        if (fleetConfig.testInstructions) {
            profile.testInstructions = fleetConfig.testInstructions;
        }
    }

    if (projectConfig.devServer && typeof projectConfig.devServer === 'object') {
        if (typeof projectConfig.devServer.enabled === 'boolean') {
            profile.devServer.enabled = projectConfig.devServer.enabled;
        }
        if (projectConfig.devServer.ports && typeof projectConfig.devServer.ports === 'object') {
            profile.devServer.ports = {
                ...profile.devServer.ports,
                ...projectConfig.devServer.ports,
            };
        }
    }

    // Derive fleet ports from .env/.env.local PORT (overrides profile defaults)
    if (profile.devServer.enabled) {
        // Look for PORT in .env.local / .env in the repoPath
        let basePort = null;
        const envFiles = ['.env.local', '.env'];
        for (const file of envFiles) {
            const envPath = path.join(cwd, file);
            if (!fs.existsSync(envPath)) continue;
            try {
                const content = fs.readFileSync(envPath, 'utf8');
                const match = content.match(/^PORT=(\d+)/m);
                if (match) {
                    basePort = parseInt(match[1], 10);
                    break;
                }
            } catch (e) { /* ignore read errors */ }
        }

        if (basePort) {
            profile.devServer.ports = buildAgentPortMap(basePort);
        }
    }

    return profile;
}

// --- Instruction directive resolvers ---

/**
 * Resolve rigor preset into individual directive defaults.
 * Individual directives override the preset values.
 * @param {Object} instructions - The instructions config object
 * @returns {{ testing: string, logging: string, devServer: boolean, planMode: string, documentation: boolean }}
 */
function resolveInstructionDirectives(instructions) {
    const inst = instructions || {};

    // Rigor preset defaults
    const PRODUCTION_DEFAULTS = {
        testing: 'full',
        logging: 'full',
        devServer: true,
        planMode: 'auto',
        documentation: true,
    };
    const LIGHT_DEFAULTS = {
        testing: 'skip',
        logging: 'skip',
        devServer: true,
        planMode: 'never',
        documentation: false,
    };

    const rigor = inst.rigor || 'production';
    const base = rigor === 'light' ? LIGHT_DEFAULTS : PRODUCTION_DEFAULTS;

    // Individual directives layer on top of the preset
    return {
        testing: inst.testing ?? base.testing,
        logging: inst.logging ?? base.logging,
        devServer: inst.devServer ?? base.devServer,
        planMode: inst.planMode ?? base.planMode,
        documentation: inst.documentation ?? base.documentation,
    };
}

/**
 * Resolve testing instruction placeholders based on instructions.testing config.
 * @param {string} testingLevel - "full" (default), "minimal", or "skip"
 * @param {boolean} playwrightEnabled - Whether Playwright verification is active
 * @param {string} playwrightContent - The Playwright verification content from the profile
 * @returns {{ TESTING_WRITE_SECTION: string, TESTING_PLAYWRIGHT_SECTION: string, TESTING_RUN_SECTION: string }}
 */
function resolveTestingPlaceholders(testingLevel, playwrightEnabled, playwrightContent) {
    const FULL_WRITE_SECTION = `## Step 3.8: Write tests for your implementation

**You MUST write tests for any new functionality you implement.** This is not optional. Test coverage is a key evaluation criterion in Fleet mode and a merge requirement.

- **Write unit tests** for new modules, functions, resolvers, and utilities
- **Write integration tests** for new UI components (render tests, interaction tests)
- **Add test cases** to existing test files when extending existing modules
- **Follow existing test patterns** — look at nearby \`*.test.js\`, \`*.test.jsx\`, or \`*.test.ts\` files for conventions (test runner, assertion style, mocking approach)
- **Run the test suite** to verify all tests pass (both new and existing)

> **Project-specific steps?** Check your root instructions file (e.g. AGENTS.md) for test commands and conventions.`;

    const MINIMAL_WRITE_SECTION = `## Step 3.8: Verify existing tests

If a test suite exists, run \`npm test\` to verify you haven't broken anything. Do not write new tests.`;

    const FULL_RUN_SECTION = `## Step 4.8: Run \`npm test\` before submitting

**You MUST run \`npm test\` and verify all tests pass before committing.** This runs the unit and integration test suites. Fix any failures before proceeding — do not commit code that breaks existing tests.

\`\`\`bash
npm test
\`\`\``;

    if (testingLevel === 'skip') {
        return {
            TESTING_WRITE_SECTION: '',
            TESTING_PLAYWRIGHT_SECTION: '',
            TESTING_RUN_SECTION: '',
        };
    }

    if (testingLevel === 'minimal') {
        return {
            TESTING_WRITE_SECTION: MINIMAL_WRITE_SECTION,
            TESTING_PLAYWRIGHT_SECTION: '',
            TESTING_RUN_SECTION: '',
        };
    }

    // "full" (default)
    return {
        TESTING_WRITE_SECTION: FULL_WRITE_SECTION,
        TESTING_PLAYWRIGHT_SECTION: playwrightEnabled ? playwrightContent : '',
        TESTING_RUN_SECTION: FULL_RUN_SECTION,
    };
}

/** @typedef {'drive'|'drive-wt'|'fleet'} ImplementationLogMode */

/**
 * Detect Drive-branch vs solo worktree vs Fleet from cwd (same rules as `feature-do`).
 * @param {string} [cwd]
 * @returns {ImplementationLogMode}
 */
function detectImplementationLogMode(cwd = process.cwd()) {
    const resolved = path.resolve(cwd);
    const dirName = path.basename(resolved);
    const worktreeMatch = dirName.match(/^feature-(\d+)-(\w+)-(.+)$/);
    if (!worktreeMatch) return 'drive';
    const featureNum = worktreeMatch[1];
    let featureWorktreeCount = 2;
    try {
        const git = require('./git');
        featureWorktreeCount = git.filterWorktreesByFeature(git.listWorktrees(resolved), featureNum).length;
    } catch (_) { /* stay default fleet-ish */ }
    // One sibling worktree for this feature ⇒ multi-agent Fleet (e.g. cc + gg).
    return featureWorktreeCount >= 1 ? 'fleet' : 'drive-wt';
}

/**
 * Normalize project `logging_level` (`.aigon/config.json`).
 * @param {string|undefined|null} raw
 * @returns {'fleet-only'|'always'|'never'}
 */
function normalizeProjectLoggingLevel(raw) {
    if (raw === 'always' || raw === 'never' || raw === 'fleet-only') return raw;
    return 'fleet-only';
}

/**
 * Resolve fleet-only / always / never into a concrete logging variant for templates.
 * @param {ImplementationLogMode} mode
 * @param {string|undefined|null} projectLoggingLevel
 * @returns {'skip'|'minimal'|'fleet'|'full'}
 */
function resolveImplementationLogVariant(mode, projectLoggingLevel) {
    const lvl = normalizeProjectLoggingLevel(projectLoggingLevel);
    if (lvl === 'never') return 'skip';
    if (lvl === 'always') return 'full';
    if (mode === 'drive') return 'skip';
    if (mode === 'drive-wt') return 'minimal';
    return 'fleet';
}

const LOGGING_NO_FILE_LINE = `**No implementation log is required in this mode.** The spec and git commits are the authoritative record — do **not** create or edit \`docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md\`. Proceed directly to **Step 5** (\`aigon agent-status submitted\`).`;

/** Slash-command templates are installed once — cwd is not a feature worktree; spell out all modes. */
const COMMAND_INSTALL_LOGGING_GUIDE = `## Step 6: Implementation log (depends on your mode)

Run \`aigon feature-do {{ARG1_SYNTAX}}\` once from the checkout where you implement — the CLI prints your mode.

- **Fleet** (another agent worktree exists for this feature): after submit, append **3–5 bullets** (max 10 lines) to \`./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md\` focused on approach differences vs the spec, then commit that file.
- **Solo Drive worktree** (only worktree for this feature): at most **one line** in that log path if the starter file exists.
- **Solo Drive branch** (feature branch in the main repo path, not an \`…-<agent>-…\` worktree folder): **no log** — do not create \`docs/specs/features/logs/\` files. Go to **Step 5** (\`aigon agent-status submitted\`).

Override defaults with \`"logging_level": "fleet-only" | "always" | "never"\` in \`.aigon/config.json\` (Codex inlines prompts from cwd at launch and follows the same rules).`;

const FLEET_LOGGING = `## Step 6: Update and commit the log (AFTER submit — Fleet evaluator read)

Find your implementation log at \`./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md\`.

Append **max 10 lines** as **3–5 bullets** focused on how your **implementation approach** differed from the obvious reading of the spec (trade-offs, forks, non-default structure). Evaluators compare agents side-by-side — make each bullet earn its tokens.

**Do NOT include:**
- A conversation transcript or summary of what the user said
- A restatement of the acceptance criteria or spec text
- Planning notes written before you started coding
- Code dumps or file lists (use commits)

**Then commit the log file in one commit.**`;

const FULL_LOGGING = `## Step 6: Update and commit the log (do this AFTER submit — keep it short)

Find your implementation log at \`./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md\`.

Append a short entry — **max 10 lines, 3-5 bullets**. Cover only:
- Key technical decisions (not the spec restated)
- Any non-obvious issues hit and how you resolved them
- Fleet mode only: one-line "my approach" for the evaluator

**Do NOT include:**
- A conversation transcript or summary of what the user said
- A restatement of the acceptance criteria
- Planning notes written before you started coding

**Then commit the log file in one commit.** This is a quick housekeeping step, not a writing exercise.`;

const MINIMAL_LOGGING = `## Step 6: Update the log (optional one-line)

If you already have \`./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md\`, add **one line** (what you shipped / where to look). If no file exists, skip creating one. If you add or change the file, commit it.`;

/**
 * Whether to create the starter implementation log file on disk (worktree bootstrap / init_log).
 * @param {{ mode: ImplementationLogMode, loggingLevel?: string|null }} opts
 * @returns {boolean}
 */
function shouldWriteImplementationLogStarter(opts) {
    const variant = resolveImplementationLogVariant(opts.mode, opts.loggingLevel);
    return variant !== 'skip';
}

/**
 * Resolve instructions.logging + mode + `logging_level` config into LOGGING_SECTION.
 * @param {string} directivesLogging - from resolveInstructionDirectives
 * @param {{ repoPath?: string, implementationLogMode?: ImplementationLogMode, loggingLevel?: string|null, projectConfig?: Object }} [ctx]
 * @returns {{ LOGGING_SECTION: string }}
 */
function resolveLoggingPlaceholders(directivesLogging, ctx = {}) {
    if (directivesLogging === 'skip') {
        return { LOGGING_SECTION: '**No implementation log (instructions rigor: light).** Proceed directly to **Step 5** (`aigon agent-status submitted`). Do not create `docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`.' };
    }
    const repoPath = ctx.repoPath || process.cwd();
    const projectConfig = ctx.projectConfig || config().loadProjectConfig(repoPath);
    const cfgLevel = ctx.loggingLevel !== undefined ? ctx.loggingLevel : projectConfig.logging_level;
    if (ctx.forCommandTemplateInstall) {
        if (normalizeProjectLoggingLevel(cfgLevel) === 'never') {
            return { LOGGING_SECTION: LOGGING_NO_FILE_LINE };
        }
        return { LOGGING_SECTION: COMMAND_INSTALL_LOGGING_GUIDE };
    }
    const mode = ctx.implementationLogMode ?? detectImplementationLogMode(repoPath);
    const variant = resolveImplementationLogVariant(mode, cfgLevel);

    if (variant === 'skip') return { LOGGING_SECTION: LOGGING_NO_FILE_LINE };
    if (variant === 'minimal') return { LOGGING_SECTION: MINIMAL_LOGGING };
    if (variant === 'fleet') return { LOGGING_SECTION: FLEET_LOGGING };
    return { LOGGING_SECTION: FULL_LOGGING };
}

/**
 * Resolve instructions.devServer placeholder based on config.
 * @param {boolean} devServerEnabled - true (default) or false
 * @returns {{ DEV_SERVER_SECTION: string }}
 */
function resolveDevServerPlaceholders(devServerEnabled) {
    if (!devServerEnabled) return { DEV_SERVER_SECTION: '' };
    return {
        DEV_SERVER_SECTION: `## Step 6.5: Start the dev server

**You MUST start the dev server before signalling completion.** The evaluator and user need a running preview of your implementation.

Start the dev server and leave it running.`,
    };
}

/**
 * Resolve instructions.planMode placeholder based on config.
 * @param {string} planModeLevel - "auto" (default), "never", or "always"
 * @returns {{ PLAN_MODE_SECTION: string }}
 */
function resolvePlanModePlaceholders(planModeLevel) {
    const FULL_PLAN_MODE = `## Step 2.5: Consider Plan Mode

For non-trivial features, **use plan mode** before implementation to explore the codebase and design your approach:

**Use plan mode when**:
- Feature touches 3+ files
- Architectural decisions required (choosing between patterns, libraries, approaches)
- Multiple valid implementation approaches exist
- Complex acceptance criteria requiring coordination across components
- Unclear how to integrate with existing codebase

**Skip plan mode for**:
- **Worktree or Fleet mode** — there is no interactive user to approve plans; implement directly
- Single-file changes with obvious implementation
- Clear, detailed specifications with one straightforward approach
- Simple bug fixes or small tweaks
- Very specific user instructions with implementation details provided

**In plan mode, you should**:
- Explore the codebase thoroughly (Glob, Grep, Read existing files)
- Understand existing patterns and conventions
- Design your implementation approach
- Identify files that need changes
- Present your plan for user approval
- Exit plan mode when ready to implement`;

    if (planModeLevel === 'never') {
        return { PLAN_MODE_SECTION: '**Skip plan mode — implement directly.**' };
    }
    if (planModeLevel === 'always') {
        return { PLAN_MODE_SECTION: `## Step 2.5: Plan Mode (required)

**Enter plan mode before implementing.** Explore the codebase, design your approach, identify files that need changes, and present your plan for user approval before writing code. Exit plan mode when your plan is approved.` };
    }
    return { PLAN_MODE_SECTION: FULL_PLAN_MODE };
}

/**
 * Resolve instructions.documentation placeholder based on config.
 * @param {boolean} documentationEnabled - true (default) or false
 * @returns {{ DOCUMENTATION_SECTION: string }}
 */
function resolveDocumentationPlaceholders(documentationEnabled) {
    if (!documentationEnabled) return { DOCUMENTATION_SECTION: '' };
    return {
        DOCUMENTATION_SECTION: `## Step 4.5: Update docs if affected

If changes add modules, alter repo structure, or introduce new patterns, update \`AGENTS.md\` and/or \`docs/architecture.md\` **before committing**. Cross-repo changes to \`@aigon/pro\`: note both sides. Docs ship with the code.`,
    };
}

// --- Config hash ---

/**
 * Compute a hash of instruction-relevant config fields.
 * Used to detect config changes that require a reinstall.
 * @param {Object} [projectConfig] - From loadProjectConfig(). If omitted, reads from disk.
 * @returns {string} Hex SHA-256 hash
 */
function computeInstructionsConfigHash(projectConfig) {
    const cfg = projectConfig || config().loadProjectConfig();
    const hashInput = JSON.stringify({
        instructions: cfg.instructions || {},
        profile: cfg.profile || null,
        verification: cfg.verification || {},
        logging_level: cfg.logging_level ?? null,
    });
    return crypto.createHash('sha256').update(hashInput).digest('hex');
}

// --- Section template loader ---

const SECTIONS_DIR = path.join(TEMPLATES_ROOT, 'sections');

function readSection(name) {
    const filePath = path.join(SECTIONS_DIR, name);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8').trimEnd();
}

// --- Main placeholder resolver ---

/**
 * Get template placeholders derived from the active profile and instruction directives.
 * Loads profile data from JSON, section templates from files, and merges directive placeholders.
 * @returns {Object} Placeholder key-value pairs for template processing
 */
function buildTestingSteps(profile, directives, playwrightEnabled, playwrightContent) {
    const devServerEnabled = Boolean(profile.devServer.enabled && directives.devServer);
    if (directives.testing === 'skip' && directives.logging === 'skip') {
        return devServerEnabled ? readSection('dev-server-light.md') : '';
    }
    return [devServerEnabled ? readSection('testing-steps.md') : '', profile.testInstructions || '',
        '> **Project-specific steps?** Check your root instructions file (e.g. AGENTS.md) for test commands.',
        '', playwrightEnabled ? playwrightContent : '', '', profile.manualTestingGuidance || '',
    ].filter(Boolean).join('\n');
}

function getProfilePlaceholders(opts = {}) {
    const repoPath = opts.repoPath || process.cwd();
    const profile = getActiveProfile(repoPath);
    const projectConfig = config().loadProjectConfig(repoPath);
    const pw = projectConfig?.verification?.playwright?.enabled === true;
    const playwrightEnabled = pw && (profile.name === 'web' || profile.name === 'api');
    const playwrightContent = profile.playwrightVerification || '';
    const directives = resolveInstructionDirectives(projectConfig?.instructions);
    const devServerEnabled = Boolean(profile.devServer.enabled && directives.devServer);
    const isLight = directives.testing === 'skip' && directives.logging === 'skip';
    const section = (name) => isLight ? '' : readSection(name);
    const depCheck = profile.depCheck
        ? `## Before Step 3: Install dependencies if needed\n\n${profile.depCheck}`
        : '';
    const setupEnv = profile.setupEnvLine ? `\n${profile.setupEnvLine}` : '';
    return {
        WORKTREE_TEST_INSTRUCTIONS: profile.testInstructions,
        WORKTREE_DEP_CHECK: depCheck,
        SETUP_ENV_LOCAL_LINE: setupEnv,
        MANUAL_TESTING_GUIDANCE: isLight ? '' : (profile.manualTestingGuidance || ''),
        AUTONOMOUS_SECTION: section('autonomous.md'),
        TROUBLESHOOTING_SECTION: section('troubleshooting.md'),
        AGENT_TEAMS_FEATURE_NOTE: section('agent-teams.md'),
        TESTING_STEPS_SECTION: buildTestingSteps(profile, directives, playwrightEnabled, playwrightContent),
        PLAYWRIGHT_VERIFICATION: playwrightEnabled ? playwrightContent : '',
        STOP_DEV_SERVER_STEP: devServerEnabled ? readSection('stop-dev-server.md') : '',
        ...resolveTestingPlaceholders(directives.testing, playwrightEnabled, playwrightContent),
        ...resolveLoggingPlaceholders(directives.logging, {
            repoPath,
            projectConfig,
            implementationLogMode: opts.implementationLogMode,
            loggingLevel: projectConfig.logging_level,
            forCommandTemplateInstall: Boolean(opts.forCommandTemplateInstall),
        }),
        ...resolveDevServerPlaceholders(devServerEnabled),
        ...resolvePlanModePlaceholders(directives.planMode),
        ...resolveDocumentationPlaceholders(directives.documentation),
    };
}

module.exports = {
    PROFILE_PRESET_STRING_FILES,
    PROFILE_PRESETS,
    loadProfilePresetStrings,
    detectProjectProfile,
    getActiveProfile,
    getProfilePlaceholders,
    resolveTestingPlaceholders,
    resolveLoggingPlaceholders,
    resolveDevServerPlaceholders,
    resolvePlanModePlaceholders,
    resolveDocumentationPlaceholders,
    resolveInstructionDirectives,
    computeInstructionsConfigHash,
    buildAgentPortMap,
    detectImplementationLogMode,
    normalizeProjectLoggingLevel,
    resolveImplementationLogVariant,
    shouldWriteImplementationLogStarter,
};
