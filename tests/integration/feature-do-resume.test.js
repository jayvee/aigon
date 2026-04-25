#!/usr/bin/env node
// FEATURE 357: resume code path reads agentSessionId from sidecar and builds per-agent resume args.
// Covers: readLatestSidecarWithSession (found/not-found/most-recent/agent-filter),
//         resolveResumeArgs (cc/cx/gg flags, unsupported agents return null).
'use strict';
const a = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { readLatestSidecarWithSession, resolveResumeArgs } = require('../../lib/session-sidecar');
const tmp = (pf) => fs.mkdtempSync(path.join(os.tmpdir(), pf));
const mkp = p => fs.mkdirSync(p, { recursive: true });
const ws = (repo, name, rec) => { const d = path.join(repo, '.aigon', 'sessions'); mkp(d); fs.writeFileSync(path.join(d, `${name}.json`), JSON.stringify(rec)); };
const base = (repo, name, eid, ag, extras = {}) => ws(repo, name, Object.assign({ category: 'entity', sessionName: name, repoPath: repo, worktreePath: repo, createdAt: '2026-04-25T10:00:00.000Z', agent: ag, entityType: 'f', entityId: eid, role: 'do' }, extras));

{ // found: returns sidecar with agentSessionId
    const r = tmp('aigon-res-'), uuid = 'resume-uuid-1111-2222-3333-444455556666';
    base(r, 'aigon-f07-cc-impl', '7', 'cc', { agentSessionId: uuid, agentSessionPath: `/fake/${uuid}.jsonl` });
    const s = readLatestSidecarWithSession(r, 'f', '7', 'cc');
    a.ok(s, 'should find sidecar'); a.strictEqual(s.agentSessionId, uuid);
    fs.rmSync(r, { recursive: true, force: true });
}

{ // not-found: sidecar without agentSessionId → null
    const r = tmp('aigon-res-noid-');
    base(r, 'aigon-f08-cc-old', '8', 'cc');
    a.strictEqual(readLatestSidecarWithSession(r, 'f', '8', 'cc'), null, 'missing agentSessionId → null');
    fs.rmSync(r, { recursive: true, force: true });
}

{ // most-recent wins when multiple sidecars exist
    const r = tmp('aigon-res-multi-');
    base(r, 'aigon-f09-cc-old', '9', 'cc', { createdAt: '2026-04-24T08:00:00.000Z', agentSessionId: 'old-uuid' });
    base(r, 'aigon-f09-cc-new', '9', 'cc', { createdAt: '2026-04-25T10:00:00.000Z', agentSessionId: 'new-uuid' });
    const s = readLatestSidecarWithSession(r, 'f', '9', 'cc');
    a.strictEqual(s.agentSessionId, 'new-uuid', 'should pick most recent');
    fs.rmSync(r, { recursive: true, force: true });
}

{ // agent filter: gg sidecar not returned for cc query
    const r = tmp('aigon-res-agent-');
    base(r, 'aigon-f10-gg-impl', '10', 'gg', { agentSessionId: 'gemini-id' });
    a.strictEqual(readLatestSidecarWithSession(r, 'f', '10', 'cc'), null, 'cc query must not return gg sidecar');
    a.ok(readLatestSidecarWithSession(r, 'f', '10', 'gg'), 'gg query should find the sidecar');
    fs.rmSync(r, { recursive: true, force: true });
}

// resolveResumeArgs per agent
{ const r = resolveResumeArgs('cc', 'test-uuid'); a.deepStrictEqual(r.appendArgs, ['--resume', 'test-uuid']); a.strictEqual(r.isSubcommand, false); }
{ const r = resolveResumeArgs('cx', 'cx-id'); a.deepStrictEqual(r.prependArgs, ['resume', 'cx-id']); a.strictEqual(r.isSubcommand, true); }
{ const r = resolveResumeArgs('gg', 'gg-id'); a.deepStrictEqual(r.appendArgs, ['--resume', 'gg-id']); a.strictEqual(r.isSubcommand, false); }
a.strictEqual(resolveResumeArgs('cu', 'x'), null, 'cu: unsupported → null');
a.strictEqual(resolveResumeArgs(null, 'x'), null, 'null agent → null');
a.strictEqual(resolveResumeArgs('cc', null), null, 'null sessionId → null');

console.log('  ✓ feature 357 feature-do-resume tests passed');
