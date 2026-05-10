#!/usr/bin/env node
// F357: post-launch capture binds agent session file to sidecar via cwd matching.
// Covers: cc (Claude project-dir slug), gg (Gemini .project_root marker), cx (Codex session_meta.cwd),
//         old-file guard (returns null when no file is new enough), sidecar patch atomicity.
// F453: gg case rewritten — Gemini does not hash dir names with SHA256;
//       resolver scans for .project_root contents instead.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, report } = require('../_helpers');
const { findNewAgentSession, updateSessionSidecar } = require('../../lib/session-sidecar');

const claudeSlug = (p) => p.replace(/[/.]/g, '-');
const mkp = (p) => fs.mkdirSync(p, { recursive: true });
const writeF = (p, c = '{}') => { mkp(path.dirname(p)); fs.writeFileSync(p, c); };
const now = () => Date.now();

function withHome(fn) {
    const orig = process.env.HOME;
    return (fh) => {
        process.env.HOME = fh;
        try { fn(fh); } finally { process.env.HOME = orig; }
    };
}

test('cc: finds newest JSONL in project dir matched by slug', () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-cc-wt-'));
    const fh = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-cc-home-'));
    const orig = process.env.HOME;
    process.env.HOME = fh;
    try {
        const dir = path.join(fh, '.claude', 'projects', claudeSlug(wt));
        mkp(dir);
        const uuid = 'aaaabbbb-1234-5678-9abc-def012345678';
        writeF(path.join(dir, `${uuid}.jsonl`), JSON.stringify({ type: 'permission-mode', sessionId: uuid }));
        const r = findNewAgentSession('cc', wt, now() - 2000);
        assert.ok(r, 'cc: should detect new JSONL');
        assert.strictEqual(r.sessionId, uuid);
        assert.ok(r.sessionPath.endsWith(`${uuid}.jsonl`));
    } finally {
        process.env.HOME = orig;
        fs.rmSync(wt, { recursive: true, force: true });
        fs.rmSync(fh, { recursive: true, force: true });
    }
});

test('gg: finds newest chat file keyed by .project_root content', () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-gg-wt-'));
    const fh = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-gg-home-'));
    const orig = process.env.HOME;
    process.env.HOME = fh;
    try {
        const ggDir = path.join(fh, '.gemini', 'tmp', path.basename(wt));
        const chatsDir = path.join(ggDir, 'chats');
        mkp(chatsDir);
        fs.writeFileSync(path.join(ggDir, '.project_root'), path.resolve(wt));
        const sessFile = path.join(chatsDir, '2026-04-25T12-00-00-000Z.json');
        writeF(sessFile, JSON.stringify({ sessionId: 'gemini-abc', messages: [] }));
        const r = findNewAgentSession('gg', wt, now() - 2000);
        assert.ok(r, 'gg: should detect new session JSON');
        assert.strictEqual(r.sessionId, 'gemini-abc');
    } finally {
        process.env.HOME = orig;
        fs.rmSync(wt, { recursive: true, force: true });
        fs.rmSync(fh, { recursive: true, force: true });
    }
});

test('cx: finds session by session_meta.cwd match', () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-cx-wt-'));
    const fh = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-cx-home-'));
    const orig = process.env.HOME;
    process.env.HOME = fh;
    try {
        const sessDir = path.join(fh, '.codex', 'sessions', '2026-04');
        mkp(sessDir);
        const sessFile = path.join(sessDir, 'cx-session-xyz987.jsonl');
        writeF(sessFile, JSON.stringify({ type: 'session_meta', timestamp: new Date().toISOString(), payload: { cwd: wt } }) + '\n');
        const r = findNewAgentSession('cx', wt, now() - 2000);
        assert.ok(r, 'cx: should detect session by cwd match');
        assert.strictEqual(r.sessionId, 'cx-session-xyz987');
    } finally {
        process.env.HOME = orig;
        fs.rmSync(wt, { recursive: true, force: true });
        fs.rmSync(fh, { recursive: true, force: true });
    }
});

test('returns null when file exists but is older than afterMs threshold', () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-old-wt-'));
    const fh = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-old-home-'));
    const orig = process.env.HOME;
    process.env.HOME = fh;
    try {
        const dir = path.join(fh, '.claude', 'projects', claudeSlug(wt));
        mkp(dir);
        writeF(path.join(dir, 'oldfile-uuid.jsonl'), '{}');
        const r = findNewAgentSession('cc', wt, now() + 600_000); // future threshold
        assert.strictEqual(r, null, 'should return null when no file is recent enough');
    } finally {
        process.env.HOME = orig;
        fs.rmSync(wt, { recursive: true, force: true });
        fs.rmSync(fh, { recursive: true, force: true });
    }
});

test('updateSessionSidecar: patches agentSessionId without clobbering other fields', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-patch-'));
    try {
        const sessDir = path.join(repo, '.aigon', 'sessions');
        mkp(sessDir);
        const name = 'aigon-f42-cc-feat';
        const original = { category: 'entity', sessionName: name, repoPath: repo, agent: 'cc', entityType: 'f', entityId: '42' };
        fs.writeFileSync(path.join(sessDir, `${name}.json`), JSON.stringify(original));
        const fakeId = 'ccccdddd-eeee-ffff-0000-111122223333';
        updateSessionSidecar(name, repo, { agentSessionId: fakeId, agentSessionPath: `/fake/${fakeId}.jsonl` });
        const patched = JSON.parse(fs.readFileSync(path.join(sessDir, `${name}.json`), 'utf8'));
        assert.strictEqual(patched.agentSessionId, fakeId);
        assert.strictEqual(patched.entityId, '42', 'original fields survive');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

report();
