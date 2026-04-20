'use strict';

/**
 * Agent prompt resolver.
 *
 * Most agents (cc, gg, cu) launch via a slash command (e.g.
 * `/aigon:feature-do 218`) handed to the CLI as a positional arg. The
 * agent's CLI then resolves the slash command to a prompt file. This
 * works as long as the CLI's slash-command discovery is functional.
 *
 * Codex (cx) takes a different route: aigon-spawned codex sessions never
 * rely on codex's command-discovery mechanism at all. Historically that
 * was because `~/.codex/prompts/` discovery was broken
 * (openai/codex#15941); upstream has since deprecated prompts entirely
 * in favour of Skills (`.agents/skills/<name>/SKILL.md`). `install-agent
 * cx` now writes Skills to the project repo for *interactive* use, but
 * for in-process launches we still inline the prompt body so the launch
 * is independent of skill discovery, frontmatter parsing, and any
 * future upstream packaging changes.
 *
 * This module owns that resolution. The default path returns the legacy
 * `cliConfig.<verb>Prompt` string (preserving cc/gg/cu behavior). The cx
 * path reads the canonical template under `templates/generic/commands/`,
 * substitutes placeholders the same way `install-agent cx` does, strips
 * frontmatter, and returns the resulting markdown body.
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
    review: 'feature-review',
    'review-check': 'feature-review-check',
};

const VERB_TO_PROMPT_FIELD = {
    do: 'implementPrompt',
    eval: 'evalPrompt',
    review: 'reviewPrompt',
    'review-check': 'reviewCheckPrompt',
};

/**
 * Resolve the launch prompt for an agent + verb.
 *
 * @param {Object} params
 * @param {string} params.agentId - Agent id (cc, gg, cx, ...).
 * @param {('do'|'eval'|'review'|'review-check')} params.verb - Lifecycle verb.
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
function resolveAgentPromptBody({ agentId, verb, featureId, extraArgs = '', cliConfig = null }) {
    if (!verb || !VERB_TO_PROMPT_FIELD[verb]) {
        throw new Error(`resolveAgentPromptBody: unknown verb '${verb}'`);
    }
    if (agentId === 'cx') {
        return resolveCxPromptBody(verb, featureId, extraArgs);
    }

    const field = VERB_TO_PROMPT_FIELD[verb];
    const template = (cliConfig && cliConfig[field]) || (cliConfig && cliConfig.implementPrompt) || '';
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
    if (agentId === 'cx') {
        return resolveCxCommandBody(trimmedCommand, argsString);
    }

    const agentConfig = loadAgentConfig(agentId) || { placeholders: {} };
    const cmdPrefix = agentConfig.placeholders?.CMD_PREFIX
        || (cliConfig && cliConfig.command === 'codex' ? '' : '/aigon:');
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
function resolveCxPromptBody(verb, featureId, extraArgs = '') {
    const templateName = VERB_TO_TEMPLATE[verb];
    if (!templateName) {
        throw new Error(`resolveCxPromptBody: no template for verb '${verb}'`);
    }
    const idStr = String(featureId);
    const argsString = [idStr, (extraArgs || '').trim()].filter(Boolean).join(' ');
    return resolveCxCommandBody(templateName, argsString);
}

function resolveCxCommandBody(commandName, argsString = '') {
    const trimmedArgs = String(argsString || '').trim();
    const firstArg = trimmedArgs.split(/\s+/).filter(Boolean)[0] || '';
    const templatePath = path.join(TEMPLATES_ROOT, 'generic', 'commands', `${commandName}.md`);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`resolveCxCommandBody: template missing at ${templatePath}`);
    }
    const raw = fs.readFileSync(templatePath, 'utf8');

    const cxConfig = loadAgentConfig('cx') || { placeholders: {} };
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
 *   review-check ${featureId}` sourced from the agent's `reviewCheckPrompt`.
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
            verb: 'review-check',
            featureId,
            cliConfig: agentConfig.cli || {},
        });
        return `The review is complete. Please run ${invocation} to check and address the review feedback, then signal completion with: aigon agent-status feedback-addressed`;
    }
    const skillPath = buildAgentSkillPath(agentConfig, 'feature-review-check');
    return `The review is complete. Read \`${skillPath}\` and follow its instructions for feature ${featureId}. When done: aigon agent-status feedback-addressed`;
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

module.exports = {
    resolveAgentCommandPrompt,
    resolveAgentPromptBody,
    resolveCxCommandBody,
    resolveCxPromptBody,
    buildReviewCheckFeedbackPrompt,
};
