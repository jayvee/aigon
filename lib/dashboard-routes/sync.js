'use strict';

/**
 * lib/dashboard-routes/sync.js — Profile Sync (F705), Aigon Sync (F702) and
 * Vault/Backup (F706) status endpoints.
 *
 * Merged into the OSS route table by F693 (previously registered through
 * `aigon-pro/index.js` register()).
 */

const fs = require('fs');
const path = require('path');
const backup = require('../backup');
const profileState = require('../profile-state');

module.exports = [
    {
        method: 'GET',
        path: '/api/profile/status',
        handler(req, res, ctx) {
            try { ctx.sendJson(200, profileState.statusLocal()); }
            catch (e) { ctx.sendJson(500, { error: e.message }); }
        },
    },
    {
        method: 'GET',
        path: '/api/settings-sync/status',
        handler(req, res, ctx) {
            try { ctx.sendJson(200, backup.status()); }
            catch (e) { ctx.sendJson(500, { error: e.message }); }
        },
    },
    {
        method: 'GET',
        path: '/api/backup/status',
        handler(req, res, ctx) {
            try { ctx.sendJson(200, backup.status()); }
            catch (e) { ctx.sendJson(500, { error: e.message }); }
        },
    },
    {
        method: 'POST',
        path: '/api/backup/schedule',
        handler(req, res, ctx) {
            return ctx.readJsonBody()
                .then(payload => {
                    const cadence = String((payload && payload.cadence) || '').toLowerCase();
                    try {
                        const c = backup.setSchedule(cadence);
                        ctx.sendJson(200, { ok: true, schedule: c });
                    } catch (e) {
                        ctx.sendJson(400, { error: e.message });
                    }
                })
                .catch(e => ctx.sendJson(400, { error: e.message }));
        },
    },
    {
        method: 'GET',
        path: '/api/sync/status',
        handler(req, res, ctx) {
            try {
                const url = new URL(req.url || '/api/sync/status', 'http://localhost');
                const repoPath = String(url.searchParams.get('repoPath') || process.cwd());
                const cfgPath = path.join(repoPath, '.aigon', 'config.json');
                const metaPath = path.join(repoPath, '.aigon', '.sync', 'sync-meta.json');
                let cfg = {};
                try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { /* unconfigured repo */ }
                let meta = {};
                try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { /* never synced */ }
                const remote = (cfg.sync && cfg.sync.remote) ? String(cfg.sync.remote).trim() : null;
                ctx.sendJson(200, {
                    configured: !!remote,
                    remote: remote || null,
                    lastPushAt: meta.lastPushAt || null,
                    lastPullAt: meta.lastPullAt || null,
                });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        },
    },
];
