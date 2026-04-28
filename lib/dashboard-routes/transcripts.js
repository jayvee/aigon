'use strict';

const { collectTranscriptRecords } = require('../transcript-read');

module.exports = [
    {
        method: 'GET',
        path: /^\/api\/(features|research)\/([^/]+)\/transcripts$/,
        handler(req, res, ctx, match) {
            const entityType = match[1] === 'research' ? 'research' : 'feature';
            let entityId = '';
            try {
                entityId = decodeURIComponent(match[2] || '').trim();
            } catch (_) {
                ctx.sendJson(400, { error: 'Invalid entity id in path' });
                return;
            }
            const url = new URL(req.url, `http://${req.headers.host}`);
            const agentId = String(url.searchParams.get('agent') || '').trim() || null;
            const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, String(url.searchParams.get('repoPath') || '').trim());
            if (!repoPath) return;
            if (!entityId) {
                ctx.sendJson(400, { error: 'entityId is required' });
                return;
            }

            try {
                const records = collectTranscriptRecords(repoPath, entityType, entityId, agentId);
                ctx.sendJson(200, {
                    captured: records.length > 0,
                    reason: records.length === 0 ? `No transcript sessions found for ${entityType} ${entityId}.` : null,
                    records,
                });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        }
    },
];
