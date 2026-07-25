/* dashboard-esm-processed */
/* global fetch */
/**
 * Extra context under Settings → Schedule (#scheduled-features-view).
 * The deferred-jobs table is owned by js/settings.js; this panel is supplementary.
 * Merged from aigon-pro by F693.
 */

function escHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function selectedRepoPath() {
    const select = document.querySelector('.settings-schedule-toolbar .settings-target-select');
    if (!select || !select.value || select.value === '__all__') return '';
    return select.value;
}

function lastPeriod(item) {
    if (!item) return '';
    if (item.schedule === 'weekly') return item.lastWeek || '';
    if (item.schedule === 'monthly') return item.lastMonth || '';
    if (item.schedule === 'quarterly') return item.lastQuarter || '';
    return item.lastWeek || item.lastMonth || item.lastQuarter || '';
}

function currentPeriod(item) {
    if (!item) return '';
    if (item.schedule === 'weekly') return item.currentWeek || '';
    if (item.schedule === 'monthly') return item.currentMonth || '';
    if (item.schedule === 'quarterly') return item.currentQuarter || '';
    return item.currentWeek || item.currentMonth || item.currentQuarter || '';
}

async function loadRecurringStatus(host, body) {
    body.innerHTML = '<p class="settings-empty" style="font-size:12px">Loading recurring templates...</p>';
    let url = '/api/recurring/status';
    const repoPath = selectedRepoPath();
    if (repoPath) url += '?repoPath=' + encodeURIComponent(repoPath);
    try {
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) {
            body.innerHTML =
                '<p class="settings-empty" style="font-size:12px;line-height:1.45">' +
                'No recurring templates found in <code>docs/specs/recurring/</code> for this filter.</p>';
            return;
        }

        const rows = items.map((item) => {
            const status = item.isDue ? 'Due' : 'Done';
            const reason = item.reason ? ' <span style="color:var(--text-tertiary)">(' + escHtml(item.reason) + ')</span>' : '';
            return '<tr>' +
                '<td>' + escHtml(item.displayPath || item.repoPath || '') + '</td>' +
                '<td><code>' + escHtml(item.recurringSlug || '') + '</code></td>' +
                '<td>' + escHtml(item.schedule || '') + '</td>' +
                '<td>' + escHtml(lastPeriod(item) || '-') + '</td>' +
                '<td>' + escHtml(currentPeriod(item) || '-') + '</td>' +
                '<td>' + escHtml(status) + reason + '</td>' +
                '</tr>';
        }).join('');

        body.innerHTML =
            '<table class="schedule-jobs-table">' +
            '<thead><tr><th>Repository</th><th>Template</th><th>Cadence</th><th>Last period</th><th>Current period</th><th>Status</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    } catch (e) {
        body.innerHTML = '<p class="settings-empty" style="font-size:12px">Failed to load recurring templates: ' + escHtml(e.message) + '</p>';
    }
}

function renderScheduledFeatures() {
    const host = document.getElementById('scheduled-features-view');
    if (!host) return;
    host.innerHTML =
        '<div class="settings-subsection" style="margin-top:4px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">' +
        '<h4 style="font-size:13px;margin:0">Recurring templates</h4>' +
        '<button type="button" class="btn btn-secondary" data-recurring-refresh>Refresh</button>' +
        '</div>' +
        '<div data-recurring-body></div>' +
        '</div>';
    const body = host.querySelector('[data-recurring-body]');
    const refresh = host.querySelector('[data-recurring-refresh]');
    const select = document.querySelector('.settings-schedule-toolbar .settings-target-select');
    if (refresh) refresh.onclick = () => loadRecurringStatus(host, body);
    if (select && !select.dataset.recurringStatusBound) {
        select.dataset.recurringStatusBound = '1';
        select.addEventListener('change', () => {
            const current = document.getElementById('scheduled-features-view');
            const currentBody = current && current.querySelector('[data-recurring-body]');
            if (currentBody) loadRecurringStatus(current, currentBody);
        });
    }
    loadRecurringStatus(host, body);
}

export { renderScheduledFeatures };
