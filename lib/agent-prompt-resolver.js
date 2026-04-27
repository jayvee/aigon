'use strict';

/**
 * Agent prompt resolver.
 *
 * Slash-command invocable agents (cc, gg, cu — `capabilities.resolves-
 * SlashCommands: true`) launch via a slash command (e.g.
 * `/aigon:feature-do 218`) handed to the CLI as a positional arg. The
 * agent's CLI then resolves the slash command to a prompt file.
 *
 * Non-invocable agents (cx, op, … — `resolvesSlashCommands: false`)
 * take a different route: aigon-spawned sessions never rely on the
 * CLI's command-discovery mechanism. `install-agent` still writes
 * project-local Skills (`.agents/skills/<name>/SKILL.md`) for
 * *interactive* use, but for in-process launches we inline the canonical
 * template body so the launch is independent of skill discovery,
 * frontmatter parsing, and any future upstream packaging changes.
 *
 * Codex (cx) pioneered this path after openai/codex#15941 broke
 * `~/.codex/prompts/` discovery; OpenCode (op) reuses it for the same
 * reason — OpenCode's skill resolution is descriptor-driven rather than
 * explicit invocation. Any future non-invocable agent picks the path up
 * automatically from its capability flag.
 *
 * This module owns that resolution. The default path returns the legacy
 * `cliConfig.<verb>Prompt` string (preserving slash-invocable behavior).
 * The inline path reads the canonical template under
 * `templates/generic/commands/`, substitutes placeholders with the
 * agent's own set, strips frontmatter, and returns the resulting
 * markdown body.
 */

const fs = require('fs');
const path = require('path');

const { processTemplate, loadAgentConfig } = require('./templates');
const { getProfilePlaceholders } = require('./profile-placeholders');
const { isSlashCommandInvocable } = require('./agent-registry');

const TEMPLATES_ROOT = path.join(__dirname, '..', 'templates');

const VERB_TO_TEMPLATE = {
    do: 'feature-do',
    eval: 'feature-eval',
    review: 'feature-code-review',
    revise: 'feature-code-revise',
};

const VERB_TO_PROMPT_FIELD = {
    do: 'implementPrompt',
    eval: 'evalPrompt',
    review: 'reviewPrompt',
    revise: 'reviewCheckPrompt',
};

/**
 * Resolve the launch prompt for an agent + verb.
 *
 * @param {Object} params
 * @param {string} params.agentId - Agent id (cc, gg, cx, ...).
 * @param {('do'|'eval'|'review'|'revise')} params.verb - Lifecycle verb.
 * @param {string} params.featureId - Feature id (typically zero-padded).
 * @param {string} [params.extraArgs] - Extra args appended after the id
 *   (e.g. `--no-launch --force`).
 * @param {Object} [params.cliConfig] - Pre-resolved cli config (avoids a
 *   second config load when the caller already has one). Required for
 *   non-cx agents to preserve project/global overrides of the prompt
 *   field.
 * @returns {string} Prompt text to hand to the agent CLI as a positional
 *   argument. For non-cx agents this is a short slash-command string.
 *   For cx it is the full markdown body of the corresponding template.
 */
function resolveAgentPromptBody({ agentId, verb, featureId, extraArgs = '', cliConfig = null, extraPlaceholders = null }) {
    if (!verb || !VERB_TO_PROMPT_FIELD[verb]) {
        throw new Error(`resolveAgentPromptBody: unknown verb '${verb}'`);
    }

    const field = VERB_TO_PROMPT_FIELD[verb];
    const template = (cliConfig && cliConfig[field]) || (cliConfig && cliConfig.implementPrompt) || '';

    // Slash-invocable agents register a template like "/aigon:feature-do
    // {featureId}". Non-invocable agents (cx, op, …) register a bare
    // template name ("feature-do") or no template at all — inline the
    // canonical body in that case.
    if (!template.includes('{featureId}')) {
        return resolveCxPromptBody(verb, featureId, extraArgs, agentId, extraPlaceholders);
    }

    let result = template.replaceAll('{featureId}', String(featureId));
    if (extraArgs && extraArgs.trim()) {
        result += ` ${extraArgs.trim()}`;
    }
    return result;
}

function resolveAgentCommandPrompt({ agentId, commandName, argsString = '', cliConfig = null }) {
    const trimmedCommand = String(commandName || '').trim();
    if (!trimmedCommand) {
        throw new Error('resolveAgentCommandPrompt: commandName is required');
    }
    if (!isSlashCommandInvocable(agentId)) {
        return resolveCxCommandBody(trimmedCommand, argsString, agentId);
    }

    const agentConfig = loadAgentConfig(agentId) || { placeholders: {} };
    const cmdPrefix = agentConfig.placeholders?.CMD_PREFIX || '/aigon:';
    return [cmdPrefix + trimmedCommand, String(argsString || '').trim()].filter(Boolean).join(' ').trim();
}

/**
 * Build the inline cx prompt body for a given verb.
 *
 * Reads the same canonical template that `install-agent cx` packages
 * into `.agents/skills/aigon-feature-<verb>/SKILL.md`, processes
 * placeholders with the cx + active-profile placeholder set, and
 * substitutes `$ARGUMENTS` / `$1` with the real feature id (and any
 * flags).
 *
 * Frontmatter is stripped so the returned text is pure prompt body —
 * codex receives instructions, not a YAML header.
 */
function resolveCxPromptBody(verb, featureId, extraArgs = '', agentId = 'cx', extraPlaceholders = null) {
    const templateName = VERB_TO_TEMPLATE[verb];
    if (!templateName) {
        throw new Error(`resolveCxPromptBody: no template for verb '${verb}'`);
    }
    const idStr = String(featureId);
    const argsString = [idStr, (extraArgs || '').trim()].filter(Boolean).join(' ');
    return resolveCxCommandBody(templateName, argsString, agentId, extraPlaceholders);
}

function resolveCxCommandBody(commandName, argsString = '', agentId = 'cx', extraPlaceholders = null) {
    const trimmedArgs = String(argsString || '').trim();
    const firstArg = trimmedArgs.split(/\s+/).filter(Boolean)[0] || '';
    const templatePath = path.join(TEMPLATES_ROOT, 'generic', 'commands', `${commandName}.md`);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`resolveCxCommandBody: template missing at ${templatePath}`);
    }
    const raw = fs.readFileSync(templatePath, 'utf8');

    const cxConfig = loadAgentConfig(agentId) || { placeholders: {} };
    let profilePlaceholders = {};
    try {
        profilePlaceholders = getProfilePlaceholders({ repoPath: process.cwd() });
    } catch (_) {
        // getProfilePlaceholders touches the project config; in tests or
        // outside a project we degrade to template-only placeholders.
    }

    // Build the args string codex would normally see via $ARGUMENTS.
    // The cx placeholder set normally maps {{ARG_SYNTAX}} → $ARGUMENTS
    // and {{ARG1_SYNTAX}} → $1, leaving codex to substitute at runtime.
    // Since we're inlining, substitute the real values now so the body
    // never contains $-tokens that codex (or a downstream shell) might
    // re-interpret.
    const placeholders = {
        ...cxConfig.placeholders,
        ...profilePlaceholders,
        ...(extraPlaceholders || {}),
        ARG_SYNTAX: trimmedArgs,
        ARG1_SYNTAX: firstArg,
    };

    let body = processTemplate(raw, placeholders);

    // Strip the description HTML comment (used by install-agent to
    // populate the prompt's frontmatter `description:` field).
    body = body.replace(/<!--\s*description:[^]*?-->\n?/, '');

    // Defensive: if a template ever ships with YAML frontmatter, drop it.
    body = body.replace(/^---\n[\s\S]*?\n---\n?/, '');

    // Belt-and-braces: if any $ARGUMENTS / $1 tokens slipped past the
    // placeholder map (e.g. literal in template body), substitute now.
    body = body.replaceAll('$ARGUMENTS', trimmedArgs).replaceAll('$1', firstArg);

    return body.trimStart();
}

/**
 * Build the mid-session directive the AutoConductor injects into an
 * implementation tmux session after the reviewer signals `review-complete`.
 *
 * - Slash-command-invocable agents (cc/gg today) receive `${cmdPrefix}feature-
 *   code-revise ${featureId}` sourced from the agent's `reviewCheckPrompt`.
 * - Non-invocable agents (cx today; default for any new agent) receive a
 *   path-pointer prompt referencing the installed skill file. Pointing at a
 *   file is preferred over inlining the ~100-line skill body — `tmux send-keys
 *   -l` pastes verbatim and a short prompt is easier for the user to see.
 *   Full-body inlining via {@link resolveCxPromptBody} remains available as
 *   an escape hatch for contexts where the skill file is not on disk.
 *
 * Fail-closed: an agent whose capability flag is missing is treated as
 * non-invocable — path-pointer prompt, no phantom slash command.
 */
function buildReviewCheckFeedbackPrompt(agentId, featureId, { loadAgentConfig: loader } = {}) {
    const loadCfg = loader || loadAgentConfig;
    const agentConfig = loadCfg(agentId) || {};
    const slashCommandInvocable = typeof agentConfig?.capabilities?.resolvesSlashCommands === 'boolean'
        ? agentConfig.capabilities.resolvesSlashCommands
        : isSlashCommandInvocable(agentId);
    if (slashCommandInvocable) {
        const invocation = resolveAgentPromptBody({
            agentId,
            verb: 'revise',
            featureId,
            cliConfig: agentConfig.cli || {},
        });
        return `The review is complete. Please run ${invocation} to address the review feedback, then signal completion with: aigon agent-status revision-complete`;
    }
    const skillPath = buildAgentSkillPath(agentConfig, 'feature-code-revise');
    return `The review is complete. Read \`${skillPath}\` and follow its instructions for feature ${featureId}. When done: aigon agent-status revision-complete`;
}

// Derive the on-disk skill/command file path for an agent's installed
// feature-<verb> definition. Data-driven from agent.output so each agent's
// path reflects where `install-agent` actually wrote it.
function buildAgentSkillPath(agentConfig, verbName) {
    const out = agentConfig?.output || {};
    const dir = out.commandDir || '.agents/skills';
    const prefix = out.commandFilePrefix || '';
    if (out.skillFileName) {
        return `${dir}/${prefix}${verbName}/${out.skillFileName}`;
    }
    const ext = out.commandFileExtension || '.md';
    return `${dir}/${prefix}${verbName}${ext}`;
}

/**
 * Print a non-blocking agent suggestion line for review flows.
 * Reads spec complexity (if available) and prints the top-ranked agent
 * from rankAgentsForOperation. Safe to call; never throws.
 *
 * @param {string} op - Operation key: spec_review | review | implement | …
 * @param {string|null} specPath - Path to the spec file (to read complexity).
 */
function printTopAgentSuggestion(op, specPath) {
    try {
        const { rankAgentsForOperation, readSpecRecommendation } = require('./spec-recommendation');
        const rec = specPath ? readSpecRecommendation(specPath) : null;
        const complexity = rec && rec.complexity;
        const ranked = rankAgentsForOperation(op, complexity);
        const top = ranked.find(r => r.score != null) || ranked[0];
        if (!top) return;
        const parts = [`${top.agentId}`];
        if (top.model) parts.push(`(${top.model})`);
        const label = top.score != null ? `score ${top.score}` : 'qualitative only';
        console.log(`💡 Suggested agent: ${parts.join(' ')} — ${label} for ${op}${complexity ? '/' + complexity : ''}`);
    } catch (_) { /* non-fatal */ }
}

module.exports = {
    resolveAgentCommandPrompt,
    resolveAgentPromptBody,
    resolveCxCommandBody,
    resolveCxPromptBody,
    buildReviewCheckFeedbackPrompt,
    printTopAgentSuggestion,
};
