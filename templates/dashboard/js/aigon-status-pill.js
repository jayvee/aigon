/* dashboard-esm-processed */
// Feature 499 — three-phase upgrade pill rendered in the dashboard chrome.
// Phases derived from /api/version-status:
//   phase-1 — npm has a newer aigon CLI (advisory; user runs npm update).
//   phase-2 — installed CLI is newer than the dashboard process (offer restart).
//   phase-3 — applied templates drift from installed CLI (offer per-repo apply).
//
// F535 — phase-3 uses two vocabularies based on data.devMode:
//   user mode  — "applied vX" / "Re-apply vX"; staleness = version mismatch only.
//   dev  mode  — "Templates edited locally" / "Sync"; staleness = digest drift.
//
// No phase auto-advances; every action requires an explicit user click.
// Polling: 5s while document.visibilityState==='visible', 60s otherwise.

(function () {
  const ACTIVE_POLL_MS = 5000;
  const INACTIVE_POLL_MS = 60000;

  const root = document.getElementById('aigon-status-pill-host');
  if (!root) return;

  const state = {
    data: null,
    expanded: false,
    activeRepoOps: new Map(), // repoPath -> { actionId, status, message }
    flashUntil: 0,
    fetching: false,
    timer: null,
    previewRepoPath: null,
  };

  function getApiBase() {
    return (typeof window.AIGON_API_BASE === 'string' && window.AIGON_API_BASE) || '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Two audiences, two vocabularies (F535). User mode = normal npm install;
  // dev mode = maintainer running from a local checkout, where templates can
  // change between version bumps so digest drift is the real signal.
  const LABELS = {
    user: {
      currentWord: 'up to date',
      needsApplyWord: 'needs re-apply',
      neverWord: 'never applied',
      actionLabel: (installed) => `Re-apply v${installed}`,
      actionRunningLabel: 'Applying…',
      bannerOne: (installed, n) => `Re-apply aigon v${installed} to ${n} repo`,
      bannerMany: (installed, n) => `Re-apply aigon v${installed} to ${n} repos`,
      bannerCurrentOnly: (installed) => `Re-apply aigon v${installed} (this repo is up to date — see registered repos below)`,
      applyAllLabel: (n) => `Re-apply all ${n}`,
      flashLabel: (installed) => installed ? `All repos applied at v${installed}` : 'All repos applied',
    },
    dev: {
      currentWord: 'synced',
      needsApplyWord: 'out of sync',
      neverWord: 'never synced',
      actionLabel: () => 'Sync',
      actionRunningLabel: 'Syncing…',
      bannerOne: (_installed, n) => `Templates edited locally — ${n} repo out of sync`,
      bannerMany: (_installed, n) => `Templates edited locally — ${n} repos out of sync`,
      bannerCurrentOnly: () => 'Templates edited locally — registered repos out of sync',
      applyAllLabel: (n) => `Sync all ${n}`,
      flashLabel: () => 'All repos synced',
    },
  };

  function getLabels(data) {
    return (data && data.devMode) ? LABELS.dev : LABELS.user;
  }

  function derivePhase(data) {
    if (!data) return null;
    const installed = data.installedCli;
    if (!installed) return null;
    if (data.npmLatest && data.npmLatest !== installed) return 'phase-1';
    if (data.dashboardProcess && data.dashboardProcess !== installed) return 'phase-2';
    const cur = data.current || {};
    if (cur.stale) return 'phase-3';
    if (Array.isArray(data.repos) && data.repos.some(r => r.stale)) return 'phase-3';
    return null;
  }

  function allRepos(data) {
    if (!data) return [];
    const cur = data.current || {};
    const repos = Array.isArray(data.repos) && data.repos.length > 0
      ? data.repos.slice()
      : [];
    if (cur && cur.repoPath && !repos.some(r => r.repoPath === cur.repoPath)) {
      repos.unshift(cur);
    }
    return repos;
  }

  function staleApplyRepos(data) {
    return allRepos(data).filter(r => r && r.stale);
  }

  // ── Phase renderers ───────────────────────────────────────────────────────
  function renderPhase1(data) {
    const v = escapeHtml(data.npmLatest);
    const have = escapeHtml(data.installedCli);
    const expanded = state.expanded;
    return `
      <div class="aigon-pill phase-1" role="status" aria-label="aigon update available">
        <span class="aigon-pill-icon">↑</span>
        <span class="aigon-pill-text">aigon v${v} available <span class="aigon-pill-dim">(you have v${have})</span></span>
        <button class="aigon-pill-btn" data-pill-action="toggle">${expanded ? 'Hide' : 'Show'}</button>
      </div>
      ${expanded ? `
        <div class="aigon-pill-expanded">
          <div class="aigon-pill-row">
            <span class="aigon-pill-label">Upgrade with</span>
            <code class="aigon-pill-code">npm update -g @senlabsai/aigon</code>
            <button class="aigon-pill-btn" data-pill-action="copy-npm">Copy</button>
          </div>
          <div class="aigon-pill-hint">After upgrading, restart the dashboard with the button that appears here.</div>
        </div>` : ''}
    `;
  }

  function renderPhase2(data) {
    const installed = escapeHtml(data.installedCli);
    const dashboardV = escapeHtml(data.dashboardProcess || '?');
    return `
      <div class="aigon-pill phase-2" role="status" aria-label="dashboard restart needed">
        <span class="aigon-pill-icon ok">✓</span>
        <span class="aigon-pill-text">aigon v${installed} installed. Restart the dashboard <span class="aigon-pill-dim">(running v${dashboardV})</span> to use it.</span>
        <button class="aigon-pill-btn primary" data-pill-action="restart">Restart now</button>
      </div>
    `;
  }

  function renderRepoRow(repo) {
    const data = state.data || {};
    const labels = getLabels(data);
    const installed = data.installedCli || '';
    const op = state.activeRepoOps.get(repo.repoPath);
    const opStatus = op && op.status;
    const opMsg = op && op.message;
    const opClass = opStatus ? ` op-${opStatus}` : '';
    const previewOpen = state.previewRepoPath === repo.repoPath;
    const neverApplied = !repo.appliedVersion;
    const statusClass = repo.stale ? 'stale' : 'current';
    const statusWord = neverApplied
      ? labels.neverWord
      : (repo.stale ? labels.needsApplyWord : labels.currentWord);

    // Meta line: user mode shows the version stamp (the signal that matters);
    // dev mode shows the content delta (the signal that matters there). Avoids
    // the old "applied vX next to a Re-apply button" contradiction.
    let metaText;
    if (data.devMode) {
      metaText = repo.contentDelta ? escapeHtml(repo.contentDelta) : (neverApplied ? '' : '');
    } else {
      metaText = repo.appliedVersion ? `applied v${escapeHtml(repo.appliedVersion)}` : 'never applied';
    }

    const actionLabel = opStatus === 'running' ? labels.actionRunningLabel : labels.actionLabel(escapeHtml(installed));

    return `
      <div class="aigon-pill-repo${opClass}" data-repo-path="${escapeHtml(repo.repoPath)}">
        <div class="aigon-pill-repo-h">
          <span class="aigon-pill-repo-name">${escapeHtml(repo.name || repo.repoPath)}</span>
          <span class="aigon-pill-repo-meta">${metaText}</span>
          <span class="aigon-pill-repo-state ${statusClass}">${statusWord}</span>
          <span class="aigon-pill-repo-actions">
            ${repo.stale ? `
              <button class="aigon-pill-btn" data-pill-action="preview" data-repo="${escapeHtml(repo.repoPath)}">${previewOpen ? 'Hide preview' : 'Preview'}</button>
              <button class="aigon-pill-btn primary" data-pill-action="apply-one" data-repo="${escapeHtml(repo.repoPath)}" ${opStatus === 'running' ? 'disabled' : ''}>${actionLabel}</button>
            ` : `<span class="aigon-pill-dim">${neverApplied ? labels.neverWord : labels.currentWord}</span>`}
          </span>
        </div>
        ${opMsg ? `<div class="aigon-pill-repo-msg">${escapeHtml(opMsg)}</div>` : ''}
        ${previewOpen ? `<div class="aigon-pill-preview" data-preview-for="${escapeHtml(repo.repoPath)}"><span class="aigon-pill-dim">Loading preview…</span></div>` : ''}
      </div>
    `;
  }

  function renderPhase3(data) {
    const stale = staleApplyRepos(data);
    const repos = allRepos(data);

    const installed = escapeHtml(data.installedCli);
    const labels = getLabels(data);
    const expanded = state.expanded;
    const staleCount = stale.length;
    const summary = staleCount === 0
      ? labels.bannerCurrentOnly(installed)
      : (staleCount === 1
        ? labels.bannerOne(installed, staleCount)
        : labels.bannerMany(installed, staleCount));

    return `
      <div class="aigon-pill phase-3" role="status" aria-label="apply needed">
        <span class="aigon-pill-icon">↻</span>
        <span class="aigon-pill-text">${summary}</span>
        <button class="aigon-pill-btn" data-pill-action="toggle">${expanded ? 'Hide repos ▴' : 'Show repos ▾'}</button>
        ${staleCount > 1 ? `<button class="aigon-pill-btn primary" data-pill-action="apply-all">${labels.applyAllLabel(staleCount)}</button>` : ''}
      </div>
      ${expanded ? `
        <div class="aigon-pill-expanded">
          ${repos.map(renderRepoRow).join('')}
        </div>` : ''}
    `;
  }

  function renderFlash(text) {
    return `
      <div class="aigon-pill phase-done" role="status">
        <span class="aigon-pill-icon ok">✓</span>
        <span class="aigon-pill-text">${escapeHtml(text)}</span>
      </div>
    `;
  }

  function render() {
    const data = state.data;
    if (state.flashUntil > Date.now()) {
      const installed = (data && data.installedCli) || '';
      const labels = getLabels(data);
      root.innerHTML = renderFlash(labels.flashLabel(installed));
      root.removeAttribute('data-hidden');
      return;
    }
    const phase = derivePhase(data);
    if (!phase) {
      root.setAttribute('data-hidden', '');
      root.innerHTML = '';
      return;
    }
    root.removeAttribute('data-hidden');
    if (phase === 'phase-1') root.innerHTML = renderPhase1(data);
    else if (phase === 'phase-2') root.innerHTML = renderPhase2(data);
    else if (phase === 'phase-3') root.innerHTML = renderPhase3(data);
    bindHandlers();
    // Lazy-load preview content for any newly-opened previews.
    if (state.previewRepoPath) loadPreviewIfNeeded(state.previewRepoPath);
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  async function fetchStatus() {
    if (state.fetching) return;
    state.fetching = true;
    try {
      const res = await fetch(getApiBase() + '/api/version-status', { cache: 'no-store' });
      if (!res.ok) return;
      state.data = await res.json();
      render();
    } catch (_) {
      /* transient — keep last data */
    } finally {
      state.fetching = false;
    }
  }

  function scheduleNext() {
    clearTimeout(state.timer);
    const ms = document.visibilityState === 'hidden' ? INACTIVE_POLL_MS : ACTIVE_POLL_MS;
    state.timer = setTimeout(tick, ms);
  }

  async function tick() {
    await fetchStatus();
    scheduleNext();
  }

  document.addEventListener('visibilitychange', () => { scheduleNext(); });

  // ── Action wiring ─────────────────────────────────────────────────────────
  function bindHandlers() {
    root.querySelectorAll('[data-pill-action]').forEach(btn => {
      btn.addEventListener('click', onAction, { once: true });
    });
  }

  async function onAction(ev) {
    const btn = ev.currentTarget;
    const action = btn.getAttribute('data-pill-action');
    const repoPath = btn.getAttribute('data-repo');
    if (action === 'toggle') {
      state.expanded = !state.expanded;
      render();
    } else if (action === 'copy-npm') {
      try {
        await navigator.clipboard.writeText('npm update -g @senlabsai/aigon');
        if (typeof window.showToast === 'function') window.showToast('Copied: npm update -g @senlabsai/aigon');
      } catch (_) { /* ignore */ }
      render();
    } else if (action === 'restart') {
      if (typeof window.showServerRestartBanner === 'function') window.showServerRestartBanner();
      try {
        await fetch(getApiBase() + '/api/server/restart', { method: 'POST' });
      } catch (_) { /* server is going down — expected */ }
    } else if (action === 'preview') {
      state.previewRepoPath = state.previewRepoPath === repoPath ? null : repoPath;
      render();
    } else if (action === 'apply-one') {
      runApply([repoPath]);
    } else if (action === 'apply-all') {
      const stale = staleApplyRepos(state.data).map(r => r.repoPath);
      runApply(stale);
    }
  }

  async function loadPreviewIfNeeded(repoPath) {
    const container = root.querySelector(`[data-preview-for="${cssEscape(repoPath)}"]`);
    if (!container || container.dataset.loaded === '1') return;
    container.dataset.loaded = '1';
    try {
      const res = await fetch(getApiBase() + '/api/apply/preview?repoPath=' + encodeURIComponent(repoPath));
      const data = await res.json();
      if (!res.ok) {
        container.innerHTML = `<span class="aigon-pill-error">Preview failed: ${escapeHtml(data.error || res.status)}</span>`;
        return;
      }
      if (!data.totalChanges) {
        container.innerHTML = '<span class="aigon-pill-dim">No changes — repo is already current.</span>';
        return;
      }
      const summary = Object.entries(data.summary).map(([cat, n]) => `${n} ${cat}`).join(', ');
      const fileLines = data.files.map(f =>
        `<li class="aigon-pill-preview-row change-${escapeHtml(f.change)}"><span class="change">${escapeHtml(f.change)}</span> <span class="path">${escapeHtml(f.path)}</span></li>`
      ).join('');
      container.innerHTML = `
        <div class="aigon-pill-preview-summary">${escapeHtml(data.totalChanges)} file${data.totalChanges === 1 ? '' : 's'} would change · ${escapeHtml(summary)}</div>
        <ul class="aigon-pill-preview-list">${fileLines}</ul>
      `;
    } catch (e) {
      container.innerHTML = `<span class="aigon-pill-error">Preview failed: ${escapeHtml(e.message)}</span>`;
    }
  }

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c.charCodeAt(0).toString(16) + ' ');
  }

  async function runApply(repoPaths) {
    if (!Array.isArray(repoPaths) || repoPaths.length === 0) return;
    for (const repoPath of repoPaths) {
      state.activeRepoOps.set(repoPath, { status: 'running', message: 'Applying…' });
    }
    render();

    let failures = 0;
    for (const repoPath of repoPaths) {
      const actionId = 'apply-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      try {
        const res = await fetch(getApiBase() + '/api/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'apply', args: [], repoPath, actionId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          state.activeRepoOps.set(repoPath, { status: 'failed', message: body.error || `HTTP ${res.status}` });
          failures += 1;
        } else {
          state.activeRepoOps.set(repoPath, { status: 'done', message: 'Applied' });
        }
      } catch (e) {
        state.activeRepoOps.set(repoPath, { status: 'failed', message: e.message });
        failures += 1;
      }
      render();
    }

    // Refresh status to clear stale flags. If everything went green, flash and hide.
    await fetchStatus();
    const remaining = staleApplyRepos(state.data);
    if (failures === 0 && remaining.length === 0) {
      state.flashUntil = Date.now() + 5000;
      state.activeRepoOps.clear();
      state.expanded = false;
      render();
      setTimeout(() => { state.flashUntil = 0; render(); }, 5100);
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  fetchStatus().then(scheduleNext);
})();

// ── ESM exports (F623) ──
Object.assign(globalThis, { render });
