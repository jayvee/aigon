#!/usr/bin/env node
'use strict';

/** Fast release-only source validation for the public documentation site. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CONTENT = path.join(ROOT, 'site/content');
const SITE = path.join(ROOT, 'site');
const errors = [];
const fail = (file, message) => errors.push(`${path.relative(ROOT, file)}: ${message}`);
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'public/_pagefind']);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) return [];
        return walk(path.join(dir, entry.name));
    }
    return [path.join(dir, entry.name)];
});
const mdxFiles = walk(CONTENT).filter(file => file.endsWith('.mdx'));
const pageFor = file => {
    const relative = path.relative(CONTENT, file).replace(/\\/g, '/');
    const slug = relative === 'index.mdx' ? '' : relative.replace(/\/index\.mdx$/, '').replace(/\.mdx$/, '');
    return `/docs${slug ? `/${slug}` : ''}`;
};
const pages = new Set(mdxFiles.map(pageFor));
const { getAllAgentIds, isAgentLaunchable } = require('../lib/agent-registry');
const deactivatedAgentIds = getAllAgentIds().filter(id => !isAgentLaunchable(id));

function executableCommands() {
    const factories = [
        ['./lib/commands/feature', 'createFeatureCommands'], ['./lib/commands/research', 'createResearchCommands'],
        ['./lib/commands/feedback', 'createFeedbackCommands'], ['./lib/commands/setup', 'createSetupCommands'],
        ['./lib/commands/infra', 'createInfraCommands'], ['./lib/commands/misc-compat', 'createMiscCommands'],
        ['./lib/commands/workflow', 'createWorkflowCommands'], ['./lib/commands/set', 'createSetCommands'],
        ['./lib/commands/recurring', 'createRecurringCommands'], ['./lib/commands/schedule', 'createScheduleCommands'],
        ['./lib/commands/agent-launch', 'createAgentLaunchCommands'], ['./lib/commands/agent', 'createAgentCommands'],
        ['./lib/commands/signal-health', 'createSignalHealthCommands'], ['./lib/commands/security-scan', 'createSecurityScanCommands'],
    ];
    const internal = new Set(['feature-spec-review-record', 'feature-spec-revise-record', 'research-spec-review-record', 'research-spec-revise-record', 'capture-session-telemetry', 'capture-antigravity-telemetry', 'check-agent-signal', 'check-agent-submitted', 'terminal-focus', 'hooks', 'global-setup', 'check-prerequisites', 'security-scan-commit', 'recurring-run']);
    const deprecated = new Set(['update', 'feature-review', 'research-review']);
    return factories.flatMap(([module, name]) => Object.keys(require(path.join(ROOT, module))[name]()).map(command => ({ command, classification: internal.has(command) ? 'internal' : deprecated.has(command) ? 'deprecated' : 'public' })));
}

for (const file of mdxFiles) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/^---\n[\s\S]*?^---\n/m.test(text)) fail(file, 'missing frontmatter');
    if (!/^title:\s*\S/m.test(text)) fail(file, 'missing frontmatter title');
    if (!/^description:\s*\S/m.test(text)) fail(file, 'missing frontmatter description');
    if (/TODO|TBD|\[INSERT|<placeholder>|lorem ipsum/i.test(text)) fail(file, 'contains a placeholder marker');
    for (const match of text.matchAll(/!?\[[^\]]*\]\((\/docs\/[^)#?]+)(?:#[^)]+)?\)/g)) if (!pages.has(match[1].replace(/\/$/, ''))) fail(file, `broken internal link ${match[1]}`);
    for (const match of text.matchAll(/!\[[^\]]*\]\((\/img\/[^)]+)\)/g)) if (!fs.existsSync(path.join(SITE, 'public', match[1].slice(1)))) fail(file, `missing image ${match[1]}`);
    if (/\bgg\b|Gemini CLI|ANTIGRAVITY_API_KEY|ANTIGRAVITY_TOKEN|headless Antigravity|periodic quota probe/i.test(text)) fail(file, 'contains a retired/unsupported Antigravity example or authentication claim');
    for (const match of text.matchAll(/aigon\s+(?:install-agent|feature-start|research-start|feature-open|research-open)\b[^\n]*/g)) {
        for (const id of deactivatedAgentIds) {
            if (new RegExp(`\\b${id}\\b`).test(match[0])) fail(file, `references deactivated agent ID ${id} in command example: ${match[0].trim()}`);
        }
    }
}
for (const file of walk(SITE).filter(file => /\.(mdx|tsx|ts|html)$/i.test(file))) if (/\bMIT License\b|licensed under MIT/i.test(fs.readFileSync(file, 'utf8'))) fail(file, 'marketing copy must identify Apache-2.0, not MIT');
const documented = new Set(mdxFiles.map(file => path.basename(file, '.mdx')));
const groupedReferences = new Map();
for (const command of ['init', 'uninstall', 'project-context', 'trust-worktree', 'install-seed', 'check-version']) groupedReferences.set(command, '/docs/reference/commands');
for (const command of ['feature-list', 'feature-status', 'feature-spec', 'feature-context', 'feature-transfer', 'feature-pause', 'feature-resume', 'feature-spec-review', 'feature-spec-revise', 'feature-cancel-spec-review', 'feature-cancel-spec-revision', 'feature-transcript', 'feature-unprioritise', 'feature-delete', 'feature-rebase', 'feature-backfill-timestamps', 'feature-autonomous-resume', 'feature-escalation']) groupedReferences.set(command, '/docs/reference/commands');
for (const command of ['research-context', 'research-pause', 'research-resume', 'research-spec-review', 'research-spec-revise', 'research-cancel-spec-review', 'research-cancel-spec-revision', 'research-cancel-code-review', 'research-transcript', 'research-unprioritise', 'research-review', 'research-reset', 'research-delete', 'research-submit']) groupedReferences.set(command, '/docs/reference/commands');
for (const command of ['agent-probe', 'agent-quota', 'commits', 'stats', 'profile', 'nudge', 'agent-context', 'workflow-rules', 'rollout', 'agent-resume']) groupedReferences.set(command, '/docs/reference/commands');
for (const command of ['set', 'set-prioritise', 'feature-set-spec-review', 'feature-set-spec-revise', 'set-autonomous-start', 'set-autonomous-stop', 'set-autonomous-resume', 'set-autonomous-reset']) groupedReferences.set(command, '/docs/reference/commands');
for (const command of ['feedback-migrate']) groupedReferences.set(command, '/docs/reference/commands');
for (const command of ['update']) groupedReferences.set(command, '/docs/reference/commands/setup/apply');
for (const command of ['sync', 'backup', 'recurring-list', 'schedule', 'agent-launch', 'agent', 'signal-health', 'installed-notice']) groupedReferences.set(command, '/docs/reference/commands');
const commandIndex = fs.readFileSync(path.join(CONTENT, 'reference/commands/index.mdx'), 'utf8');
const commands = executableCommands();
for (const entry of commands) {
    const reference = groupedReferences.get(entry.command);
    if (entry.classification !== 'internal' && !documented.has(entry.command) && (!reference || !pages.has(reference) || !commandIndex.includes(`\`${entry.command}\``))) fail(path.join(CONTENT, 'reference/commands/index.mdx'), `no reference page or approved grouping for executable command ${entry.command} (${entry.classification})`);
}
if (errors.length) { console.error(`Documentation check failed (${errors.length} issues):`); errors.forEach(error => console.error(`- ${error}`)); process.exit(1); }
console.log(`✓ docs:check validated ${mdxFiles.length} MDX pages and ${commands.length} executable commands`);
