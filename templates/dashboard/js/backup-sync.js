/* dashboard-esm-processed */
/* global fetch, Alpine */
/**
 * Settings → Aigon Sync — vault status + schedule (F706).
 * Targets #backup-sync-view (moved into Settings by js/settings.js).
 * Merged from aigon-pro by F693.
 */

import { INITIAL_DATA } from './injected.js';
import { showToast } from './utils.js';

function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? escHtml(iso) : escHtml(d.toLocaleString());
}

function pickCwd() {
    try {
        if (INITIAL_DATA && INITIAL_DATA.repos && INITIAL_DATA.repos[0]) {
            return String(INITIAL_DATA.repos[0].path || '').trim();
        }
    } catch (_) { /* ignore */ }
    try {
        if (typeof Alpine !== 'undefined' && Alpine.store) {
            const st = Alpine.store('dashboard');
            const r = st && st.data && st.data.repos && st.data.repos[0];
            if (r && r.path) return String(r.path).trim();
        }
    } catch (_) { /* ignore */ }
    return '';
}

function openTerm(command) {
    const cwd = pickCwd();
    return fetch('/api/open-terminal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, cwd }),
    }).then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || r.statusText);
    }));
}

function renderStatus(host, s) {
    const remote = s.remote ? escHtml(s.remote) : '<span style="opacity:0.75">(not configured)</span>';
    const rawSched = String(s.schedule || 'daily').toLowerCase();
    const opts = ['daily', 'hourly', 'weekly', 'off']
        .map((v) => '<option value="' + v + '"' + (rawSched === v ? ' selected' : '') + '>' + v + '</option>')
        .join('');
    host.innerHTML =
        '<div class="sync-panel-meta">' +
        '<div class="sync-panel-row"><span class="sync-panel-label">Vault remote</span>' +
        '<span class="sync-panel-value sync-panel-remote-val">' + remote + '</span></div>' +
        '<div class="sync-panel-row"><span class="sync-panel-label">Last push</span>' +
        '<span class="sync-panel-value">' + fmtWhen(s.lastPushAt) + '</span></div>' +
        '<div class="sync-panel-row"><span class="sync-panel-label">Last pull</span>' +
        '<span class="sync-panel-value">' + fmtWhen(s.lastPullAt) + '</span></div>' +
        '<div class="sync-panel-row"><span class="sync-panel-label">Projects in vault</span>' +
        '<span class="sync-panel-value">' + escHtml(String(s.projectCount != null ? s.projectCount : '—')) + '</span></div>' +
        '<div class="sync-panel-row"><span class="sync-panel-label">Registered repos</span>' +
        '<span class="sync-panel-value">' + escHtml(String(s.registeredRepos != null ? s.registeredRepos : '—')) + '</span></div>' +
        '<div class="sync-panel-row"><span class="sync-panel-label">Schedule</span><span class="sync-panel-value">' +
        '<select class="sync-panel-schedule-select" aria-label="Vault push schedule">' + opts + '</select>' +
        '</span></div></div>' +
        '<div class="sync-panel-actions modal-actions" style="margin-top:12px;flex-wrap:wrap;gap:8px">' +
        '<button type="button" class="btn btn-primary" data-cmd="aigon backup push">Push to vault</button>' +
        '<button type="button" class="btn btn-secondary" data-cmd="aigon backup pull">Pull from vault</button>' +
        '<button type="button" class="btn btn-secondary" data-cmd="aigon backup configure">Configure…</button>' +
        '</div>' +
        '<p class="settings-empty" style="margin-top:12px;font-size:12px">CLI reference: <code>aigon backup status</code>, ' +
        '<code>aigon vault</code> (alias). Use <strong>Configure</strong> when no remote is set yet.</p>';

    const sel = host.querySelector('.sync-panel-schedule-select');
    if (sel) {
        sel.onchange = () => {
            fetch('/api/backup/schedule', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ cadence: sel.value }),
            })
                .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
                .then(({ ok, d }) => {
                    if (!ok) throw new Error((d && d.error) || 'HTTP error');
                    if (typeof showToast === 'function') showToast('Schedule: ' + (d.schedule || sel.value));
                })
                .catch((e) => {
                    if (typeof showToast === 'function') showToast('Schedule failed: ' + e.message, null, null, { error: true });
                });
        };
    }
    host.querySelectorAll('[data-cmd]').forEach((btn) => {
        btn.onclick = () => {
            const cmd = btn.getAttribute('data-cmd');
            btn.disabled = true;
            openTerm(cmd)
                .then(() => { if (typeof showToast === 'function') showToast('Opened terminal'); })
                .catch((e) => { if (typeof showToast === 'function') showToast('Error: ' + e.message, null, null, { error: true }); })
                .finally(() => { btn.disabled = false; });
        };
    });
}

function renderBackupSync() {
    const host = document.getElementById('backup-sync-view');
    if (!host) return;
    host.innerHTML = '<div class="settings-loading">Loading Aigon Sync…</div>';
    fetch('/api/backup/status', { cache: 'no-store' })
        .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d })))
        .then(({ ok, status, d }) => {
            if (!ok) throw new Error((d && d.error) || ('HTTP ' + status));
            renderStatus(host, d);
        })
        .catch((e) => {
            host.innerHTML = '<p class="settings-empty">Could not load vault status: ' + escHtml(e.message) + '</p>';
        });
}

export { renderBackupSync, fmtWhen as fmtSyncTime };
