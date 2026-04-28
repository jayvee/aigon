'use strict';

const fs = require('fs');
const { collectTranscriptRecords, resolveTranscriptDownload } = require('../transcript-read');

module.exports = [
    {
        method: 'GET',
        path: /^\/api\/(features|research)\/([^/]+)\/transcripts\/download$/,
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
            const repoPath = ctx.helpers.resolveRequestedRepoPathOrRespond(res, String(url.searchParams.get('repoPath') || '').trim());
            if (!repoPath) return;
            if (!entityId) {
                ctx.sendJson(400, { error: 'entityId is required' });
                return;
            }
            const agent = String(url.searchParams.get('agent') || '').trim();
            const sessionId = String(url.searchParams.get('sessionId') || '').trim() || null;
            const sessionName = String(url.searchParams.get('sessionName') || '').trim() || null;

            const resolved = resolveTranscriptDownload(repoPath, entityType, entityId, {
                agent,
                sessionId,
                sessionName,
            });
            if (!resolved.ok) {
                ctx.sendJson(resolved.status, { error: resolved.error });
                return;
            }

            const safeName = String(resolved.downloadBaseName || 'transcript').replace(/[^\w.\-]+/g, '_');
            res.writeHead(200, {
                'content-type': 'application/octet-stream; charset=utf-8',
                'cache-control': 'no-store',
                'content-disposition': `attachment; filename="${safeName}"`,
            });
            const stream = fs.createReadStream(resolved.absPath);
            stream.on('error', () => {
                if (!res.headersSent) {
                    ctx.sendJson(500, { error: 'Transcript read failed' });
                    return;
                }
                try { res.destroy(); } catch (_) { /* ignore */ }
            });
            stream.pipe(res);
        }
    },
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
