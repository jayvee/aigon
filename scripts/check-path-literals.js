'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const LIB_ROOT = path.join(ROOT, 'lib');
const EXEMPT_PATH_PARTS = [
    path.join('workflow-core', 'paths.js'),
];
const STAGE_NAME_RE = /0[1-6]-(inbox|backlog|in-progress|in-evaluation|done|paused)/;

function isStagePathLiteralBody(body) {
    if (!STAGE_NAME_RE.test(body)) return false;
    return /^0[1-6]-(inbox|backlog|in-progress|in-evaluation|done|paused)$/.test(body)
        || /(^|[/.])0[1-6]-(inbox|backlog|in-progress|in-evaluation|done|paused)([/.]|$)/.test(body);
}

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, files);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

function isExempt(filePath) {
    const relative = path.relative(LIB_ROOT, filePath);
    if (relative.includes('migration')) return true;
    return EXEMPT_PATH_PARTS.some((part) => relative === part || relative.includes(part));
}

const violations = [];
for (const filePath of walk(LIB_ROOT)) {
    if (isExempt(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const token of acorn.tokenizer(content, { ecmaVersion: 'latest', allowHashBang: true })) {
        if (token.type.label !== 'string' && token.type.label !== 'template') continue;
        const raw = content.slice(token.start, token.end);
        const body = String(token.value);
        if (!isStagePathLiteralBody(body)) continue;
        const line = content.slice(0, token.start).split('\n').length;
        violations.push(`${path.relative(ROOT, filePath)}:${line}: ${raw}`);
    }
}

if (violations.length > 0) {
    console.error('Found inline stage-folder literals in lib/. Import STAGE_FOLDERS from lib/workflow-core/paths.js instead.');
    for (const violation of violations) {
        console.error(`  ${violation}`);
    }
    process.exit(1);
}
