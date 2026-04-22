'use strict';

const fs = require('fs');
const { parseFrontMatter, serializeYamlScalar } = require('./cli-parse');

function parseLogFrontmatterForBackfill(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return { fields: {}, events: [] };
    const block = m[1];
    const fields = {};
    const events = [];
    let inEvents = false;
    for (const line of block.split('\n')) {
        if (/^events:/.test(line)) { inEvents = true; continue; }
        if (inEvents) {
            if (line.startsWith('  - ')) {
                const tsMatch = line.match(/ts:\s*"([^"]+)"/);
                const statusMatch = line.match(/status:\s*(\w+)/);
                if (tsMatch && statusMatch) events.push({ ts: tsMatch[1], status: statusMatch[1] });
            } else if (line && !/^\s/.test(line)) {
                inEvents = false;
                const idx = line.indexOf(':');
                if (idx !== -1) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        } else {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            if (key) fields[key] = val;
        }
    }
    return { fields, events };
}

function estimateExpectedScopeFiles(specPath) {
    try {
        if (!specPath || !fs.existsSync(specPath)) return 1;
        const raw = fs.readFileSync(specPath, 'utf8');
        const parsed = parseFrontMatter(raw);
        const body = parsed.body || raw;

        const pathLike = new Set();
        const inlineCodeMatches = body.match(/`[^`\n]+`/g) || [];
        inlineCodeMatches.forEach(token => {
            const value = token.slice(1, -1).trim();
            if (!value || /\s/.test(value) || /^https?:\/\//i.test(value)) return;
            if (value.includes('/')) pathLike.add(value);
        });

        const acSection = body.match(/^##\s+Acceptance Criteria\s*\r?\n([\s\S]*?)(?=^##\s+|$)/im);
        const acCount = acSection
            ? (acSection[1].match(/^- \[(?: |x|X)\]/gm) || []).length
            : 0;

        const baseline = Math.max(1, Math.min(8, acCount || 1));
        return Math.max(pathLike.size, baseline);
    } catch (_) {
        return 1;
    }
}

function upsertLogFrontmatterScalars(safeWriteWithStatus, logPath, fields) {
    if (!logPath || !fs.existsSync(logPath)) return false;
    const keys = Object.keys(fields || {});
    if (keys.length === 0) return false;

    const content = fs.readFileSync(logPath, 'utf8');
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const serializedLines = keys.map(key => `${key}: ${serializeYamlScalar(fields[key])}`);
    let nextContent = content;

    if (fmMatch) {
        const lines = fmMatch[1].split(/\r?\n/);
        keys.forEach((key, index) => {
            const lineValue = serializedLines[index];
            const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`);
            const existingIndex = lines.findIndex(line => keyPattern.test(line));
            if (existingIndex >= 0) lines[existingIndex] = lineValue;
            else lines.push(lineValue);
        });
        const rebuilt = `---\n${lines.join('\n')}\n---\n`;
        nextContent = rebuilt + content.slice(fmMatch[0].length).replace(/^\r?\n/, '');
    } else {
        const frontmatter = `---\n${serializedLines.join('\n')}\n---\n\n`;
        nextContent = frontmatter + content.replace(/^﻿/, '');
    }

    if (nextContent === content) return false;
    safeWriteWithStatus(logPath, nextContent);
    return true;
}

module.exports = {
    parseLogFrontmatterForBackfill,
    estimateExpectedScopeFiles,
    upsertLogFrontmatterScalars,
};
