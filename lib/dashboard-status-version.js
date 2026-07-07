'use strict';

// F620: server-side structural fingerprint + monotonic statusVersion for
// /api/status conditional GET (ETag / If-None-Match → 304).

function computeStatusFingerprint(data) {
    if (!data) return '';
    const parts = [];
    const summary = data.summary || {};
    parts.push((summary.waiting || 0) + ',' + (summary.inProgress || 0) + ',' + (summary.inEval || 0));
    const uc = data.updateCheck;
    parts.push('updateCheck:' + (uc ? String(uc.state || '') : ''));
    (data.repos || []).forEach(repo => {
        const features = repo.features || [];
        const research = repo.research || [];
        const feedback = repo.feedback || [];
        parts.push(repo.path + ':' + features.length + '/' + research.length + '/' + feedback.length);
        features.forEach(f => {
            const agents = (f.agents || []).map(a => {
                const ladder = (a.idleLadder && a.idleLadder.state) || '';
                return a.id + ':' + a.status + ':' + ladder;
            }).join('|');
            const closeFail = f.lastCloseFailure ? '!' : '';
            parts.push('F' + f.id + ':' + (f.stage || '') + ':' + (f.currentSpecState || '') + ':' + (f.startupPhase || '') + ':' + agents + closeFail);
        });
        research.forEach(r => {
            const agents = (r.agents || []).map(a => {
                const ladder = (a.idleLadder && a.idleLadder.state) || '';
                return a.id + ':' + a.status + ':' + ladder;
            }).join('|');
            parts.push('R' + r.id + ':' + (r.stage || '') + ':' + (r.startupPhase || '') + ':' + agents);
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
    createStatusSnapshotStore,
    ifNoneMatchSatisfied,
    parseIfNoneMatch,
    normalizeEtagValue,
};
