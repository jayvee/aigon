#!/usr/bin/env node
// One-off proxy report for reviewer effectiveness.
// Reads .aigon/workflows/features/*/events.jsonl and aggregates per-reviewer
// signals. Intentionally not wired as a public command — see chat 2026-05-10.

const fs = require('fs');
const path = require('path');

const FEATURES_DIR = path.join(__dirname, '..', '.aigon', 'workflows', 'features');
const LIMIT = parseInt(process.argv[2] || '100', 10);

function readEvents(featureId) {
  const file = path.join(FEATURES_DIR, featureId, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function isClosed(events) {
  return events.some(e => e.type === 'feature.closed');
}

function closedAt(events) {
  const e = events.find(e => e.type === 'feature.closed');
  return e ? new Date(e.at).getTime() : 0;
}

const allFeatureIds = fs.readdirSync(FEATURES_DIR)
  .filter(d => /^\d+$/.test(d));

const closedFeatures = allFeatureIds
  .map(id => ({ id, events: readEvents(id) }))
  .filter(f => isClosed(f.events))
  .sort((a, b) => closedAt(b.events) - closedAt(a.events))
  .slice(0, LIMIT);

console.log(`Scanning ${closedFeatures.length} most-recently-closed features (limit=${LIMIT}).\n`);

// Per-reviewer aggregation
const stats = new Map();
function bucket(reviewerId) {
  if (!stats.has(reviewerId)) {
    stats.set(reviewerId, {
      reviews: 0,
      requestedRevision: 0,
      revisionFollowedThrough: 0,
      requestedAnotherCycle: 0,
      noChangesNeeded: 0,
      featureClosedAfter: 0,
      revisionDurationsMs: [],
    });
  }
  return stats.get(reviewerId);
}

for (const { id, events } of closedFeatures) {
  // Walk events in order, pairing each review.completed with the next
  // revision.completed before another review.completed (same feature).
  let pendingReview = null;
  for (const e of events) {
    if (e.type === 'feature.code_review.completed') {
      if (pendingReview) {
        // Previous review never got a paired revision — count it as orphan
        const s = bucket(pendingReview.reviewerId || 'unknown');
        s.reviews += 1;
        if (pendingReview.requestRevision) s.requestedRevision += 1;
        else s.noChangesNeeded += 1;
        if (closedAt(events)) s.featureClosedAfter += 1;
      }
      pendingReview = e;
    } else if (e.type === 'feature.code_revision.completed' && pendingReview) {
      const s = bucket(pendingReview.reviewerId || 'unknown');
      s.reviews += 1;
      if (pendingReview.requestRevision) s.requestedRevision += 1;
      else s.noChangesNeeded += 1;
      s.revisionFollowedThrough += 1;
      if (e.requestAnotherCycle) s.requestedAnotherCycle += 1;
      const dur = new Date(e.at).getTime() - new Date(pendingReview.at).getTime();
      if (dur > 0) s.revisionDurationsMs.push(dur);
      if (closedAt(events)) s.featureClosedAfter += 1;
      pendingReview = null;
    }
  }
  if (pendingReview) {
    const s = bucket(pendingReview.reviewerId || 'unknown');
    s.reviews += 1;
    if (pendingReview.requestRevision) s.requestedRevision += 1;
    else s.noChangesNeeded += 1;
    if (closedAt(events)) s.featureClosedAfter += 1;
  }
}

function median(xs) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const rows = [...stats.entries()]
  .map(([reviewer, s]) => ({
    reviewer,
    reviews: s.reviews,
    revRate: s.reviews ? (s.requestedRevision / s.reviews) : 0,
    followThruRate: s.reviews ? (s.revisionFollowedThrough / s.reviews) : 0,
    medianRevSec: Math.round(median(s.revisionDurationsMs) / 1000),
    noChanges: s.noChangesNeeded,
    anotherCycle: s.requestedAnotherCycle,
  }))
  .sort((a, b) => b.reviews - a.reviews);

const fmt = (n, w) => String(n).padStart(w);
const pct = (x) => (x * 100).toFixed(0) + '%';
const dur = (sec) => sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : `${(sec/3600).toFixed(1)}h`;

console.log('reviewer | reviews | requestedRevision | revisionFollowedThrough | medianRevisionTime | noChangesNeeded | requestedAnotherCycle');
console.log('---------+---------+-------------------+-------------------------+--------------------+-----------------+----------------------');
for (const r of rows) {
  console.log(
    `${r.reviewer.padEnd(8)} | ${fmt(r.reviews, 7)} | ${fmt(pct(r.revRate), 17)} | ${fmt(pct(r.followThruRate), 23)} | ${fmt(dur(r.medianRevSec), 18)} | ${fmt(r.noChanges, 15)} | ${fmt(r.anotherCycle, 21)}`
  );
}

console.log('\nNotes:');
console.log('- requestedRevision is essentially rubber-stamped true across the corpus, so it is a sanity column, not a discriminator.');
console.log('- revisionFollowedThrough = % of this reviewer\'s reviews that produced a paired feature.code_revision.completed event.');
console.log('- medianRevisionTime = median seconds between the reviewer\'s review-completed and the implementer\'s revision-completed.');
console.log('  Higher is a weak proxy for "the reviewer\'s feedback caused real work" — but also conflates with reviser thoroughness and idle wait.');
console.log('- noChangesNeeded counts requestRevision=false (across the corpus this is ~0).');
console.log('- requestedAnotherCycle counts revisions that asked for a second review pass (across the corpus this is 0).');
