#!/usr/bin/env node
'use strict';

/**
 * scripts/import-aigon-pro-specs.js — one-shot, idempotent spec-history import
 * for F693 (merge aigon-pro back into aigon OSS).
 *
 * Moves six things per renumbered entity, not one:
 *   1. the spec markdown under docs/specs/{features,research-topics}/<stage>/
 *   2. its `aigon_id:` frontmatter
 *   3. its implementation logs / findings logs
 *   4. its evaluation files
 *   5. its .aigon/workflows/{features,research}/<id>/ engine directory, plus the
 *      entityId/id fields inside snapshot.json and events.jsonl
 *   6. every feature-<old> / research-<old> cross-reference in imported bodies
 *
 * Everything is keyed off the MAPPING tables below, so re-running is a no-op.
 *
 * Usage:
 *   node scripts/import-aigon-pro-specs.js [--source <path>] [--dry-run]
 *
 * `--source` defaults to ~/src/aigon-pro. The target is always process.cwd().
 * The engine state under .aigon/workflows/ is gitignored, so this must be run
 * once more from the primary checkout after the F693 branch merges.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const srcIdx = args.indexOf('--source');
const SRC = path.resolve(srcIdx >= 0 && args[srcIdx + 1] ? args[srcIdx + 1] : path.join(os.homedir(), 'src', 'aigon-pro'));
const DST = process.cwd();

// ── Mapping ──────────────────────────────────────────────────────────────────
// Re-derived 2026-07-25 against the live allocator: OSS occupies feature IDs up
// to 701 and research IDs up to 64, so the renumbered block starts at 702 / 65.
// Colliders map in ascending original-ID order so relative chronology holds.

/** Features restored at their original (verified vacant) IDs. */
const RESTORE_FEATURES = [114, 115, 118, 122, 123, 152, 153, 159, 211, 219, 221, 222, 226];

/** Features whose IDs collide with OSS and are renumbered. */
const RENUMBER_FEATURES = new Map([
    [233, 702], [234, 703], [235, 704], [236, 705], [238, 706],
    [320, 707], [359, 708], [367, 709], [379, 710], [380, 711],
    [388, 712], [420, 713], [421, 714], [431, 715], [434, 716],
    [435, 717], [436, 718], [437, 719], [438, 720], [439, 721],
    [440, 722], [441, 723], [442, 724], [443, 725],
]);

/** Research restored at original IDs. */
const RESTORE_RESEARCH = [13];

/** Research renumbered. */
const RENUMBER_RESEARCH = new Map([[24, 65], [26, 66]]);

const NEXT_FEATURE_ID = 726;
const NEXT_RESEARCH_ID = 67;

/**
 * Numbered specs that are deliberately NOT imported.
 * 232 holds a counter floor that no longer means anything; 432 and 433 exist
 * only to hide and validate a private beta key that is being deleted.
 */
const SKIP_FEATURE_IDS = new Set([232, 432, 433]);

/**
 * Research left in the private archive.
 *   15 (aade-commercial-gate) and 23 (autonomous-mode-as-pro) are pricing and
 *   packaging analyses — price points, per-seat comparisons, checkout vendor
 *   evaluation. The spec permits importing them only if the body is rewritten
 *   to product conclusions; since nothing is gated any more those conclusions
 *   carry no remaining signal, so they stay archived.
 *   25 (marketing-aigon) is marketing strategy.
 */
const SKIP_RESEARCH_IDS = new Set([15, 23, 25]);

/**
 * Unnumbered inbox specs left in the private archive: billing, metering and
 * marketing operations. Everything else in the inbox is product work and comes
 * across as-is.
 */
const SKIP_INBOX_SPECS = new Set([
    'feature-pro-licensing-and-billing.md',
    'feature-pro-autonomy-metering.md',
    'feature-marketing-monitoring-and-metrics.md',
    'feature-content-publishing-pipeline.md',
    'feature-launch-campaign-prep.md',
    'feature-remotion-videos.md',
    // Stale duplicate of the shipped feature (old 420 → 713).
    'feature-settings-pro-perf-benchmark-dashboard.md',
    // Evaluates a monorepo layout for the OSS/Pro split this feature dissolves.
    'feature-evaluate-private-monorepo-for-oss-and-pro.md',
]);

/**
 * Stage overrides for specs that exist in two stage folders in the source repo.
 * 233 is in both 02-backlog and 06-paused; its snapshot says paused.
 */
const STAGE_OVERRIDE = new Map([[233, '06-paused']]);

/**
 * Historical banner prepended to imported specs that describe the tiered
 * architecture. They are engineering history, not commercial material.
 */
const HISTORICAL_BANNER =
    '> Historical: Aigon Pro was merged into OSS by F693. This spec describes the\n' +
    '> tiered architecture as it existed; Aigon has no paid tier.\n';

/**
 * Any imported spec that describes the tiered architecture gets the banner —
 * matched on content rather than a hand-kept ID list so nothing is missed.
 */
const TIER_FRAMING = /Pro tier|free tier|paid tier|Pro-gated|pro-gated|@aigon\/pro|aigon-pro|isProAvailable|Aigon Pro/;

function needsBanner(text) {
    return TIER_FRAMING.test(text);
}

const STAGES = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

// ── Helpers ──────────────────────────────────────────────────────────────────

const actions = [];

function record(kind, detail) {
    actions.push(`${kind}: ${detail}`);
}

function writeFile(dest, content) {
    record('write', path.relative(DST, dest));
    if (DRY) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
}

function readIfExists(p) {
    try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

/**
 * Sanitisation applied to every imported body: the private-beta contact address
 * from the GitHub-Packages distribution spec (old 431 → 715). The packaging
 * lessons stay; the address does not.
 */
function sanitize(text) {
    return text
        .replace(/Want access\? Contact john@aigon\.build/g, 'Access was request-only')
        .replace(/john@aigon\.build/g, 'the maintainer')
        // Pointers to billing/metering specs that stay in the private archive,
        // and the checkout-vendor names they carried.
        .replace(/- Real license validation, Keygen integration, Stripe — see `feature-pro-licensing-and-billing\.md`/g,
            '- Real license validation and payment integration — never built; Aigon has no paid tier')
        .replace(/\(see `feature-pro-licensing-and-billing\.md`, deferred\)/g, '(never built)')
        .replace(/ \(see `feature-pro-licensing-and-billing\.md`\)/g, '')
        .replace(/ → `feature-pro-licensing-and-billing\.md`/g, ' — never built')
        .replace(/ — see `feature-pro-autonomy-metering\.md`/g, ' — never built')
        .replace(/research-15-aade-commercial-gate, /g, '');
}

/** Rewrite every F<old>/feature-<old>/research-<old> reference to its new ID. */
function rewriteReferences(text) {
    let out = sanitize(text);
    for (const [oldId, newId] of RENUMBER_FEATURES) {
        out = out.replace(new RegExp(`\\bF${oldId}\\b`, 'g'), `F${newId}`);
        out = out.replace(new RegExp(`\\bfeature-${oldId}\\b`, 'g'), `feature-${newId}`);
        out = out.replace(new RegExp(`\\bfeature ${oldId}\\b`, 'g'), `feature ${newId}`);
    }
    for (const [oldId, newId] of RENUMBER_RESEARCH) {
        out = out.replace(new RegExp(`\\bresearch-${oldId}\\b`, 'g'), `research-${newId}`);
        out = out.replace(new RegExp(`\\bresearch ${oldId}\\b`, 'g'), `research ${newId}`);
    }
    return out;
}

/** Replace the `aigon_id:` frontmatter scalar. */
function setAigonId(text, prefix, newId) {
    if (!/^---\n/.test(text)) return text;
    const end = text.indexOf('\n---', 4);
    if (end < 0) return text;
    const head = text.slice(0, end);
    const tail = text.slice(end);
    if (/^aigon_id:/m.test(head)) {
        return head.replace(/^aigon_id:.*$/m, `aigon_id: ${prefix}${newId}`) + tail;
    }
    return `---\naigon_id: ${prefix}${newId}\n` + text.slice(4);
}

/** Insert the historical banner directly after the frontmatter block. */
function addBanner(text) {
    if (text.includes('> Historical: Aigon Pro was merged into OSS by F693')) return text;
    if (/^---\n/.test(text)) {
        const end = text.indexOf('\n---', 4);
        if (end >= 0) {
            const cut = end + 4;
            return text.slice(0, cut) + '\n\n' + HISTORICAL_BANNER + text.slice(cut);
        }
    }
    return HISTORICAL_BANNER + '\n' + text;
}

function transformSpec(text, prefix, newId, banner) {
    let out = rewriteReferences(text);
    out = setAigonId(out, prefix, newId);
    if (banner) out = addBanner(out);
    return out;
}

// ── Spec markdown ────────────────────────────────────────────────────────────

function importFeatureSpecs() {
    const srcRoot = path.join(SRC, 'docs', 'specs', 'features');
    const dstRoot = path.join(DST, 'docs', 'specs', 'features');

    for (const stage of STAGES) {
        const dir = path.join(srcRoot, stage);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir).sort()) {
            if (!name.endsWith('.md')) continue;
            const m = name.match(/^feature-(\d+)-(.+)\.md$/);

            if (!m) {
                // Unnumbered inbox spec — slug filename, no engine identity.
                if (SKIP_INBOX_SPECS.has(name)) { record('skip-spec', name); continue; }
                const text = rewriteReferences(readIfExists(path.join(dir, name)) || '');
                writeFile(path.join(dstRoot, stage, name), text);
                continue;
            }

            const oldId = Number(m[1]);
            if (SKIP_FEATURE_IDS.has(oldId)) { record('skip-spec', name); continue; }

            const override = STAGE_OVERRIDE.get(oldId);
            if (override && override !== stage) { record('skip-dup-stage', `${stage}/${name}`); continue; }

            const newId = RENUMBER_FEATURES.get(oldId) || oldId;
            if (!RENUMBER_FEATURES.has(oldId) && !RESTORE_FEATURES.includes(oldId)) {
                record('warn-unmapped', name);
                continue;
            }
            const raw = readIfExists(path.join(dir, name)) || '';
            const text = transformSpec(raw, 'F', newId, needsBanner(raw));
            writeFile(path.join(dstRoot, stage, `feature-${newId}-${m[2]}.md`), text);
        }
    }
}

function importResearchSpecs() {
    const srcRoot = path.join(SRC, 'docs', 'specs', 'research-topics');
    const dstRoot = path.join(DST, 'docs', 'specs', 'research-topics');

    for (const stage of STAGES) {
        const dir = path.join(srcRoot, stage);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir).sort()) {
            if (!name.endsWith('.md')) continue;
            const m = name.match(/^research-(\d+)-(.+)\.md$/);
            if (!m) {
                const text = rewriteReferences(readIfExists(path.join(dir, name)) || '');
                writeFile(path.join(dstRoot, stage, name), text);
                continue;
            }
            const oldId = Number(m[1]);
            if (SKIP_RESEARCH_IDS.has(oldId)) { record('skip-spec', name); continue; }
            const newId = RENUMBER_RESEARCH.get(oldId) || oldId;
            if (!RENUMBER_RESEARCH.has(oldId) && !RESTORE_RESEARCH.includes(oldId)) {
                record('warn-unmapped', name);
                continue;
            }
            const raw = readIfExists(path.join(dir, name)) || '';
            const text = transformSpec(raw, 'R', newId, needsBanner(raw));
            writeFile(path.join(dstRoot, stage, `research-${newId}-${m[2]}.md`), text);
        }
    }
}

// ── Logs and evaluations ─────────────────────────────────────────────────────

function importFeatureLogs() {
    const srcDir = path.join(SRC, 'docs', 'specs', 'features', 'logs');
    const dstDir = path.join(DST, 'docs', 'specs', 'features', 'logs');
    if (!fs.existsSync(srcDir)) return;
    for (const name of fs.readdirSync(srcDir).sort()) {
        if (!name.endsWith('.md')) continue;
        const m = name.match(/^feature-(\d+)-(.+)$/);
        if (!m) continue;
        const oldId = Number(m[1]);
        if (SKIP_FEATURE_IDS.has(oldId)) { record('skip-log', name); continue; }
        const newId = RENUMBER_FEATURES.get(oldId) || oldId;
        if (!RENUMBER_FEATURES.has(oldId) && !RESTORE_FEATURES.includes(oldId)) continue;
        const text = rewriteReferences(readIfExists(path.join(srcDir, name)) || '');
        writeFile(path.join(dstDir, `feature-${newId}-${m[2]}`), text);
    }
}

function importFeatureEvals() {
    const srcDir = path.join(SRC, 'docs', 'specs', 'features', 'evaluations');
    const dstDir = path.join(DST, 'docs', 'specs', 'features', 'evaluations');
    if (!fs.existsSync(srcDir)) return;
    for (const name of fs.readdirSync(srcDir).sort()) {
        const m = name.match(/^feature-(\d+)-(.+)$/);
        if (!m) continue;
        const oldId = Number(m[1]);
        if (SKIP_FEATURE_IDS.has(oldId)) { record('skip-eval', name); continue; }
        const newId = RENUMBER_FEATURES.get(oldId) || oldId;
        if (!RENUMBER_FEATURES.has(oldId) && !RESTORE_FEATURES.includes(oldId)) continue;
        const text = rewriteReferences(readIfExists(path.join(srcDir, name)) || '');
        writeFile(path.join(dstDir, `feature-${newId}-${m[2]}`), text);
    }
}

function importResearchLogs() {
    const srcDir = path.join(SRC, 'docs', 'specs', 'research-topics', 'logs');
    const dstDir = path.join(DST, 'docs', 'specs', 'research-topics', 'logs');
    if (!fs.existsSync(srcDir)) return;
    for (const name of fs.readdirSync(srcDir).sort()) {
        const m = name.match(/^research-(\d+)-(.+)$/);
        if (!m) continue;
        const oldId = Number(m[1]);
        if (SKIP_RESEARCH_IDS.has(oldId)) { record('skip-log', name); continue; }
        // The commercial-gate and autonomy-as-Pro findings logs ARE the pricing
        // analysis; only their rewritten topic specs come across.
        if (oldId === 15 || oldId === 23) { record('skip-log', name); continue; }
        const newId = RENUMBER_RESEARCH.get(oldId) || oldId;
        if (!RENUMBER_RESEARCH.has(oldId) && !RESTORE_RESEARCH.includes(oldId)) continue;
        const text = rewriteReferences(readIfExists(path.join(srcDir, name)) || '');
        writeFile(path.join(dstDir, `research-${newId}-${m[2]}`), text);
    }
}

// ── Engine state ─────────────────────────────────────────────────────────────

function rekeyEngineDir(srcDir, dstDir, oldId, newId) {
    if (!fs.existsSync(srcDir)) return;
    record('engine', `${path.basename(path.dirname(srcDir))}/${oldId} → ${newId}`);
    if (DRY) return;
    fs.mkdirSync(dstDir, { recursive: true });

    const snapPath = path.join(srcDir, 'snapshot.json');
    const snapRaw = readIfExists(snapPath);
    if (snapRaw) {
        let snap;
        try { snap = JSON.parse(snapRaw); } catch (_) { snap = null; }
        if (snap) {
            if (snap.entityId != null) snap.entityId = String(newId);
            if (snap.id != null) snap.id = String(newId);
            if (snap.featureId != null) snap.featureId = String(newId);
            fs.writeFileSync(path.join(dstDir, 'snapshot.json'), JSON.stringify(snap, null, 2) + '\n');
        } else {
            fs.writeFileSync(path.join(dstDir, 'snapshot.json'), snapRaw);
        }
    }

    const evPath = path.join(srcDir, 'events.jsonl');
    const evRaw = readIfExists(evPath);
    if (evRaw) {
        const lines = evRaw.split('\n').filter(Boolean).map((line) => {
            let ev;
            try { ev = JSON.parse(line); } catch (_) { return line; }
            if (ev.entityId != null) ev.entityId = String(newId);
            if (ev.id != null && String(ev.id) === String(oldId)) ev.id = String(newId);
            if (ev.featureId != null) ev.featureId = String(newId);
            return JSON.stringify(ev);
        });
        fs.writeFileSync(path.join(dstDir, 'events.jsonl'), lines.join('\n') + '\n');
    }
}

function importEngineState() {
    const featSrc = path.join(SRC, '.aigon', 'workflows', 'features');
    const featDst = path.join(DST, '.aigon', 'workflows', 'features');
    if (fs.existsSync(featSrc)) {
        for (const name of fs.readdirSync(featSrc)) {
            const oldId = Number(name);
            if (!Number.isInteger(oldId)) {
                // Slug-keyed pre-F667 inbox entry.
                if (SKIP_INBOX_SPECS.has(`feature-${name}.md`)) continue;
                rekeyEngineDir(path.join(featSrc, name), path.join(featDst, name), name, name);
                continue;
            }
            if (SKIP_FEATURE_IDS.has(oldId)) { record('skip-engine', `features/${oldId}`); continue; }
            if (!RENUMBER_FEATURES.has(oldId) && !RESTORE_FEATURES.includes(oldId)) continue;
            const newId = RENUMBER_FEATURES.get(oldId) || oldId;
            rekeyEngineDir(path.join(featSrc, name), path.join(featDst, String(newId)), oldId, newId);
        }
    }

    const resSrc = path.join(SRC, '.aigon', 'workflows', 'research');
    const resDst = path.join(DST, '.aigon', 'workflows', 'research');
    if (fs.existsSync(resSrc)) {
        for (const name of fs.readdirSync(resSrc)) {
            const oldId = Number(name);
            if (!Number.isInteger(oldId)) {
                rekeyEngineDir(path.join(resSrc, name), path.join(resDst, name), name, name);
                continue;
            }
            if (SKIP_RESEARCH_IDS.has(oldId)) { record('skip-engine', `research/${oldId}`); continue; }
            if (!RENUMBER_RESEARCH.has(oldId) && !RESTORE_RESEARCH.includes(oldId)) continue;
            const newId = RENUMBER_RESEARCH.get(oldId) || oldId;
            rekeyEngineDir(path.join(resSrc, name), path.join(resDst, String(newId)), oldId, newId);
        }
    }
}

function seedIdentitySequences() {
    const p = path.join(DST, '.aigon', 'state', 'identity-sequences.json');
    let seq = { schemaVersion: 1, feature: { next: 0, pending: {} }, research: { next: 0, pending: {} } };
    const raw = readIfExists(p);
    if (raw) {
        try { seq = JSON.parse(raw); } catch (_) { /* rewrite from scratch */ }
    }
    seq.feature = seq.feature || { pending: {} };
    seq.research = seq.research || { pending: {} };
    seq.feature.next = Math.max(Number(seq.feature.next) || 0, NEXT_FEATURE_ID);
    seq.research.next = Math.max(Number(seq.research.next) || 0, NEXT_RESEARCH_ID);
    record('sequences', `feature.next=${seq.feature.next} research.next=${seq.research.next}`);
    if (DRY) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(seq, null, 2) + '\n');
}

// ── Recurring templates ──────────────────────────────────────────────────────

function importRecurringTemplates() {
    const srcDir = path.join(SRC, 'docs', 'specs', 'recurring');
    const dstDir = path.join(DST, 'docs', 'specs', 'recurring');
    if (!fs.existsSync(srcDir)) return;
    // competitive-refresh is a private/marketing task; the rest are product
    // maintenance and belong in OSS. Same-named files already in OSS win —
    // they are the maintained copies.
    const skip = new Set(['competitive-refresh.md']);
    for (const name of fs.readdirSync(srcDir).sort()) {
        if (!name.endsWith('.md') || skip.has(name)) { record('skip-recurring', name); continue; }
        if (fs.existsSync(path.join(dstDir, name))) { record('keep-oss-recurring', name); continue; }
        writeFile(path.join(dstDir, name), rewriteReferences(readIfExists(path.join(srcDir, name)) || ''));
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
    if (!fs.existsSync(SRC)) {
        console.error(`Source repo not found: ${SRC}`);
        process.exit(1);
    }
    importFeatureSpecs();
    importResearchSpecs();
    importFeatureLogs();
    importFeatureEvals();
    importResearchLogs();
    importRecurringTemplates();
    importEngineState();
    seedIdentitySequences();

    const counts = actions.reduce((acc, line) => {
        const kind = line.split(':')[0];
        acc[kind] = (acc[kind] || 0) + 1;
        return acc;
    }, {});
    console.log(`${DRY ? '[dry-run] ' : ''}import-aigon-pro-specs: ${SRC} → ${DST}`);
    for (const [kind, n] of Object.entries(counts).sort()) console.log(`  ${kind}: ${n}`);
    const warnings = actions.filter(l => l.startsWith('warn-'));
    if (warnings.length > 0) {
        console.log('\nUnmapped (not imported):');
        warnings.forEach(w => console.log(`  ${w}`));
    }
}

main();
