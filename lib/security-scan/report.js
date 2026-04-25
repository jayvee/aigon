'use strict';

const fs = require('fs');
const path = require('path');

const SCAN_DIR = '.scan';
const REPORTS_DIR = path.join(SCAN_DIR, 'reports');
const RAW_DIR = path.join(SCAN_DIR, 'raw');
const STATE_FILE = path.join(SCAN_DIR, 'state.json');

function ensureDirs(cwd) {
    fs.mkdirSync(path.join(cwd, REPORTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(cwd, RAW_DIR), { recursive: true });
}

function readState(cwd) {
    const stateFile = path.join(cwd, STATE_FILE);
    if (!fs.existsSync(stateFile)) return null;
    try {
        return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeState(cwd, sha, iso) {
    const stateFile = path.join(cwd, STATE_FILE);
    const state = { lastScanSha: sha, lastScanIso: iso, version: 1 };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}

function readSuppressions(cwd) {
    const suppFile = path.join(cwd, SCAN_DIR, 'suppressions.json');
    if (!fs.existsSync(suppFile)) return [];
    try {
        return JSON.parse(fs.readFileSync(suppFile, 'utf8')) || [];
    } catch (_) {
        return [];
    }
}

function stashRaw(cwd, tool, ext, content) {
    if (!content) return;
    const dest = path.join(cwd, RAW_DIR, `${tool}.${ext}`);
    try {
        fs.writeFileSync(dest, content);
    } catch (_) {}
}

function buildMarkdownDigest(top, overflow, total, meta = {}) {
    const lines = [];
    const dateStr = meta.iso || new Date().toISOString().slice(0, 10);
    lines.push(`# Security Scan — ${dateStr}`);
    lines.push('');
    if (meta.since) lines.push(`**Scope:** commits since \`${meta.since}\``);
    lines.push(`**Total findings (pre-triage):** ${meta.totalRaw || total}`);
    lines.push(`**Showing:** ${top.length} of ${total}`);
    lines.push('');

    if (top.length === 0) {
        lines.push('✅ No significant findings.');
    } else {
        lines.push('## Findings');
        lines.push('');
        for (let i = 0; i < top.length; i++) {
            const f = top[i];
            const loc = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
            lines.push(`### ${i + 1}. [${f.severity}] ${f.category}`);
            if (loc) lines.push(`**Location:** ${loc}`);
            lines.push(`**Tool:** ${f.tool}`);
            lines.push(`**Confidence:** ${Math.round((f.confidence || 0) * 100)}%`);
            lines.push(`**Fingerprint:** \`${f.fingerprint}\``);
            lines.push('');
            lines.push(f.message || '');
            lines.push('');
        }
    }

    if (overflow > 0) {
        lines.push(`---`);
        lines.push(`${overflow} additional findings — see .scan/reports/${dateStr}.json`);
    }

    return lines.join('\n');
}

function writeReport(cwd, { top, overflow, total }, allFindings, meta = {}, dryRun = false) {
    const iso = meta.iso || new Date().toISOString().slice(0, 10);
    const report = {
        version: 1,
        iso,
        since: meta.since || null,
        totalRaw: meta.totalRaw || allFindings.length,
        total,
        showing: top.length,
        overflow,
        findings: top,
        allFindings,
    };
    const digest = buildMarkdownDigest(top, overflow, total, { ...meta, iso });

    if (dryRun) {
        return { iso, jsonPath: null, mdPath: null, report, digest };
    }

    ensureDirs(cwd);
    const jsonPath = path.join(cwd, REPORTS_DIR, `${iso}.json`);
    const mdPath = path.join(cwd, REPORTS_DIR, `${iso}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(mdPath, digest + '\n');

    return { iso, jsonPath, mdPath, report, digest };
}

module.exports = { readState, writeState, readSuppressions, stashRaw, writeReport, buildMarkdownDigest };
