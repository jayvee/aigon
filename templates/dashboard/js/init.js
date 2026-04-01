    // ── Insights view ──────────────────────────────────────────────────────────
    async function renderInsights() {
      var c = document.getElementById('insights-view');
      if (!c) return;

      document.getElementById('monitor-summary').style.display = 'none';
      document.getElementById('repo-header').style.display = 'none';
      document.getElementById('settings-view').style.display = 'none';
      document.getElementById('config-view').style.display = 'none';
      document.getElementById('empty').style.display = 'none';

      // Gate entire Insights view when Pro is not active
      if (!isProActive()) {
        c.innerHTML = '<div class="amp-empty" style="padding:40px;text-align:center"><div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Insights requires Aigon Pro</div><div style="font-size:11px;color:var(--text-tertiary);margin-bottom:12px">AI-powered observations, coaching, and quality analytics.</div><a href="https://aigon.build/pro" target="_blank" style="font-size:12px;color:var(--accent,#3b82f6);text-decoration:none">Get Aigon Pro &rarr;</a></div>';
        c.style.display = '';
        return;
      }

      // Load analytics data for the amplification section
      if (!statsState.data) {
        c.innerHTML = '<div class="amp-empty" style="padding:20px"><span class="toast-spinner"></span>Loading insights…</div>';
        await loadAnalytics();
      }

      // Load insights data
      if (!statsState.insightsData && !statsState.insightsLoading) {
        await loadInsights(false);
      }

      var analytics = statsState.data;
      var filteredFeatures = analytics ? analytics.features || [] : [];

      // Build amplification section (reuses function from logs.js)
      var ampHtml = '';
      if (typeof buildAmplificationSection === 'function') {
        ampHtml = buildAmplificationSection(filteredFeatures);
      }

      // Build insights observations
      var insightsHtml = '';
      var payload = statsState.insightsData;

      if (statsState.insightsLoading) {
        insightsHtml = '<div class="amp-empty"><span class="toast-spinner"></span>Loading insights…</div>';
      } else if (statsState.insightsError) {
        insightsHtml = '<div class="amp-empty">Failed to load insights: ' + escHtml(statsState.insightsError) + '</div>';
      } else if (!payload || !payload.report) {
        insightsHtml = '<div class="amp-empty">Run <code>aigon insights</code> or click Refresh to generate insights.</div>';
      } else if (payload.report.insufficientData) {
        insightsHtml = '<div class="amp-empty">' + escHtml(payload.report.summary || 'Not enough data for insights yet.') + '</div>';
      } else {
        insightsHtml = (payload.report.observations || []).map(function(obs) {
          var severity = escHtml(String(obs.severity || 'info').toLowerCase());
          return '<article class="amp-insight-item">' +
            '<div class="amp-insight-title"><span class="amp-insight-sev ' + severity + '">' + severity.toUpperCase() + '</span> ' + escHtml(obs.title || 'Insight') + '</div>' +
            '<div class="amp-insight-observation">' + escHtml(obs.observation || '') + '</div>' +
            '<div class="amp-insight-action">Action: ' + escHtml(obs.action || '—') + '</div>' +
            '</article>';
        }).join('');

        var coachingHtml = '<div class="amp-insights-gated">AI coaching is available for Pro tier with <code>aigon insights --coach</code>.</div>';
        if (payload.coaching && payload.coaching.ok && Array.isArray(payload.coaching.recommendations) && payload.coaching.recommendations.length > 0) {
          coachingHtml = '<div class="amp-insights-coaching-title">AI Coaching (Pro)</div><ol class="amp-insights-coaching-list">' + payload.coaching.recommendations.slice(0, 5).map(function(rec) { return '<li>' + escHtml(rec) + '</li>'; }).join('') + '</ol>';
        } else if (payload.coaching && payload.coaching.error && !payload.coaching.gated) {
          coachingHtml = '<div class="amp-insights-gated">AI coaching unavailable: ' + escHtml(payload.coaching.error) + '</div>';
        }
        insightsHtml += coachingHtml;
      }

      var meta = payload && payload.generatedAt ? 'Updated ' + escHtml(relTime(payload.generatedAt)) : 'No cached insights yet';

      c.innerHTML = '<div style="padding:0 0 28px">' +
        ampHtml +
        '<div class="stats-section-title" style="margin-top:20px">Observations</div>' +
        '<div class="amp-insights-toolbar">' +
          '<span class="amp-insights-meta">' + meta + '</span>' +
          '<button class="btn" id="amp-insights-refresh-btn">Refresh</button>' +
        '</div>' +
        '<div class="amp-insights-body">' + insightsHtml + '</div>' +
        '</div>';

      // Init Chart.js token charts after DOM is ready
      if (typeof initAmpTokenCharts === 'function') initAmpTokenCharts();

      var refreshBtn = document.getElementById('amp-insights-refresh-btn');
      if (refreshBtn) refreshBtn.onclick = async function() {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<span class="run-next-spinner"></span>Refreshing…';
        var body = document.querySelector('.amp-insights-body');
        if (body) body.innerHTML = '<div class="amp-empty"><span class="toast-spinner"></span>Generating insights…</div>';
        await loadInsights(true);
        renderInsights();
      };
    }

    // ── Main render dispatch ───────────────────────────────────────────────────

    function viewUsesRepoSidebar(view) {
      return view === 'monitor' || view === 'pipeline' || view === 'sessions' || view === 'config' || view === 'statistics';
    }

    function updateSidebarToggle() {
      const btn = document.getElementById('sidebar-toggle-btn');
      if (!btn) return;
      const enabled = viewUsesRepoSidebar(state.view);
      btn.style.display = enabled ? '' : 'none';
      btn.setAttribute('aria-label', state.sidebarHidden ? 'Show sidebar' : 'Hide sidebar');
      btn.setAttribute('title', state.sidebarHidden ? 'Show sidebar' : 'Hide sidebar');
      btn.classList.toggle('is-hidden', !!state.sidebarHidden);
    }

    // Stored reference so render() can re-filter without re-fetching
    let _sessionsFilterFn = null;

    async function renderSessions() {
      const container = document.getElementById('sessions-view');
      container.innerHTML = '<div style="padding:12px 0;color:var(--text-tertiary);font-size:12px">Loading sessions…</div>';

      let sessions = [];
      let orphanCount = 0;
      try {
        const res = await fetch('/api/sessions');
        const data = await res.json();
        sessions = data.sessions || [];
        orphanCount = data.orphanCount || 0;
      } catch (e) {
        container.innerHTML = '<div class="empty">Failed to load sessions: ' + escHtml(e.message) + '</div>';
        return;
      }

      container.innerHTML = '';

      // Toolbar
      const toolbar = document.createElement('div');
      toolbar.className = 'sessions-toolbar';
      toolbar.innerHTML = '<strong style="font-size:15px;font-weight:600;letter-spacing:-.01em">Tmux Sessions</strong>' +
        '<span style="font-size:12px;color:var(--text-tertiary)" id="sessions-count-label">' + sessions.length + ' session' + (sessions.length === 1 ? '' : 's') + '</span>' +
        (orphanCount > 0 ? '<button class="btn btn-warn" id="sessions-kill-orphans-btn" style="font-size:11px;padding:4px 10px">Kill ' + orphanCount + ' Orphan' + (orphanCount === 1 ? '' : 's') + '</button>' : '') +
        '<button class="btn" id="sessions-tile-btn" style="margin-left:auto" title="Arrange all iTerm2 windows into a grid">⊞ Tile Windows</button>' +
        '<button class="btn" id="sessions-refresh-btn">↺ Refresh</button>';
      container.appendChild(toolbar);
      document.getElementById('sessions-tile-btn').onclick = async () => {
        try {
          const r = await fetch('/api/tile-windows', { method: 'POST' });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Failed');
          showToast('Windows tiled');
        } catch (e) { showToast('Tile failed: ' + e.message, null, null, {error:true}); }
      };
      document.getElementById('sessions-refresh-btn').onclick = () => renderSessions();
      const killOrphansBtn = document.getElementById('sessions-kill-orphans-btn');
      if (killOrphansBtn) {
        killOrphansBtn.onclick = async () => {
          if (!confirm('Kill all ' + orphanCount + ' orphaned session' + (orphanCount === 1 ? '' : 's') + '?')) return;
          try {
            const r = await fetch('/api/sessions/cleanup', { method: 'POST' });
            const d = await r.json();
            showToast('Killed ' + (d.count || 0) + ' orphan' + (d.count === 1 ? '' : 's'));
          } catch (e) { showToast('Cleanup failed: ' + e.message); }
          renderSessions();
        };
      }

      function entityBadge(s) {
        if (!s.entityType) return '';
        const label = s.entityType + s.entityId;
        const cls = s.entityType === 'f' ? 'feature' : 'research';
        return '<span class="session-entity-badge ' + cls + '">' + escHtml(label) + '</span>';
      }

      function repoBadge(s) {
        if (!s.repoPath) return '';
        const name = s.repoPath.split('/').pop();
        return '<span class="session-entity-badge" style="background:var(--bg-surface);color:var(--text-secondary)">' + escHtml(name) + '</span>';
      }

      function statusBadge(s) {
        if (s.orphan) {
          const reasonLabels = { done: 'feature done', paused: 'feature paused', 'spec-missing': 'spec deleted' };
          const label = reasonLabels[s.orphan.reason] || 'orphan';
          const entity = s.entityType && s.entityId ? ' — ' + s.entityType.toUpperCase() + s.entityId : '';
          const tip = s.orphan.reason === 'done' ? 'This session\'s feature has been completed'
            : s.orphan.reason === 'paused' ? 'This session\'s feature is paused'
            : s.orphan.reason === 'spec-missing' ? 'No spec file found for this session\'s feature'
            : 'Session has no active feature';
          return '<span class="session-orphan-badge" title="' + escHtml(tip + entity) + '">' + label + entity + '</span>';
        }
        if (s.attached) return '<span class="session-attached-badge">attached</span>';
        return '';
      }

      function renderGroup(target, title, items, opts) {
        if (items.length === 0) return;
        const group = document.createElement('div');
        group.className = 'sessions-group';
        const titleCls = 'sessions-group-title' + (opts && opts.orphan ? ' orphan-title' : '');
        group.innerHTML = '<div class="' + titleCls + '">' + escHtml(title) + ' (' + items.length + ')</div>';
        items.forEach(s => {
          const row = document.createElement('div');
          const rowCls = 'session-row' + (s.attached ? ' attached' : '') + (s.orphan ? ' orphan' : '');
          row.className = rowCls;
          const age = relTime(s.createdAt);
          row.innerHTML =
            '<span class="session-name" title="' + escHtml(s.name) + '">' + escHtml(s.name) + '</span>' +
            entityBadge(s) +
            ((state.selectedRepo || 'all') === 'all' ? repoBadge(s) : '') +
            statusBadge(s) +
            '<span class="session-meta">' + age + '</span>' +
            '<span style="display:flex;gap:5px">' +
              '<button class="btn btn-primary" style="font-size:11px;padding:3px 8px" data-session="' + escHtml(s.name) + '">Open</button>' +
              '<button class="btn" style="font-size:11px;padding:3px 8px" data-peek="' + escHtml(s.name) + '">Peek</button>' +
              '<button class="btn btn-warn" style="font-size:11px;padding:3px 8px" data-kill="' + escHtml(s.name) + '">Kill</button>' +
            '</span>';

          row.querySelector('[data-session]').onclick = async (e) => {
            e.stopPropagation();
            try {
              const res = await fetch('/api/session/view', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionName: s.name, repoPath: s.repoPath || null })
              });
              const payload = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
              showToast(payload.message || 'Session focused in terminal');
            } catch (err) {
              showToast('View failed: ' + err.message, null, null, {error:true});
            }
          };
          row.querySelector('[data-peek]').onclick = (e) => {
            e.stopPropagation();
            openPeekPanel(s.name);
          };
          row.querySelector('[data-kill]').onclick = async (e) => {
            e.stopPropagation();
            if (!confirm('Kill session "' + s.name + '"?')) return;
            await fetch('/api/session/stop', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionName: s.name })
            });
            showToast('Killed: ' + s.name);
            renderSessions();
          };
          group.appendChild(row);
        });
        target.appendChild(group);
      }

      _sessionsFilterFn = renderSessionGroups;
      function renderSessionGroups() {
        // Remove existing groups (keep toolbar)
        container.querySelectorAll('.sessions-group, .empty').forEach(el => el.remove());

        // Read from shared sidebar repo selector
        const repoFilter = state.selectedRepo || 'all';
        const filtered = repoFilter === 'all'
          ? sessions
          : sessions.filter(s => s.repoPath === repoFilter || s.name.startsWith('aigon-dash'));
        const dashFiltered = filtered.filter(s => s.name.startsWith('aigon-dash'));
        const orphanFiltered = filtered.filter(s => !s.name.startsWith('aigon-dash') && s.orphan);
        const agentFiltered = filtered.filter(s => !s.name.startsWith('aigon-dash') && !s.orphan);
        // Unlinked sessions (no repo) — only show in "all" view
        const unlinkedSessions = repoFilter === 'all'
          ? sessions.filter(s => !s.repoPath && !s.name.startsWith('aigon-dash') && !s.orphan)
          : [];

        const countLabel = document.getElementById('sessions-count-label');
        if (countLabel) {
          const total = filtered.length;
          countLabel.textContent = total + ' session' + (total === 1 ? '' : 's');
        }

        if (filtered.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'empty';
          empty.textContent = 'No sessions for this repo.';
          container.appendChild(empty);
          return;
        }

        renderGroup(container, 'Agent Sessions', agentFiltered);
        renderGroup(container, 'Orphaned Sessions', orphanFiltered, { orphan: true });
        if (unlinkedSessions.length > 0) renderGroup(container, 'Unlinked Sessions', unlinkedSessions);
        renderGroup(container, 'Dashboard Sessions', dashFiltered);
      }

      if (sessions.length === 0) {
        container.innerHTML += '<div class="empty">No tmux sessions running.</div>';
        return;
      }

      renderSessionGroups();
    }

    function render() {
      updateViewTabs();
      updateSidebarToggle();
      const sidebar = document.getElementById('repo-sidebar');
      const mobileSelect = document.getElementById('repo-select-mobile');
      if (state.view === 'settings') {
        sidebar.style.display = 'none';
        mobileSelect.style.display = 'none';
        document.getElementById('settings-view').style.display = '';
        document.getElementById('config-view').style.display = 'none';
        document.getElementById('sessions-view').style.display = 'none';
        document.getElementById('statistics-view').style.display = 'none';
        document.getElementById('insights-view').style.display = 'none';
        document.getElementById('logs-view').style.display = 'none';
        document.getElementById('console-view').style.display = 'none';
        document.getElementById('repo-header').style.display = 'none';
        renderSettings();
      } else if (state.view === 'config') {
        sidebar.style.display = state.sidebarHidden ? 'none' : '';
        mobileSelect.style.display = '';
        document.getElementById('settings-view').style.display = 'none';
        document.getElementById('config-view').style.display = '';
        document.getElementById('sessions-view').style.display = 'none';
        document.getElementById('statistics-view').style.display = 'none';
        document.getElementById('insights-view').style.display = 'none';
        document.getElementById('logs-view').style.display = 'none';
        document.getElementById('console-view').style.display = 'none';
        const allRepos = ((state.data || {}).repos || []);
        renderSidebar(allRepos);
        const selectedRepoData = state.selectedRepo !== 'all' ? allRepos.find(r => r.path === state.selectedRepo) : null;
        renderRepoHeader(selectedRepoData);
        renderConfigView();
      } else if (state.view === 'sessions') {
        sidebar.style.display = state.sidebarHidden ? 'none' : '';
        mobileSelect.style.display = '';
        document.getElementById('settings-view').style.display = 'none';
        document.getElementById('config-view').style.display = 'none';
        document.getElementById('empty').style.display = 'none';
        document.getElementById('sessions-view').style.display = '';
        document.getElementById('statistics-view').style.display = 'none';
        document.getElementById('insights-view').style.display = 'none';
        document.getElementById('logs-view').style.display = 'none';
        document.getElementById('console-view').style.display = 'none';
        document.getElementById('repo-header').style.display = 'none';
        const allRepos = ((state.data || {}).repos || []);
        renderSidebar(allRepos);
        // Re-filter if sessions already loaded, otherwise fetch
        if (_sessionsFilterFn) { _sessionsFilterFn(); } else { renderSessions(); }
      } else if (state.view === 'statistics') {
        sidebar.style.display = state.sidebarHidden ? 'none' : '';
        mobileSelect.style.display = '';
        document.getElementById('settings-view').style.display = 'none';
        document.getElementById('config-view').style.display = 'none';
        document.getElementById('empty').style.display = 'none';
        document.getElementById('sessions-view').style.display = 'none';
        document.getElementById('statistics-view').style.display = '';
        document.getElementById('insights-view').style.display = 'none';
        document.getElementById('logs-view').style.display = 'none';
        document.getElementById('console-view').style.display = 'none';
        document.getElementById('repo-header').style.display = 'none';
        const allRepos = ((state.data || {}).repos || []);
        renderSidebar(allRepos);
        renderStatistics();
      } else if (state.view === 'insights') {
        sidebar.style.display = 'none';
        mobileSelect.style.display = 'none';
        document.getElementById('settings-view').style.display = 'none';
        document.getElementById('config-view').style.display = 'none';
        document.getElementById('empty').style.display = 'none';
        document.getElementById('sessions-view').style.display = 'none';
        document.getElementById('statistics-view').style.display = 'none';
        document.getElementById('insights-view').style.display = '';
        document.getElementById('logs-view').style.display = 'none';
        document.getElementById('console-view').style.display = 'none';
        document.getElementById('repo-header').style.display = 'none';
        renderInsights();
      } else if (state.view === 'logs') {
        sidebar.style.display = 'none';
        mobileSelect.style.display = 'none';
        document.getElementById('settings-view').style.display = 'none';
        document.getElementById('config-view').style.display = 'none';
        document.getElementById('empty').style.display = 'none';
        document.getElementById('sessions-view').style.display = 'none';
        document.getElementById('statistics-view').style.display = 'none';
        document.getElementById('insights-view').style.display = 'none';
        document.getElementById('logs-view').style.display = '';
        document.getElementById('console-view').style.display = 'none';
        document.getElementById('repo-header').style.display = 'none';
        renderLogsView();
      } else if (state.view === 'console') {
        sidebar.style.display = 'none';
        mobileSelect.style.display = 'none';
        document.getElementById('settings-view').style.display = 'none';
        document.getElementById('config-view').style.display = 'none';
        document.getElementById('empty').style.display = 'none';
        document.getElementById('sessions-view').style.display = 'none';
        document.getElementById('statistics-view').style.display = 'none';
        document.getElementById('insights-view').style.display = 'none';
        document.getElementById('logs-view').style.display = 'none';
        document.getElementById('console-view').style.display = '';
        document.getElementById('repo-header').style.display = 'none';
        renderConsole();
      } else {
        // monitor or pipeline — Alpine components handle the view content
        sidebar.style.display = state.sidebarHidden ? 'none' : '';
        mobileSelect.style.display = '';
        document.getElementById('settings-view').style.display = 'none';
        document.getElementById('config-view').style.display = 'none';
        document.getElementById('empty').style.display = 'none';
        document.getElementById('sessions-view').style.display = 'none';
        document.getElementById('statistics-view').style.display = 'none';
        document.getElementById('insights-view').style.display = 'none';
        document.getElementById('logs-view').style.display = 'none';
        document.getElementById('console-view').style.display = 'none';
        // Sidebar + header are shared between monitor and pipeline
        const allRepos = ((state.data || {}).repos || []);
        renderSidebar(allRepos);
        const selectedRepoData = state.selectedRepo !== 'all' ? allRepos.find(r => r.path === state.selectedRepo) : null;
        renderRepoHeader(selectedRepoData);
        setHealth();
        updateTitleAndFavicon(((state.data || {}).summary || {}).waiting || 0);
        document.getElementById('updated-text').textContent = 'Updated ' + relTime((state.data || {}).generatedAt || new Date().toISOString());
        // Alpine reactively renders #monitor-view and #pipeline-view based on state.view
      }
    }

    function refreshTimestamps() {
      document.querySelectorAll('[data-updated]').forEach(n => { n.textContent = relTime(n.getAttribute('data-updated')); });
      const generatedAt = (state.data && state.data.generatedAt) ? state.data.generatedAt : new Date().toISOString();
      document.getElementById('updated-text').textContent = 'Updated ' + relTime(generatedAt);
    }

    function flattenStatuses(data) {
      const map = new Map();
      (data.repos || []).forEach(repo => {
        (repo.features || []).forEach(feature => {
          (feature.agents || []).forEach(agent => {
            map.set(repo.path + ':' + feature.id + ':' + agent.id, { status: agent.status, cmd: agent.slashCommand });
          });
        });
      });
      return map;
    }

    async function poll() {
      const previous = flattenStatuses(state.data || {});
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const next = await res.json();
        state.failures = 0;
        const current = flattenStatuses(next);
        current.forEach((v, k) => {
          const prev = previous.get(k);
          if (!prev) return;
          if (prev.status !== 'waiting' && v.status === 'waiting') {
            showToast('Agent is waiting', v.cmd ? 'Copy command' : null, v.cmd ? () => copyText(v.cmd).then(() => showToast('Copied: ' + v.cmd)) : null);
          }
          if (prev.status !== 'error' && v.status === 'error') showToast('Agent entered error state', null, null, {error:true});
        });
        state.data = applyForceProOverride(next);
        render();
      } catch (e) {
        state.failures += 1;
        setHealth();
      }
    }

    // ── ?forcePro override ────────────────────────────────────────────────────
    function getForceProOverride() {
      const params = new URLSearchParams(location.search);
      if (!params.has('forcePro')) return null;
      const val = params.get('forcePro');
      if (val === '0' || val === 'false') return false;
      if (val === '1' || val === 'true') return true;
      return null;
    }

    function applyForceProOverride(data) {
      if (!data) return data;
      const override = getForceProOverride();
      if (override === false) data.proAvailable = false;
      return data;
    }

    // Helper: check Pro availability from current state (respects URL override)
    function isProActive() {
      const override = getForceProOverride();
      if (override === false) return false;
      return !!(state.data && state.data.proAvailable);
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    applyForceProOverride(state.data);
    render();
    // Docs link — detect dev mode (localhost) vs production
    const docsLink = document.getElementById('docs-link');
    if (docsLink) {
      const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.endsWith('.localhost');
      docsLink.href = isDev ? 'http://localhost:3600/docs' : 'https://aigon.build/docs';
      docsLink.title = isDev ? 'Open docs (local dev)' : 'Open Aigon docs';
    }
    document.getElementById('refresh-btn').onclick = requestRefresh;
    document.getElementById('sidebar-toggle-btn').onclick = () => {
      state.sidebarHidden = !state.sidebarHidden;
      localStorage.setItem(lsKey('sidebarHidden'), String(state.sidebarHidden));
      render();
    };
    setInterval(refreshTimestamps, TS_MS);
    setInterval(poll, POLL_MS);
    setTimeout(poll, 400);

    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.onclick = () => {
        state.view = tab.getAttribute('data-view');
        localStorage.setItem(lsKey('view'), state.view);
        render();
      };
    });

    // Sidebar resize
    (() => {
      const sidebar = document.getElementById('repo-sidebar');
      const handle = document.getElementById('sidebar-resize');
      const saved = localStorage.getItem('aigon-sidebar-width');
      if (saved) sidebar.style.setProperty('--sidebar-width', saved + 'px');
      let startX, startW;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = sidebar.offsetWidth;
        handle.classList.add('active');
        const onMove = (e) => {
          const w = Math.min(400, Math.max(140, startW + e.clientX - startX));
          sidebar.style.setProperty('--sidebar-width', w + 'px');
        };
        const onUp = () => {
          handle.classList.remove('active');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          localStorage.setItem('aigon-sidebar-width', sidebar.offsetWidth);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    })();

    // ── Notification bell & dropdown ─────────────────────────────────────────

    const notifBellBtn = document.getElementById('notif-bell-btn');
    const notifBadge = document.getElementById('notif-badge');
    const notifDropdown = document.getElementById('notif-dropdown');
    const notifOverlay = document.getElementById('notif-overlay');
    const notifList = document.getElementById('notif-list');
    const notifCloseBtn = document.getElementById('notif-close-btn');

    const NOTIF_TYPE_LABELS_DISPLAY = {
      'agent-waiting': 'Waiting',
      'agent-submitted': 'Submitted',
      'all-submitted': 'All Submitted',
      'all-research-submitted': 'Research Done',
      'error': 'Error'
    };

    function relTimeShort(iso) {
      const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function renderNotifList(events) {
      if (!events || events.length === 0) {
        notifList.innerHTML = '<div class="notif-empty">No notifications yet</div>';
        return;
      }
      notifList.innerHTML = '';
      [...events].reverse().forEach(ev => {
        const item = document.createElement('div');
        item.className = 'notif-item' + (ev.read ? '' : ' unread');
        item.style.cursor = 'pointer';
        const typeLabel = NOTIF_TYPE_LABELS_DISPLAY[ev.type] || ev.type;
        item.innerHTML =
          '<div class="notif-item-type ' + ev.type + '">' + escHtml(typeLabel) + '</div>' +
          '<div class="notif-item-msg">' + escHtml(ev.message) + '</div>' +
          '<div class="notif-item-time">' + relTimeShort(ev.timestamp) + '</div>';
        item.onclick = () => {
          closeNotifDropdown();
        };
        notifList.appendChild(item);
      });
    }

    function updateBadge(count) {
      if (count > 0) {
        notifBadge.textContent = count > 99 ? '99+' : String(count);
        notifBadge.removeAttribute('data-hidden');
      } else {
        notifBadge.setAttribute('data-hidden', '');
      }
    }

    async function loadNotifications() {
      try {
        const r = await fetch('/api/notifications');
        if (!r.ok) return;
        const data = await r.json();
        updateBadge(data.unreadCount || 0);
        return data.events || [];
      } catch (_) { return []; }
    }

    async function openNotifDropdown() {
      const events = await loadNotifications();
      renderNotifList(events);
      notifDropdown.classList.add('open');
      notifOverlay.classList.add('open');
      // Mark all as read
      try { await fetch('/api/notifications/read', { method: 'POST' }); } catch (_) {}
      updateBadge(0);
    }

    function closeNotifDropdown() {
      notifDropdown.classList.remove('open');
      notifOverlay.classList.remove('open');
    }

    notifBellBtn.onclick = () => {
      if (notifDropdown.classList.contains('open')) closeNotifDropdown();
      else openNotifDropdown();
    };
    notifCloseBtn.onclick = closeNotifDropdown;
    notifOverlay.onclick = closeNotifDropdown;

    // Poll badge count every 30s without opening the dropdown
    setInterval(async () => {
      if (!notifDropdown.classList.contains('open')) {
        await loadNotifications();
      }
    }, 30000);
    // Initial badge check
    loadNotifications();
