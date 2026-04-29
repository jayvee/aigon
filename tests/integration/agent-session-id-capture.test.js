#!/usr/bin/env node
// FEATURE 357: post-launch capture binds agent session file to sidecar via cwd matching.
// Covers: cc (Claude project-dir slug), gg (Gemini .project_root marker), cx (Codex session_meta.cwd),
//         old-file guard (returns null when no file is new enough), sidecar patch atomicity.
// F453: gg case rewritten — Gemini does not hash dir names with SHA256;
//       resolver scans for .project_root contents instead.
'use strict';
const a = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { findNewAgentSession, updateSessionSidecar } = require('../../lib/session-sidecar');
const claudeSlug = p => p.replace(/[/.]/g, '-');
const tmp = (pf) => fs.mkdtempSync(path.join(os.tmpdir(), pf));
const mkp = p => fs.mkdirSync(p, { recursive: true });
const writeF = (p, c = '{}') => { mkp(path.dirname(p)); fs.writeFileSync(p, c); };
const now = () => Date.now();

{ // cc: newest JSONL in project dir matched by slug
    const wt = tmp('aigon-cc-wt-'), fh = tmp('aigon-cc-home-'), orig = process.env.HOME;
    process.env.HOME = fh;
    const dir = path.join(fh, '.claude', 'projects', claudeSlug(wt)); mkp(dir);
    const uuid = 'aaaabbbb-1234-5678-9abc-def012345678';
    writeF(path.join(dir, `${uuid}.jsonl`), JSON.stringify({ type: 'permission-mode', sessionId: uuid }));
    const r = findNewAgentSession('cc', wt, now() - 2000);
    a.ok(r, 'cc: should detect new JSONL'); a.strictEqual(r.sessionId, uuid); a.ok(r.sessionPath.endsWith(`${uuid}.jsonl`));
    process.env.HOME = orig;
    fs.rmSync(wt, { recursive: true, force: true }); fs.rmSync(fh, { recursive: true, force: true });
}

{ // gg: newest chats/*.json in gemini dir keyed by .project_root content
    const wt = tmp('aigon-gg-wt-'), fh = tmp('aigon-gg-home-'), orig = process.env.HOME;
    process.env.HOME = fh;
    const ggDir = path.join(fh, '.gemini', 'tmp', path.basename(wt));
    const chatsDir = path.join(ggDir, 'chats'); mkp(chatsDir);
    fs.writeFileSync(path.join(ggDir, '.project_root'), path.resolve(wt));
    const sessFile = path.join(chatsDir, '2026-04-25T12-00-00-000Z.json');
    writeF(sessFile, JSON.stringify({ sessionId: 'gemini-abc', messages: [] }));
    const r = findNewAgentSession('gg', wt, now() - 2000);
    a.ok(r, 'gg: should detect new session JSON'); a.strictEqual(r.sessionId, 'gemini-abc');
    process.env.HOME = orig;
    fs.rmSync(wt, { recursive: true, force: true }); fs.rmSync(fh, { recursive: true, force: true });
}

{ // cx: session_meta.cwd must match worktree path
    const wt = tmp('aigon-cx-wt-'), fh = tmp('aigon-cx-home-'), orig = process.env.HOME;
    process.env.HOME = fh;
    const sessDir = path.join(fh, '.codex', 'sessions', '2026-04'); mkp(sessDir);
    const sessFile = path.join(sessDir, 'cx-session-xyz987.jsonl');
    writeF(sessFile, JSON.stringify({ type: 'session_meta', timestamp: new Date().toISOString(), payload: { cwd: wt } }) + '\n');
    const r = findNewAgentSession('cx', wt, now() - 2000);
    a.ok(r, 'cx: should detect session by cwd match'); a.strictEqual(r.sessionId, 'cx-session-xyz987');
    process.env.HOME = orig;
    fs.rmSync(wt, { recursive: true, force: true }); fs.rmSync(fh, { recursive: true, force: true });
}

{ // null guard: file exists but is older than afterMs
    const wt = tmp('aigon-old-wt-'), fh = tmp('aigon-old-home-'), orig = process.env.HOME;
    process.env.HOME = fh;
    const dir = path.join(fh, '.claude', 'projects', claudeSlug(wt)); mkp(dir);
    writeF(path.join(dir, 'oldfile-uuid.jsonl'), '{}');
    const r = findNewAgentSession('cc', wt, now() + 600_000); // future threshold
    a.strictEqual(r, null, 'should return null when no file is recent enough');
    process.env.HOME = orig;
    fs.rmSync(wt, { recursive: true, force: true }); fs.rmSync(fh, { recursive: true, force: true });
}

{ // updateSessionSidecar: patches agentSessionId without clobbering other fields
    const repo = tmp('aigon-patch-'), sessDir = path.join(repo, '.aigon', 'sessions'); mkp(sessDir);
    const name = 'aigon-f42-cc-feat', original = { category: 'entity', sessionName: name, repoPath: repo, agent: 'cc', entityType: 'f', entityId: '42' };
    fs.writeFileSync(path.join(sessDir, `${name}.json`), JSON.stringify(original));
    const fakeId = 'ccccdddd-eeee-ffff-0000-111122223333';
    updateSessionSidecar(name, repo, { agentSessionId: fakeId, agentSessionPath: `/fake/${fakeId}.jsonl` });
    const patched = JSON.parse(fs.readFileSync(path.join(sessDir, `${name}.json`), 'utf8'));
    a.strictEqual(patched.agentSessionId, fakeId); a.strictEqual(patched.entityId, '42', 'original fields survive');
    fs.rmSync(repo, { recursive: true, force: true });
}

console.log('  ✓ feature 357 agent-session-id-capture tests passed');
