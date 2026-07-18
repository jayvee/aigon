'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMPLATES_ROOT = path.join(__dirname, '..', 'templates');
const AGENTS_DIR = path.join(TEMPLATES_ROOT, 'agents');

function _isMacAppDataPath(filePath) {
    if (process.platform !== 'darwin') return false;
    const resolved = path.resolve(filePath);
    const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
    return resolved === appSupport || resolved.startsWith(appSupport + path.sep);
}

// --- Agent config cache (loaded once at require-time) ---
let _agents = null;

function _loadAll() {
    if (_agents) return _agents;
    _agents = {};
    if (!fs.existsSync(AGENTS_DIR)) return _agents;
    for (const file of fs.readdirSync(AGENTS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const config = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8'));
        // Normalise output/outputs so callers can always rely on both keys.
        // `outputs` is the canonical array; `output` is kept as a backward-compat alias pointing at outputs[0].
        if (config.outputs && !config.output) {
            config.output = config.outputs[0] || null;
        } else if (config.output && !config.outputs) {
            config.outputs = [config.output];
        }
        _agents[config.id] = config;
    }
    return _agents;
}

// --- Lookup functions ---

function getAgent(id) { return _loadAll()[id] || null; }
function getAllAgentIds() { return Object.keys(_loadAll()); }
function getAllAgents() { return Object.values(_loadAll()); }

/**
 * Deactivated agents remain in the registry for historic telemetry/display but
 * must not be installed, launched, probed, or listed in workflow rosters.
 * `active: false` (or a `deactivated` audit block) marks retirement.
 */
function isAgentActive(agentOrId) {
    const agent = typeof agentOrId === 'string' ? getAgent(agentOrId) : agentOrId;
    if (!agent) return false;
    return agent.active !== false;
}

function isAgentLaunchable(id) {
    return Boolean(getAgent(id)) && isAgentActive(id);
}

function getLaunchableAgentIds() {
    return getAllAgentIds().filter(id => isAgentLaunchable(id));
}

function getLaunchableAgents() {
    return getLaunchableAgentIds().map(id => getAgent(id)).filter(Boolean);
}

function formatDeactivatedAgentMessage(agentId) {
    const agent = getAgent(agentId);
    if (!agent || isAgentActive(agent)) return null;
    const superseded = agent.deactivated?.supersededBy;
    const supersededId = Array.isArray(superseded) ? superseded[0] : superseded;
    const suffix = supersededId ? ` (superseded by \`${supersededId}\`)` : '';
    return `agent \`${agentId}\` is deactivated${suffix}`;
}

function getDisplayNames() {
    const map = {};
    for (const a of getAllAgents()) map[a.id] = a.displayName || a.name;
    return map;
}

function getShortNames() {
    const map = { solo: 'Drive' };
    for (const a of getAllAgents()) map[a.id] = a.shortName || String(a.id || '').toUpperCase();
    return map;
}

function getPortOffsets() {
    const map = {};
    for (const a of getAllAgents()) if (a.portOffset != null) map[a.id] = a.portOffset;
    return map;
}

function getAgentAliasMap() {
    const map = {};
    for (const agent of getAllAgents()) {
        for (const alias of Array.isArray(agent.aliases) ? agent.aliases : []) {
            map[String(alias).toLowerCase()] = agent.id;
        }
        map[String(agent.id).toLowerCase()] = agent.id;
    }
    return map;
}

function getProviderFamilies() {
    const map = {};
    for (const a of getAllAgents()) if (a.providerFamily) map[a.id] = a.providerFamily;
    return map;
}

/**
 * Agent IDs that can appear in Aigon attribution metadata.
 *
 * This is the canonical set for parsing trailers, notes, and other
 * non-author attribution signals. Keep the legacy email-specific helper
 * below for historical commit compatibility.
 */
function getAttributionAgentIds() {
    return getAllAgentIds();
}

/**
 * Agent IDs that historically used email-based git attribution
 * (e.g. cc@aigon.dev / cc@aigon.build).
 *
 * This remains for backward compatibility with historical commit parsing.
 */
function getAgentEmailIds() {
    return getAllAgents().filter(a => a.git?.hasEmailAttribution).map(a => a.id);
}

/**
 * Always include legacy `aigon.dev` for historical commit attribution.
 * Current domain is read from config and defaults to `aigon.build`.
 */
function getAttributionDomainsForRegex() {
    const domains = new Set(['aigon.dev']);
    try {
        const configuredDomain = require('./config-core').getAttributionDomain();
        if (configuredDomain) domains.add(String(configuredDomain).trim().toLowerCase());
    } catch (_) {
        domains.add('aigon.build');
    }
    return [...domains];
}

function escapeRegexLiteral(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex matching agent attribution emails: (cc|gg|cx|...)@(aigon.dev|aigon.build)
 */
function getAgentEmailRegex() {
    const emailAgentIds = getAgentEmailIds();
    if (emailAgentIds.length === 0) return /^$/;
    const ids = emailAgentIds.join('|');
    const domains = getAttributionDomainsForRegex().map(escapeRegexLiteral).join('|');
    return new RegExp(`^(${ids})(?:\\+[-\\w.]+)?@(?:${domains})$`, 'i');
}

/**
 * All known agent IDs including 'solo' pseudo-agent.
 */
function getKnownAgentIds() {
    return new Set([...getAllAgentIds(), 'solo']);
}

// --- Model / effort options ---

/**
 * An option is quarantined when its `quarantined` field is set (object with
 * since/reason/evidence). Quarantined entries stay in the JSON for audit, but
 * are filtered out of any picker surface by default.
 */
function isModelOptionQuarantined(opt) {
    return Boolean(opt && opt.quarantined);
}

function isModelOptionRetired(opt) {
    return Boolean(opt && (opt.quarantined || opt.archived));
}

function isModelOptionArchived(opt) {
    return Boolean(opt && opt.archived);
}

// --- modelOptions contract validation (docs/model-inclusion-policy.md §1, §5) ---

// §5: pinned model IDs only — provider-side mutable alias pointers drift under us.
const MODEL_ALIAS_SUFFIX = /-(latest|current)$/i;
// §1: hard-exclusion modality/domain patterns (substring match on lower-cased value).
// Kept deliberately conservative — these are the unambiguous non-coding modalities.
const MODEL_MODALITY_EXCLUSIONS = /(-tts|tts-preview|speech|audio|voice|voxtral|robotics|computer-use|-vl-|vl-max|vl-plus|flash-image|pro-image|nano-banana|imagen|-image\b|-image-preview)/i;
// §4: soft signals — surfaced as warnings, not rejected.
const MODEL_SOFT_SIGNAL_SUFFIX = /-(preview|beta|rc)\b/i;

const SUMMARY_ROLES = new Set(['implement', 'review', 'spec', 'spec_review', 'research']);
const SUMMARY_CONFIDENCE = new Set(['high', 'medium', 'low']);
const SUMMARY_SOURCE_KINDS = new Set(['aigon-bench', 'benchmark', 'community', 'provider']);

/**
 * Validate a model option's `summary` block (docs/model-inclusion-policy.md §5).
 * Mutates `errors` / `warnings` arrays in `ctx`. No-op when `summary` is absent.
 */
function validateSummary(opt, where, ctx) {
    const { errors, warnings } = ctx;
    const isArchived = Boolean(opt?.quarantined);

    if (!opt.summary) return;

    const s = opt.summary;
    if (typeof s !== 'object' || Array.isArray(s)) {
        errors.push(`${where}: summary must be an object`);
        return;
    }

    const headlineMissing = typeof s.headline !== 'string' || !s.headline.trim();
    if (headlineMissing) {
        if (isArchived) {
            warnings.push(`${where}: archived entry has summary without headline`);
        } else {
            errors.push(`${where}: summary.headline is required when summary is present`);
        }
    } else {
        const headline = s.headline.trim();
        if (headline.length > 120) {
            errors.push(`${where}: summary.headline exceeds 120 chars`);
        }
        const label = typeof opt.label === 'string' ? opt.label.trim() : '';
        if (label && headline.toLowerCase() === label.toLowerCase()) {
            errors.push(`${where}: summary.headline must not duplicate label`);
        }
    }

    if (typeof s.confidence !== 'string' || !SUMMARY_CONFIDENCE.has(s.confidence)) {
        errors.push(`${where}: summary.confidence must be high, medium, or low`);
    }

    if (typeof s.researchedAt !== 'string' || !s.researchedAt.trim() || Number.isNaN(Date.parse(s.researchedAt))) {
        errors.push(`${where}: summary.researchedAt must be a valid ISO-8601 timestamp`);
    }

    if (s.body != null) {
        if (typeof s.body !== 'string') {
            errors.push(`${where}: summary.body must be a string`);
        } else if (s.body.length > 500) {
            errors.push(`${where}: summary.body exceeds 500 chars`);
        }
    }

    for (const field of ['bestFor', 'avoidFor']) {
        if (s[field] == null) continue;
        if (!Array.isArray(s[field])) {
            errors.push(`${where}: summary.${field} must be an array`);
            continue;
        }
        const seen = new Set();
        for (const role of s[field]) {
            if (!SUMMARY_ROLES.has(role)) {
                errors.push(`${where}: summary.${field} contains invalid role "${role}"`);
            }
            if (seen.has(role)) {
                errors.push(`${where}: summary.${field} contains duplicate role "${role}"`);
            }
            seen.add(role);
        }
    }

    if (s.sources != null) {
        if (!Array.isArray(s.sources)) {
            errors.push(`${where}: summary.sources must be an array`);
        } else {
            for (let i = 0; i < s.sources.length; i++) {
                const src = s.sources[i];
                if (!src || typeof src !== 'object') {
                    errors.push(`${where}: summary.sources[${i}] must be an object`);
                    continue;
                }
                if (!SUMMARY_SOURCE_KINDS.has(src.kind)) {
                    errors.push(`${where}: summary.sources[${i}].kind must be aigon-bench, benchmark, community, or provider`);
                }
            }
            if (s.confidence === 'high' && s.sources.length === 0) {
                warnings.push(`${where}: summary.confidence is high but sources is empty`);
            }
        }
    } else if (s.confidence === 'high') {
        warnings.push(`${where}: summary.confidence is high but sources is missing`);
    }
}

/**
 * Validate custom `customModelOptions` entries. Invalid entries are dropped from
 * the picker (warn at load, do not block startup).
 */
function validateCustomModelOptions(customArr, agentId) {
    const valid = [];
    const warnings = [];
    if (!Array.isArray(customArr)) return { valid, warnings };

    for (const opt of customArr) {
        if (!opt || typeof opt.value !== 'string' || !opt.value.trim() || typeof opt.label !== 'string' || !opt.label.trim()) {
            continue;
        }
        const where = `[${agentId}] customModelOptions "${opt.value}"`;
        const errors = [];
        const entryWarnings = [];
        validateSummary(opt, where, { errors, warnings: entryWarnings });

        if (errors.length) {
            for (const err of errors) {
                warnings.push(`${err} — custom entry dropped from picker`);
            }
            continue;
        }
        if (agentId === 'op') {
            const { isValidOpModel } = require('./op-models');
            if (!isValidOpModel(opt.value)) {
                warnings.push(`${where}: not routable via OpenCode/OpenRouter — custom entry dropped from picker`);
                continue;
            }
        }
        warnings.push(...entryWarnings);
        valid.push(opt);
    }
    return { valid, warnings };
}

/**
 * Validate one agent's `cli.modelOptions` against the inclusion-policy contract
 * (docs/model-inclusion-policy.md). Pure function — does not read the registry.
 *
 * Returns { errors, warnings }. `errors` are structural §5 / §1 violations that
 * must block (the contract test asserts errors.length === 0). `warnings` are §4
 * soft signals a human should weigh but that do not fail CI.
 *
 * This is the single enforcement point the prose policy lacked: whoever edits a
 * templates/agents/*.json entry (maintainer by hand, or future curated tooling)
 * gets the same gate.
 */
function validateModelOptions(agentConfig) {
    const errors = [];
    const warnings = [];
    const id = agentConfig?.id || '?';
    const opts = Array.isArray(agentConfig?.cli?.modelOptions) ? agentConfig.cli.modelOptions : [];
    const defaults = agentConfig?.cli?.complexityDefaults || {};
    const defaultModelValues = new Set(
        Object.values(defaults).map(d => d && d.model).filter(Boolean)
    );

    const seen = new Set();
    for (const opt of opts) {
        // The single `value: null` entry is the "Default (agent decides)" placeholder.
        // It carries only a label and is exempt from the per-model contract.
        if (opt && opt.value == null) {
            if (typeof opt.label !== 'string' || !opt.label.trim()) {
                errors.push(`[${id}] the null/Default option must have a non-empty label`);
            }
            continue;
        }

        const value = opt && typeof opt.value === 'string' ? opt.value : null;
        const where = `[${id}] modelOptions "${value ?? '(non-string value)'}"`;
        if (!value || !value.trim()) {
            errors.push(`${where}: value must be a non-empty string (or null for the Default placeholder)`);
            continue;
        }
        if (seen.has(value)) errors.push(`${where}: duplicate value`);
        seen.add(value);

        // §5 — pinned, no alias pointers.
        if (MODEL_ALIAS_SUFFIX.test(value)) {
            errors.push(`${where}: alias suffix (-latest/-current) is forbidden — pin to the dated/numeric ID (§5)`);
        }
        // §1 — modality/domain hard exclusions (skip quarantined: kept for audit).
        if (!opt.quarantined && MODEL_MODALITY_EXCLUSIONS.test(value)) {
            errors.push(`${where}: matches a §1 non-coding-modality exclusion — this model cannot drive an agentic coding loop`);
        }

        // §5 — required fields.
        if (typeof opt.label !== 'string' || !opt.label.trim()) {
            errors.push(`${where}: missing label (§5)`);
        }
        if (typeof opt.lastRefreshAt !== 'string' || Number.isNaN(Date.parse(opt.lastRefreshAt))) {
            errors.push(`${where}: lastRefreshAt must be an ISO timestamp (§5)`);
        }
        if (!opt.score || typeof opt.score !== 'object' || Array.isArray(opt.score)) {
            errors.push(`${where}: score must be an object of { <role>: number|null } — present, even if values are null (§5)`);
        } else {
            for (const [role, v] of Object.entries(opt.score)) {
                if (v !== null && typeof v !== 'number') {
                    errors.push(`${where}: score.${role} must be a number or null (§5)`);
                }
            }
        }
        // §5 — pricing required-shape when present (omitted only for plan-bundled SKUs).
        if (opt.pricing != null) {
            const p = opt.pricing;
            if (typeof p !== 'object' || typeof p.input !== 'number' || typeof p.output !== 'number') {
                errors.push(`${where}: pricing must be { input: number, output: number } in USD/MTok (§5)`);
            }
        }
        // §5 — notes mandatory once promoted into a complexityDefaults slot.
        if (defaultModelValues.has(value)) {
            if (!opt.notes || typeof opt.notes !== 'object' || Array.isArray(opt.notes)) {
                errors.push(`${where}: is wired into cli.complexityDefaults — notes: { <role>: string } is required (§5)`);
            }
        }
        if (opt.notes != null && (typeof opt.notes !== 'object' || Array.isArray(opt.notes))) {
            errors.push(`${where}: notes must be an object of { <role>: string } (§5)`);
        }
        // §5 — quarantine/archive records must carry audit fields (same shape per §7).
        for (const blockName of ['quarantined', 'archived']) {
            const block = opt[blockName];
            if (!block) continue;
            for (const field of ['since', 'reason', 'evidence']) {
                if (!block[field]) {
                    errors.push(`${where}: ${blockName} block is missing "${field}" (§5/§7)`);
                }
            }
        }

        // §4 — soft signals: surface, do not block.
        if (MODEL_SOFT_SIGNAL_SUFFIX.test(value)) {
            warnings.push(`${where}: -preview/-beta/-rc suffix — provider may yank/change it; unsuitable as a complexityDefaults default until promoted (§4)`);
        }
        if (opt.pricing && typeof opt.pricing.output === 'number' && opt.pricing.output > 5 && !opt.quarantined) {
            warnings.push(`${where}: output price $${opt.pricing.output}/MTok exceeds the $5 economic gate — needs explicit human sign-off (§2)`);
        }

        validateSummary(opt, where, { errors, warnings });
    }

    return { errors, warnings };
}

/**
 * Return the fully-qualified model-option list for an agent's picker.
 * Shape: [{ value: string|null, label: string }, ...]
 * An empty list means "agent doesn't expose a model picker" (e.g. cu).
 * Quarantined entries are excluded — pass { includeQuarantined: true } to see them.
 */
function getModelOptions(agentId, { includeQuarantined = false, projectConfig, globalConfig } = {}) {
    const agent = getAgent(agentId);
    const shippedList = Array.isArray(agent?.cli?.modelOptions) ? agent.cli.modelOptions : [];

    const { loadProjectConfig, loadGlobalConfig } = require('./config-core');
    const projectCfg = projectConfig != null ? projectConfig : loadProjectConfig();
    const globalCfg = globalConfig != null ? globalConfig : loadGlobalConfig();
    const projectCustom = _getCustomModelOptions(projectCfg, agentId);
    const globalCustom = _getCustomModelOptions(globalCfg, agentId);

    if (agentId === 'op') {
        const { listOpModelOptions, refreshIfStale } = require('./op-models');
        refreshIfStale().catch(() => {});
        const overlay = [...projectCustom, ...globalCustom, ...shippedList]
            .filter((opt) => includeQuarantined || !isModelOptionRetired(opt));
        return listOpModelOptions(overlay);
    }

    const seen = new Set();
    const merged = [];
    for (const opt of [...projectCustom, ...globalCustom, ...shippedList]) {
        if (!includeQuarantined && isModelOptionRetired(opt)) continue;
        const key = opt.value == null ? null : String(opt.value);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        merged.push({ ...opt });
    }
    return merged;
}

function _getCustomModelOptions(config, agentId) {
    const arr = config?.agents?.[agentId]?.customModelOptions;
    if (!Array.isArray(arr)) return [];
    const { valid, warnings } = validateCustomModelOptions(arr, agentId);
    for (const w of warnings) {
        console.warn(`⚠️  ${w}`);
    }
    return valid;
}

function isKnownModelValue(agentId, value, { includeQuarantined = false } = {}) {
    const modelValue = value == null ? '' : String(value).trim();
    if (!modelValue) return false;
    const concreteOptions = getModelOptions(agentId, { includeQuarantined })
        .map(opt => opt.value == null ? null : String(opt.value))
        .filter(Boolean);
    if (concreteOptions.length === 0) return true;
    if (concreteOptions.includes(modelValue)) return true;
    if (agentId === 'op') {
        const { resolveOpModel } = require('./op-models');
        if (resolveOpModel(modelValue)) return true;
    }
    return false;
}

/**
 * Return the effort-option list for an agent's picker.
 * Shape: [{ value: string|null, label: string }, ...]
 * An empty list means effort is not selectable for this agent.
 */
function getEffortOptions(agentId) {
    const agent = getAgent(agentId);
    const options = agent?.cli?.effortOptions;
    return Array.isArray(options) ? options.map(opt => ({ ...opt })) : [];
}

function getModelFlag(agentId) {
    const agent = getAgent(agentId);
    return agent?.cli?.modelFlag || null;
}

function getEffortFlag(agentId) {
    const agent = getAgent(agentId);
    return agent?.cli?.effortFlag || null;
}

function getEffortEnv(agentId) {
    const agent = getAgent(agentId);
    return agent?.cli?.effortEnv || null;
}

function getPromptFlag(agentId) {
    const agent = getAgent(agentId);
    return agent?.cli?.promptFlag || null;
}

// --- Default config generation (for DEFAULT_GLOBAL_CONFIG.agents) ---

function buildDefaultAgentConfigs() {
    const configs = {};
    for (const a of getLaunchableAgents()) {
        if (!a.cli?.command) continue;
        configs[a.id] = {
            cli: a.cli.command,
            implementFlag: a.cli.implementFlag || '',
            planFlag: a.cli.planFlag ?? null,
            models: { ...a.cli.models },
        };
    }
    return configs;
}

// --- Process detection map (for detectActiveAgentSession) ---

function getProcessDetectionMap() {
    const map = {};
    for (const a of getLaunchableAgents()) {
        if (!a.cli?.command) continue;
        map[a.cli.command] = { agentId: a.id, agentName: a.displayName || a.name };
    }
    return map;
}

// --- Trust setup ---

function _safeWrite(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
}

function _resolvePath(p) {
    return p.replace(/^~/, os.homedir());
}

function _escapeTomlBasicString(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function _buildTomlProjectEntry(projectPath, trustLevel) {
    return `[projects."${_escapeTomlBasicString(projectPath)}"]\ntrust_level = "${trustLevel}"\n`;
}

function _removeTomlProjectEntry(config, projectPath) {
    const escapedPath = _escapeTomlBasicString(projectPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\n?\\[projects\\."${escapedPath}"\\]\\ntrust_level = "[^"\\n]*"\\n?`, 'g');
    return String(config || '').replace(pattern, '\n');
}

/**
 * Cursor Agent CLI stores trust separately from VS Code's security.workspace.trust.*
 * as ~/.cursor/projects/<slug>/.workspace-trusted (JSON with workspacePath).
 * Slug = absolute path segments joined by '-', with leading dots stripped from each segment
 * (e.g. /Users/me/.aigon/wt → Users-me-aigon-wt).
 */
function cursorAgentProjectSlug(absWorkspacePath) {
    const n = path.resolve(absWorkspacePath);
    const parts = n.split(path.sep).filter(Boolean);
    return parts.map(seg => {
        const stripped = seg.replace(/^\.+/, '');
        return stripped.length ? stripped : seg;
    }).join('-');
}

/**
 * Cursor may truncate long ~/.cursor/projects/<slug> directory names (e.g.
 * ...-model-catalog-... → ...-mod-<hash>) while keeping the full slug for
 * other metadata. Trust markers must exist on every variant or the Agent CLI
 * worker can stall during first-time codebase indexing.
 */
function listCursorProjectSlugVariants(absWorkspacePath, projectsRoot) {
    const workspacePath = path.resolve(absWorkspacePath);
    const fullSlug = cursorAgentProjectSlug(workspacePath);
    const variants = new Set([fullSlug]);
    const root = _resolvePath(projectsRoot || '~/.cursor/projects');
    if (!fs.existsSync(root)) return [...variants];
    const basename = path.basename(workspacePath);
    const dirPrefix = fullSlug.slice(0, Math.max(0, fullSlug.length - basename.length));
    try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === fullSlug) continue;
            if (!dirPrefix || !entry.name.startsWith(dirPrefix)) continue;
            variants.add(entry.name);
        }
    } catch (_) { /* best-effort */ }
    return [...variants];
}

function writeCursorWorkspaceTrustedMarker(projectsRoot, slug, workspacePath) {
    const markerPath = path.join(_resolvePath(projectsRoot), slug, '.workspace-trusted');
    const payloadObj = { trustedAt: new Date().toISOString(), workspacePath };
    const payload = `${JSON.stringify(payloadObj, null, 2)}\n`;
    let needWrite = true;
    if (fs.existsSync(markerPath)) {
        try {
            const prev = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
            if (prev && prev.workspacePath === workspacePath) needWrite = false;
        } catch (_) { /* rewrite corrupt marker */ }
    }
    if (!needWrite) return false;
    _safeWrite(markerPath, payload);
    return true;
}

/** @returns {boolean} true if any marker was created or updated */
function ensureCursorAgentWorkspaceTrustedMarkers(projectsRoot, paths) {
    let any = false;
    const cwd = process.cwd();
    for (const p of paths) {
        const workspacePath = path.resolve(cwd, p);
        for (const slug of listCursorProjectSlugVariants(workspacePath, projectsRoot)) {
            if (writeCursorWorkspaceTrustedMarker(projectsRoot, slug, workspacePath)) {
                any = true;
            }
        }
    }
    return any;
}

/**
 * Ensure workspace trust for an agent across multiple paths.
 * For json-kv type (Gemini), trusts the parent directory of the first path.
 * No-op if the agent has no trust config.
 */
function ensureAgentTrust(agentId, paths) {
    const agent = getAgent(agentId);
    if (!agent?.trust) return;

    const trust = agent.trust;
    const trustPath = _resolvePath(trust.path);

    switch (trust.type) {
        case 'claude-json': {
            try {
                let config = {};
                if (fs.existsSync(trustPath)) {
                    config = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
                }
                if (!config.projects) config.projects = {};
                const cwd = process.cwd();
                let changed = false;
                for (const p of paths) {
                    const abs = path.resolve(cwd, p);
                    if (!config.projects[abs]) config.projects[abs] = {};
                    if (!config.projects[abs][trust.projectKey]) {
                        config.projects[abs][trust.projectKey] = true;
                        changed = true;
                    }
                    // Folder trust and MCP-server trust are separate Claude Code
                    // dialogs keyed off the same per-project entry. Each worktree
                    // is a fresh path, so without this, every autonomous session
                    // hits an unanswerable "New MCP server found" prompt.
                    if (!config.projects[abs].enableAllProjectMcpServers) {
                        config.projects[abs].enableAllProjectMcpServers = true;
                        changed = true;
                    }
                }
                if (changed) {
                    fs.writeFileSync(trustPath, JSON.stringify(config, null, 2));
                    console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} workspace trust for worktree(s)`);
                }
            } catch (e) {
                console.warn(`\u26A0\uFE0F  Could not pre-seed ${agent.displayName || agent.name} trust: ${e.message}`);
            }
            break;
        }
        case 'json-kv': {
            try {
                let trusted = {};
                if (fs.existsSync(trustPath)) {
                    trusted = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
                }
                let changed = false;
                if (paths.length > 0) {
                    const parentDir = path.dirname(path.resolve(process.cwd(), paths[0]));
                    if (!trusted[parentDir]) {
                        trusted[parentDir] = trust.parentValue || trust.value;
                        changed = true;
                    }
                }
                if (changed) {
                    _safeWrite(trustPath, JSON.stringify(trusted, null, 2));
                    console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} workspace trust for worktree(s)`);
                }
            } catch (e) {
                console.warn(`\u26A0\uFE0F  Could not pre-seed ${agent.displayName || agent.name} trust: ${e.message}`);
            }
            break;
        }
        case 'json-array': {
            // Antigravity CLI: settings.json trustedWorkspaces string[].
            try {
                let settings = {};
                if (fs.existsSync(trustPath)) {
                    settings = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
                }
                const key = trust.key || 'trustedWorkspaces';
                if (!Array.isArray(settings[key])) settings[key] = [];
                const cwd = process.cwd();
                let changed = false;
                for (const p of paths) {
                    const abs = path.resolve(cwd, p);
                    if (!settings[key].includes(abs)) {
                        settings[key].push(abs);
                        changed = true;
                    }
                }
                const mainAbs = path.resolve(cwd);
                if (!settings[key].includes(mainAbs)) {
                    settings[key].push(mainAbs);
                    changed = true;
                }
                if (changed) {
                    _safeWrite(trustPath, JSON.stringify(settings, null, 2));
                    console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} workspace trust for worktree(s)`);
                }
            } catch (e) {
                console.warn(`\u26A0\uFE0F  Could not pre-seed ${agent.displayName || agent.name} trust: ${e.message}`);
            }
            break;
        }
        case 'toml-project': {
            try {
                let config = '';
                if (fs.existsSync(trustPath)) {
                    config = fs.readFileSync(trustPath, 'utf8');
                }
                const pathsToTrust = [...new Set([process.cwd(), ...paths].map(p => path.resolve(p)))];
                let added = false;
                for (const tp of pathsToTrust) {
                    const entry = `[projects."${tp}"]`;
                    if (config.includes(entry)) continue;
                    if (config.length > 0 && !config.endsWith('\n')) config += '\n';
                    config += `\n${_buildTomlProjectEntry(tp, trust.trustLevel)}`;
                    added = true;
                }
                if (added) {
                    _safeWrite(trustPath, config);
                    console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} project trust for ${pathsToTrust.length} path(s)`);
                }
            } catch (e) {
                console.warn(`\u26A0\uFE0F  Could not pre-seed ${agent.displayName || agent.name} trust: ${e.message}`);
            }
            break;
        }
        case 'vscode-settings-bool': {
            // Sets a boolean in a VSCode/Cursor global settings JSON file.
            // Used to disable workspace trust globally (security.workspace.trust.enabled = false).
            if (_isMacAppDataPath(trustPath) && process.env.AIGON_ALLOW_APP_DATA_TRUST_WRITE !== '1') {
                // macOS prompts "node would like to access data from other apps"
                // for automated access under ~/Library/Application Support. Avoid
                // triggering that from background launches; Cursor Agent trust is
                // handled below via ~/.cursor/projects markers instead.
            } else {
                try {
                    let settings = {};
                    if (fs.existsSync(trustPath)) {
                        settings = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
                    }
                    if (settings[trust.key] !== trust.value) {
                        settings[trust.key] = trust.value;
                        _safeWrite(trustPath, JSON.stringify(settings, null, 2));
                        console.log(`\uD83D\uDD13 Configured ${agent.displayName || agent.name} workspace trust setting`);
                    }
                } catch (e) {
                    console.warn(`\u26A0\uFE0F  Could not configure ${agent.displayName || agent.name} trust: ${e.message}`);
                }
            }
            // Cursor Agent CLI still prompts per cwd until ~/.cursor/projects/<slug>/.workspace-trusted exists.
            if (trust.cursorProjectsRoot && paths && paths.length > 0) {
                try {
                    const wrote = ensureCursorAgentWorkspaceTrustedMarkers(trust.cursorProjectsRoot, paths);
                    if (wrote) {
                        console.log(`\uD83D\uDD13 Pre-seeded ${agent.displayName || agent.name} Agent workspace trust marker(s)`);
                    }
                } catch (e) {
                    console.warn(`\u26A0\uFE0F  Could not write ${agent.displayName || agent.name} Agent workspace trust markers: ${e.message}`);
                }
            }
            break;
        }
    }
}

/**
 * Register a single worktree path as trusted for an agent.
 * For json-kv type, uses the direct value (TRUST_FOLDER) rather than parent.
 */
function ensureSinglePathTrust(agentId, worktreePath) {
    const agent = getAgent(agentId);
    if (!agent?.trust) return;

    const trust = agent.trust;
    const trustFilePath = _resolvePath(trust.path);

    if (trust.type === 'json-kv') {
        try {
            let trusted = {};
            if (fs.existsSync(trustFilePath)) {
                trusted = JSON.parse(fs.readFileSync(trustFilePath, 'utf8'));
            }
            if (!trusted[worktreePath]) {
                trusted[worktreePath] = trust.value;
                _safeWrite(trustFilePath, JSON.stringify(trusted, null, 4));
                console.log(`   \uD83D\uDD13 Pre-registered ${agent.displayName || agent.name} trusted folder`);
            }
        } catch (e) { /* non-fatal */ }
    } else {
        ensureAgentTrust(agentId, [worktreePath]);
    }
}

/**
 * Remove trust entries for paths (used during worktree cleanup).
 */
function removeAgentTrust(agentId, paths) {
    const agent = getAgent(agentId);
    if (!agent?.trust) return;

    if (agent.trust.type === 'claude-json') {
        const trustPath = _resolvePath(agent.trust.path);
        try {
            if (!fs.existsSync(trustPath)) return;
            const config = JSON.parse(fs.readFileSync(trustPath, 'utf8'));
            if (!config.projects) return;
            const cwd = process.cwd();
            for (const p of paths) {
                delete config.projects[path.resolve(cwd, p)];
            }
            fs.writeFileSync(trustPath, JSON.stringify(config, null, 2));
        } catch (e) { /* Silent fail on cleanup */ }
        return;
    }

    if (agent.trust.type === 'toml-project') {
        const trustPath = _resolvePath(agent.trust.path);
        try {
            if (!fs.existsSync(trustPath)) return;
            let config = fs.readFileSync(trustPath, 'utf8');
            const resolvedPaths = [...new Set(paths.map(p => path.resolve(process.cwd(), p)))];
            resolvedPaths.forEach(projectPath => {
                config = _removeTomlProjectEntry(config, projectPath);
            });
            fs.writeFileSync(trustPath, config.replace(/^\n+/, ''));
        } catch (e) { /* Silent fail on cleanup */ }
        return;
    }

    if (agent.trust.type === 'vscode-settings-bool' && agent.trust.cursorProjectsRoot) {
        try {
            const root = _resolvePath(agent.trust.cursorProjectsRoot);
            const cwd = process.cwd();
            for (const p of paths) {
                const workspacePath = path.resolve(cwd, p);
                const slug = cursorAgentProjectSlug(workspacePath);
                const marker = path.join(root, slug, '.workspace-trusted');
                if (fs.existsSync(marker)) fs.unlinkSync(marker);
            }
        } catch (e) { /* Silent fail on cleanup */ }
    }
}

// --- Worktree environment ---

function _shellQuote(s) {
    if (/^[A-Za-z0-9_./:=-]+$/.test(s)) return s;
    return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build shell export statements for agent-specific worktree env vars.
 * Returns empty string if the agent has no worktreeEnv config.
 * Includes trailing ' && ' when non-empty.
 */
function getWorktreeEnvExports(agentId, worktreePath) {
    const agent = getAgent(agentId);
    if (!agent?.worktreeEnv || Object.keys(agent.worktreeEnv).length === 0) return '';

    const exports = [];
    for (const [key, template] of Object.entries(agent.worktreeEnv)) {
        const value = template.replace('{worktreePath}', worktreePath);
        exports.push(`export ${key}=${_shellQuote(value)}`);
    }
    return exports.join(' && ') + ' && ';
}

// --- Agent capability checks ---

function supportsModelFlag(agentId) {
    const agent = getAgent(agentId);
    return agent?.capabilities?.supportsModelFlag !== false;
}

function supportsTranscriptTelemetry(agentId) {
    const agent = getAgent(agentId);
    return agent?.capabilities?.transcriptTelemetry === true;
}

// Defaults to false (fail-closed): an agent that does not declare native
// slash-command resolution must not receive slash-command-shaped directives
// in mid-session tmux injections — they would arrive as unrunnable phantoms.
function isSlashCommandInvocable(agentId) {
    const agent = getAgent(agentId);
    return agent?.capabilities?.resolvesSlashCommands === true;
}

function getTokenExhaustionDetectors(agentId) {
    const agent = getAgent(agentId);
    const raw = agent?.failureDetectors?.tokenExhaustion;
    if (!raw || typeof raw !== 'object') {
        return { exitCodes: [], stderrPatterns: [] };
    }
    return {
        exitCodes: Array.isArray(raw.exitCodes) ? raw.exitCodes.map(Number).filter(Number.isFinite) : [],
        stderrPatterns: Array.isArray(raw.stderrPatterns) ? raw.stderrPatterns.map(String).filter(Boolean) : [],
    };
}

// --- Sort order (by portOffset) ---

function getAllKnownSortedAgentIds() {
    return getAllAgents()
        .sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99))
        .map(a => a.id);
}

function getSortedAgentIds() {
    return getLaunchableAgents()
        .sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99))
        .map(a => a.id);
}

// --- Default fleet agents ---

function getDefaultFleetAgents(repoPath = process.cwd()) {
    return require('./agent-availability').getDefaultFleetAgents(repoPath);
}

// --- Install hints (for doctor command) ---

function getAgentBinMap() {
    const map = {};
    for (const a of getLaunchableAgents()) {
        if (a.cli?.command) map[a.id] = a.cli.command;
    }
    return map;
}

function getAgentCliPathCandidates(agentId) {
    const agent = getAgent(agentId);
    if (!agent) return [];
    if (Array.isArray(agent.cli?.pathCandidates) && agent.cli.pathCandidates.length > 0) {
        return agent.cli.pathCandidates.map(String);
    }
    return [];
}

function resolveAgentCliBinary(agentId, commandOverride) {
    const { resolveBinary } = require('./binary-check');
    const agent = getAgent(agentId);
    const binary = commandOverride || agent?.cli?.command;
    if (!binary) return null;
    return resolveBinary(binary, { candidates: getAgentCliPathCandidates(agentId) });
}

function getAgentInstallHints() {
    const map = {};
    for (const a of getLaunchableAgents()) if (a.installHint) map[a.id] = a.installHint;
    return map;
}

function describeImplementMode(agent) {
    const flag = String(agent?.cli?.implementFlag || '').trim();
    if (flag.includes('acceptEdits')) return 'Auto-edits, prompts for risky Bash';
    if (flag.includes('--yolo')) return 'Auto-approves all';
    if (flag.includes('--force')) return 'Auto-approves commands (yolo mode)';
    if (!flag) return 'Workspace-write, smart approval';
    return flag;
}

function getAgentCliMappingRows() {
    return getLaunchableAgents()
        .slice()
        .sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99))
        .map(agent => ({
            id: agent.id,
            displayName: agent.displayName || agent.name,
            command: [agent.cli?.command, agent.cli?.implementFlag].filter(Boolean).join(' ').trim(),
            mode: describeImplementMode(agent),
        }));
}

function getRegistryBackedAgentGroups() {
    const slashCommandAgentIds = [];
    const skillAgentIds = [];
    for (const agent of getLaunchableAgents()) {
        if (agent?.capabilities?.resolvesSlashCommands === true) {
            slashCommandAgentIds.push(agent.id);
        } else {
            skillAgentIds.push(agent.id);
        }
    }
    return { slashCommandAgentIds, skillAgentIds };
}

function getDashboardAgents(opts = {}) {
    // F454: resolve default-model strings inline so the dashboard's
    // showAutonomousModal can paint skeleton rows without a /api/settings
    // round-trip. Precedence matches buildDashboardSettingsPayload:
    // project config → global config → DEFAULT_GLOBAL_CONFIG.
    const { globalConfig, projectConfig } = opts || {};
    let resolveModel = () => undefined;
    if (globalConfig || projectConfig) {
        const cfg = require('./config-core');
        const builtIn = { ...cfg.buildDefaultGlobalConfigBase(), agents: {} };
        const getCfgModel = cfg.getConfigModelValue;
        resolveModel = (agentId, taskType) => {
            const candidates = [
                projectConfig && getCfgModel(projectConfig, agentId, taskType),
                globalConfig && getCfgModel(globalConfig, agentId, taskType),
                builtIn && getCfgModel(builtIn, agentId, taskType),
            ].filter(v => v != null && String(v).trim() !== '');
            return candidates.find(v => isKnownModelValue(agentId, v)) || undefined;
        };
    }
    const modelOptsCfg = {
        projectConfig: projectConfig || undefined,
        globalConfig: globalConfig || undefined,
    };
    const repoPath = opts.repoPath || process.cwd();
    let getAvail;
    try {
        getAvail = require('./agent-availability').getAgentAvailability;
    } catch (_) {
        getAvail = () => ({ state: 'active', usable: true, pickerVisible: true, recommended: true });
    }
    return getLaunchableAgents()
        .slice()
        .sort((a, b) => (a.portOffset || 99) - (b.portOffset || 99))
        .map(agent => {
            const mergedModelOptions = getModelOptions(agent.id, modelOptsCfg);
            const availability = getAvail(agent.id, repoPath);
            return {
            id: agent.id,
            displayName: agent.displayName || agent.name,
            shortName: agent.shortName || String(agent.id || '').toUpperCase(),
            autonomousEligible: agent?.signals?.shellTrap === true,
            defaultFleetAgent: agent.defaultFleetAgent === true,
            slashCommandInvocable: agent?.capabilities?.resolvesSlashCommands === true,
            pickerEligible: availability.pickerVisible && availability.usable,
            availability: {
                state: availability.state,
                usable: availability.usable,
                pickerVisible: availability.pickerVisible,
                recommended: availability.recommended,
                reason: availability.reason || null,
            },
            cmdPrefix: agent?.placeholders?.CMD_PREFIX || '/aigon:',
            modelOptions: mergedModelOptions.map(o => {
                const { notes: _n, score: _s, pricing: _p, lastRefreshAt: _r, ...rest } = o;
                return rest;
            }),
            effortOptions: Array.isArray(agent?.cli?.effortOptions)
                ? agent.cli.effortOptions.map(o => ({ ...o }))
                : [],
            supportsModelPicker: mergedModelOptions.length > 0,
            supportsEffortPicker: Array.isArray(agent?.cli?.effortOptions) && agent.cli.effortOptions.length > 0,
            defaultImplementModel: resolveModel(agent.id, 'implement') || null,
            defaultResearchModel: resolveModel(agent.id, 'research') || null,
            defaultEvaluateModel: resolveModel(agent.id, 'evaluate') || null,
            defaultReviewModel: resolveModel(agent.id, 'review') || null,
            quotaProviders: Array.isArray(agent.quotaProviders) ? [...agent.quotaProviders] : [],
        };
        });
}

function getLegacyAgentConfigs() {
    const configs = {};
    for (const agent of getAllAgents()) {
        configs[agent.id] = {
            id: agent.id,
            name: agent.displayName || agent.name,
            rootFile: agent.rootFile || null,
            supportsAgentsMd: agent.supportsAgentsMd === true,
            agentFile: agent.agentFile,
            templatePath: agent.templatePath,
            port: agent.portOffset != null ? 3000 + Number(agent.portOffset) : null,
            terminalColor: agent.terminalColor || 'blue',
            bannerColor: agent.bannerColor || '#888888',
        };
    }
    return configs;
}

// --- Legacy detection paths (for setup install-agent detection) ---

function getLegacyPaths(agentId) {
    const agent = getAgent(agentId);
    return agent?.legacy || {};
}

// --- Runtime capabilities (data-driven dispatch for per-agent behaviour) ---

function getAgentRuntime(agentId) {
    const agent = getAgent(agentId);
    return agent?.runtime || {};
}

function getSessionStrategy(agentId) {
    return getAgentRuntime(agentId).sessionStrategy || null;
}

function getTelemetryStrategy(agentId) {
    return getAgentRuntime(agentId).telemetryStrategy || null;
}

function getTrustInstallScope(agentId) {
    return getAgentRuntime(agentId).trustInstallScope || 'worktree-base';
}

function getResumeConfig(agentId) {
    return getAgentRuntime(agentId).resume || null;
}

function getContinuityCapabilities(agentId) {
    return getAgentRuntime(agentId).continuity || {};
}

function getCapturableAgentIds() {
    return getLaunchableAgents()
        .filter(a => a?.runtime?.sessionStrategy)
        .map(a => a.id);
}

module.exports = {
    getAgent,
    getAllAgentIds,
    getAllAgents,
    isAgentActive,
    isAgentLaunchable,
    getLaunchableAgentIds,
    getLaunchableAgents,
    formatDeactivatedAgentMessage,
    getAllKnownSortedAgentIds,
    getDisplayNames,
    getShortNames,
    getPortOffsets,
    getAgentAliasMap,
    getProviderFamilies,
    getAttributionAgentIds,
    getAgentEmailIds,
    getAgentEmailRegex,
    getKnownAgentIds,
    buildDefaultAgentConfigs,
    getProcessDetectionMap,
    ensureAgentTrust,
    ensureSinglePathTrust,
    removeAgentTrust,
    getWorktreeEnvExports,
    supportsModelFlag,
    supportsTranscriptTelemetry,
    isSlashCommandInvocable,
    getTokenExhaustionDetectors,
    getSortedAgentIds,
    getDefaultFleetAgents,
    getAgentBinMap,
    getAgentCliPathCandidates,
    resolveAgentCliBinary,
    getAgentInstallHints,
    getAgentCliMappingRows,
    getRegistryBackedAgentGroups,
    getDashboardAgents,
    getLegacyAgentConfigs,
    getLegacyPaths,
    getModelOptions,
    isKnownModelValue,
    isModelOptionQuarantined,
    isModelOptionArchived,
    validateModelOptions,
    validateCustomModelOptions,
    getEffortOptions,
    getModelFlag,
    getEffortFlag,
    getEffortEnv,
    getPromptFlag,
    getAgentRuntime,
    getSessionStrategy,
    getTelemetryStrategy,
    getTrustInstallScope,
    getResumeConfig,
    getContinuityCapabilities,
    getCapturableAgentIds,
    // For test overrides
    _resetCache: () => { _agents = null; },
    _test: {
        cursorAgentProjectSlug,
        listCursorProjectSlugVariants,
        ensureCursorAgentWorkspaceTrustedMarkers,
    },
};
