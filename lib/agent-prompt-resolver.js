'use strict';

/**
 * Agent prompt resolver.
 *
 * Most agents (cc, gg, cu, mv) launch via a slash command (e.g.
 * `/aigon:feature-do 218`) handed to the CLI as a positional arg. The
 * agent's CLI then resolves the slash command to a prompt file. This
 * works as long as the CLI's slash-command discovery is functional.
 *
 * Codex (cx) currently breaks this contract: `/prompts:` discovery from
 * `~/.codex/prompts/` is dead in 0.117+ (openai/codex#15941), and the
 * feature is being deprecated in favor of skills. Rather than waiting on
 * upstream, we resolve the prompt body inline at launch time and pass
 * the markdown body directly to codex as the initial prompt.
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

const TEMPLATES_ROOT = path.join(__dirname, '..', 'templates');

const VERB_TO_TEMPLATE = {
    do: 'feature-do',
    eval: 'feature-eval',
    review: 'feature-review',
};

const VERB_TO_PROMPT_FIELD = {
    do: 'implementPrompt',
    eval: 'evalPrompt',
    review: 'reviewPrompt',
};

/**
 * Resolve the launch prompt for an agent + verb.
 *
 * @param {Object} params
 * @param {string} params.agentId - Agent id (cc, gg, cx, ...).
 * @param {('do'|'eval'|'review')} params.verb - Lifecycle verb.
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

/**
 * Build the inline cx prompt body for a given verb.
 *
 * Reads the same canonical template that `install-agent cx` writes to
 * `~/.codex/prompts/aigon-feature-<verb>.md`, processes placeholders
 * with the cx + active-profile placeholder set, and substitutes
 * `$ARGUMENTS` / `$1` with the real feature id (and any flags).
 *
 * Frontmatter is stripped so the returned text is pure prompt body —
 * codex receives instructions, not a YAML header.
 */
function resolveCxPromptBody(verb, featureId, extraArgs = '') {
    const templateName = VERB_TO_TEMPLATE[verb];
    if (!templateName) {
        throw new Error(`resolveCxPromptBody: no template for verb '${verb}'`);
    }
    const templatePath = path.join(TEMPLATES_ROOT, 'generic', 'commands', `${templateName}.md`);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`resolveCxPromptBody: template missing at ${templatePath}`);
    }
    const raw = fs.readFileSync(templatePath, 'utf8');

    const cxConfig = loadAgentConfig('cx') || { placeholders: {} };
    let profilePlaceholders = {};
    try {
        profilePlaceholders = getProfilePlaceholders();
    } catch (_) {
        // getProfilePlaceholders touches the project config; in tests or
        // outside a project we degrade to template-only placeholders.
    }

    // Build the args string codex would normally see via $ARGUMENTS.
    const idStr = String(featureId);
    const argsString = [idStr, (extraArgs || '').trim()].filter(Boolean).join(' ');

    // The cx placeholder set normally maps {{ARG_SYNTAX}} → $ARGUMENTS
    // and {{ARG1_SYNTAX}} → $1, leaving codex to substitute at runtime.
    // Since we're inlining, substitute the real values now so the body
    // never contains $-tokens that codex (or a downstream shell) might
    // re-interpret.
    const placeholders = {
        ...cxConfig.placeholders,
        ...profilePlaceholders,
        ARG_SYNTAX: argsString,
        ARG1_SYNTAX: idStr,
    };

    let body = processTemplate(raw, placeholders);

    // Strip the description HTML comment (used by install-agent to
    // populate the prompt's frontmatter `description:` field).
    body = body.replace(/<!--\s*description:[^]*?-->\n?/, '');

    // Defensive: if a template ever ships with YAML frontmatter, drop it.
    body = body.replace(/^---\n[\s\S]*?\n---\n?/, '');

    // Belt-and-braces: if any $ARGUMENTS / $1 tokens slipped past the
    // placeholder map (e.g. literal in template body), substitute now.
    body = body.replaceAll('$ARGUMENTS', argsString).replaceAll('$1', idStr);

    return body.trimStart();
}

module.exports = {
    resolveAgentPromptBody,
    resolveCxPromptBody,
};
