#!/usr/bin/env node
'use strict';

/**
 * REGRESSION: F640 — index.html Alpine expressions must not resolve bare app globals.
 * Cross-check against js/alpine-bindings.js AIGON_ALPINE_MARKUP_BINDINGS + Alpine.data names.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'templates/dashboard/index.html');

const FORBIDDEN_BARE = [
  'STAGE_LABELS',
  'AGENT_DISPLAY_NAMES',
  'buildAgentStatusSpan',
  'agentDisplayName',
  'openDrawer',
  'openResearchFindingsPeek',
  'buildMainDevServerHtml',
  'buildAskAgentHtml',
];

const html = fs.readFileSync(htmlPath, 'utf8');
const expressions = [];

const attrRe = /(?:x-(?:text|html|on(?::[\w.-]+)?|show|data|bind|model|for|if|init)|:class|:style)\s*=\s*"([^"]*)"/g;
let m;
while ((m = attrRe.exec(html)) !== null) expressions.push(m[1]);

const xdataRe = /x-data\s*=\s*"([^"]*)"/g;
while ((m = xdataRe.exec(html)) !== null) expressions.push(m[1]);

const violations = [];
for (const expr of expressions) {
  for (const name of FORBIDDEN_BARE) {
    const re = new RegExp(`(?<![.\\w])${name}(?![\\w])`);
    if (re.test(expr)) violations.push({ expr, name });
  }
  if (/\bmonitorView\s*\(\s*\)/.test(expr)) {
    violations.push({ expr, name: 'monitorView() — use x-data="monitorView"' });
  }
  if (/\bpipelineView\s*\(\s*\)/.test(expr)) {
    violations.push({ expr, name: 'pipelineView() — use x-data="pipelineView"' });
  }
}

if (violations.length) {
  console.error('Alpine binding boundary violations in templates/dashboard/index.html:');
  for (const v of violations) {
    console.error(`  - ${v.name} in: ${v.expr.slice(0, 100)}`);
  }
  process.exit(1);
}

console.log('✓ Alpine binding boundary check passed');
