'use strict';

const { featureUiContractFingerprint } = require('./feature-ui-contract');
const { researchUiContractFingerprint } = require('./research-ui-contract');
const { featureSetUiContractFingerprint } = require('./feature-set-ui-contract');
const { monitorOperationalFingerprint } = require('./monitor-operational-projection');

// F620: server-side structural fingerprint + monotonic statusVersion for
// /api/status conditional GET (ETag / If-None-Match → 304).

/** REGRESSION F671: spec review/revision session rows must bump the fingerprint. */
function specReviewCycleFingerprint(feature) {
    if (!feature) return '';
    const review = (feature.specReviewSessions || [])
        .map((session) => `${session.agent || ''}:${session.status || ''}:${session.running ? 1 : 0}`)
        .join('|');
    const revision = (feature.specRevisionSessions || feature.specCheckSessions || [])
        .map((session) => `${session.agent || ''}:${session.running ? 1 : 0}`)
        .join('|');
    return `${review};${revision}`;
}

function computeStatusFingerprint(data) {
    if (!data) return '';
    const parts = [];
    const summary = data.summary || {};
    parts.push((summary.waiting || 0) + ',' + (summary.inProgress || 0) + ',' + (summary.inEval || 0));
    parts.push('monitor:' + monitorOperationalFingerprint(data.monitorOperational));
    const uc = data.updateCheck;
    parts.push('updateCheck:' + (uc ? [
        String(uc.state || ''),
        String(uc.latestStable || ''),
        String(uc.latestNext || ''),
        String(uc.upgradeCommand || ''),
    ].join(':') : ''));
    (data.repos || []).forEach(repo => {
        const features = repo.features || [];
        const research = repo.research || [];
        const feedback = repo.feedback || [];
        parts.push(repo.path + ':' + features.length + '/' + research.length + '/' + feedback.length);
        const redMain = repo.redMainCondition;
        parts.push('redMain:' + (redMain ? [
            String(redMain.gateCommand || ''),
            String(redMain.mergedCommitSha || ''),
            String(redMain.gateLogPath || ''),
            String(redMain.latestSeenAt || ''),
        ].join(':') : ''));
        features.forEach(f => {
            const agents = (f.agents || []).map(a => {
                const ladder = (a.idleLadder && a.idleLadder.state) || '';
                return a.id + ':' + a.status + ':' + ladder;
            }).join('|');
            const closeFail = f.lastCloseFailure ? '!' : '';
            const cr = f.closeReadiness;
            const crKey = cr && cr.applicable
                ? (cr.ready ? 'R' : (cr.primaryBlocker ? cr.primaryBlocker.kind : 'B'))
                : '';
            parts.push('F' + f.id + ':' + (f.stage || '') + ':' + (f.currentSpecState || '') + ':' + (f.startupPhase || '') + ':' + agents + closeFail + ':' + crKey + ':' + specReviewCycleFingerprint(f) + ':' + featureUiContractFingerprint(f.uiContract));
        });
        research.forEach(r => {
            const agents = (r.agents || []).map(a => {
                const ladder = (a.idleLadder && a.idleLadder.state) || '';
                return a.id + ':' + a.status + ':' + ladder;
            }).join('|');
            parts.push('R' + r.id + ':' + (r.stage || '') + ':' + (r.currentSpecState || '') + ':' + (r.startupPhase || '') + ':' + agents + ':' + specReviewCycleFingerprint(r) + ':' + researchUiContractFingerprint(r.uiContract));
        });
        (repo.sets || []).forEach(set => {
            const sr = set.specReview;
            const sv = set.specRevision;
            if (sr) {
                parts.push('S:' + set.slug + ':review:' + (sr.running ? '1' : '0') + ':' + (sr.agent || '') + ':' + (sr.sessionName || ''));
            }
            if (sv) {
                parts.push('S:' + set.slug + ':revision:' + (sv.running ? '1' : '0') + ':' + (sv.agent || '') + ':' + (sv.sessionName || ''));
            }
            const sc = set.specCycle;
            if (sc) {
                parts.push('S:' + set.slug + ':cycle:' + [
                    sc.review && sc.review.status || '',
                    sc.review && sc.review.pendingCount || 0,
                    sc.review && sc.review.memberCount || 0,
                    sc.review && sc.review.commitSha || '',
                    sc.revision && sc.revision.status || '',
                    sc.revision && sc.revision.pendingCount || 0,
                    sc.revision && sc.revision.memberCount || 0,
                    sc.revision && sc.revision.commitSha || '',
                ].join(':'));
            }
            // F678: covers set actions, conductor plan, member progress, session
            // inspectability, and the nested current-member contract.
            parts.push('S:' + set.slug + ':contract:' + featureSetUiContractFingerprint(set.uiContract));
        });
    });
    return parts.join('\n');
}

function normalizeEtagValue(value) {
    return String(value || '').trim().replace(/^W\//i, '').replace(/^"(.*)"$/, '$1');
}

function parseIfNoneMatch(header) {
    if (!header) return [];
    return String(header).split(',').map(normalizeEtagValue).filter(Boolean);
}

function ifNoneMatchSatisfied(header, etag) {
    const validators = parseIfNoneMatch(header);
    if (!validators.length) return false;
    const tag = String(etag);
    return validators.some(v => v === '*' || v === tag);
}

function createStatusSnapshotStore() {
    let latestStatus = null;
    let statusVersion = 0;
    let fingerprint = '';
    let serializeCache = { generatedAt: null, body: null };

    function replaceLatestStatus(nextStatus, _source) {
        if (!nextStatus) return latestStatus;
        const nextFp = computeStatusFingerprint(nextStatus);
        const bumped = nextFp !== fingerprint;
        if (bumped) {
            statusVersion += 1;
            fingerprint = nextFp;
        }
        nextStatus.statusVersion = statusVersion;
        latestStatus = nextStatus;
        if (bumped || serializeCache.generatedAt !== nextStatus.generatedAt) {
            serializeCache = {
                generatedAt: nextStatus.generatedAt,
                body: JSON.stringify(nextStatus),
            };
        }
        return latestStatus;
    }

    function getLatestStatus() {
        return latestStatus;
    }

    function getStatusVersion() {
        return statusVersion;
    }

    function getSerializedBody() {
        if (!latestStatus) return JSON.stringify(null);
        if (serializeCache.body && serializeCache.generatedAt === latestStatus.generatedAt) {
            return serializeCache.body;
        }
        serializeCache = {
            generatedAt: latestStatus.generatedAt,
            body: JSON.stringify(latestStatus),
        };
        return serializeCache.body;
    }

    return {
        replaceLatestStatus,
        getLatestStatus,
        getStatusVersion,
        getSerializedBody,
        computeStatusFingerprint,
    };
}

module.exports = {
    computeStatusFingerprint,
    specReviewCycleFingerprint,
    createStatusSnapshotStore,
    ifNoneMatchSatisfied,
    parseIfNoneMatch,
    normalizeEtagValue,
};
