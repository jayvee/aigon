#!/usr/bin/env node

/**
 * gen-commands.js — Auto-generate CLI command MDX reference pages
 *
 * ⚠️  WARNING: Running this script will OVERWRITE manually enriched MDX pages in
 * site/content/reference/commands/. The committed MDX pages are the canonical
 * source — do NOT run gen-commands unless you intend to regenerate from scratch
 * and re-apply enrichments. See feature-340 for context.
 *
 * Reads COMMAND_REGISTRY from lib/templates.js and template descriptions from
 * templates/generic/commands/*.md to produce individual MDX pages in
 * site/content/docs/reference/commands/.
 *
 * Run: npm run gen-commands (from site/)
 */

const fs = require('fs');
const path = require('path');

// Paths relative to the repo root (script runs from site/)
const REPO_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates/generic/commands');
const OUTPUT_DIR = path.join(__dirname, '../content/docs/reference/commands');

// Import COMMAND_REGISTRY from lib/templates.js
const { COMMAND_REGISTRY } = require(path.join(REPO_ROOT, 'lib/templates.js'));

/**
 * Extract description from template HTML comment: <!-- description: ... -->
 */
function extractDescription(templateContent) {
    const match = templateContent.match(/<!--\s*description:\s*(.+?)\s*-->/);
    return match ? match[1].trim() : '';
}

/**
 * Group commands by domain prefix
 */
function groupCommands(registry) {
    const groups = {
        feature: { title: 'Feature Commands', commands: [] },
        research: { title: 'Research Commands', commands: [] },
        feedback: { title: 'Feedback Commands', commands: [] },
        infra: { title: 'Infrastructure Commands', commands: [] },
    };

    for (const [name, def] of Object.entries(registry)) {
        const entry = { name, ...def };
        if (name.startsWith('feature-')) groups.feature.commands.push(entry);
        else if (name.startsWith('research-')) groups.research.commands.push(entry);
        else if (name.startsWith('feedback-')) groups.feedback.commands.push(entry);
        else groups.infra.commands.push(entry);
    }

    return groups;
}

/**
 * Escape angle brackets in text so MDX doesn't parse them as JSX
 */
function escapeMdx(text) {
    return text.replace(/</g, '\\<').replace(/>/g, '\\>');
}

/**
 * Extract --flag patterns from argHints string
 */
function getFlags(argHints) {
    if (!argHints) return [];
    const found = argHints.match(/--[a-z0-9-]+(?:=<[^>]+>)?/gi) || [];
    return Array.from(new Set(found));
}

/**
 * Generate MDX content for a single command
 */
function generateCommandMdx(name, def, description) {
    const aliases = def.aliases ? def.aliases.join(', ') : '';
    const argHints = def.argHints || '';
    const safeDescription = description ? escapeMdx(description) : '';

    // Frontmatter description needs clean text (no backslash escapes)
    const fmDescription = (description || `Reference for aigon ${name}`).replace(/[<>]/g, '');

    let mdx = `---
title: "${name}"
description: "${fmDescription}"
---

## Synopsis

\`\`\`bash
aigon ${name}${argHints ? ` ${argHints}` : ''}
\`\`\`
`;

    if (aliases) {
        mdx += `
## Shortcuts

${aliases.split(', ').map(a => `- \`/${a}\` (slash command) · \`aigon ${a}\` (CLI)`).join('\n')}
`;
    }

    const flags = getFlags(argHints);
    if (flags.length > 0) {
        mdx += `
## Flags

${flags.map(f => `- \`${f}\``).join('\n')}
`;
    }

    if (safeDescription) {
        mdx += `
## Description

${safeDescription}
`;
    }

    // Add slash command examples
    const slashExamples = [];
    if (def.aliases) {
        // Show both slash and CLI usage
        slashExamples.push(`\`\`\`bash
# Slash command (Claude Code / Gemini)
/aigon:${name}${argHints ? ` ${argHints.split(' ')[0]}` : ''}

# CLI
aigon ${name}${argHints ? ` ${argHints.split(' ')[0]}` : ''}
\`\`\``);
    }

    if (slashExamples.length > 0) {
        mdx += `
## Usage

${slashExamples.join('\n\n')}
`;
    }

    return mdx;
}

// --- Main ---

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Read template descriptions
const templateDescriptions = {};
if (fs.existsSync(TEMPLATES_DIR)) {
    for (const file of fs.readdirSync(TEMPLATES_DIR)) {
        if (!file.endsWith('.md')) continue;
        const name = file.replace('.md', '');
        const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
        templateDescriptions[name] = extractDescription(content);
    }
}

// Group commands
const groups = groupCommands(COMMAND_REGISTRY);

// Generate individual command pages
let generated = 0;
for (const [name, def] of Object.entries(COMMAND_REGISTRY)) {
    const description = templateDescriptions[name] || '';
    const mdx = generateCommandMdx(name, def, description);
    const outPath = path.join(OUTPUT_DIR, `${name}.mdx`);
    fs.writeFileSync(outPath, mdx);
    generated++;
}

// Generate commands meta.json for navigation
const commandPages = Object.keys(COMMAND_REGISTRY).sort();
const metaJson = {
    title: 'Commands',
    pages: commandPages,
};
fs.writeFileSync(path.join(OUTPUT_DIR, 'meta.json'), JSON.stringify(metaJson, null, 2) + '\n');

// Generate the cli-commands.mdx index page
const indexLines = [`---
title: CLI Commands
description: Complete reference for all Aigon CLI commands.
---

Auto-generated reference for all Aigon CLI commands. Each command has its own page with synopsis, aliases, and usage examples.

`];

for (const [key, group] of Object.entries(groups)) {
    if (group.commands.length === 0) continue;
    indexLines.push(`## ${group.title}\n`);
    indexLines.push('| Command | Aliases | Description |');
    indexLines.push('|---------|---------|-------------|');
    for (const cmd of group.commands) {
        const desc = escapeMdx(templateDescriptions[cmd.name] || '');
        const aliases = cmd.aliases ? cmd.aliases.map(a => `\`${a}\``).join(', ') : '—';
        indexLines.push(`| [\`${cmd.name}\`](/docs/reference/commands/${cmd.name}) | ${aliases} | ${desc} |`);
    }
    indexLines.push('');
}

fs.writeFileSync(
    path.join(__dirname, '../content/docs/reference/cli-commands.mdx'),
    indexLines.join('\n')
);

console.log(`✅ Generated ${generated} command pages in site/content/docs/reference/commands/`);
console.log(`✅ Updated cli-commands.mdx index page`);
