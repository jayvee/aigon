    // ── Logs view ──────────────────────────────────────────────────────────────

    const logsState = {
      sort: { col: 'updatedAt', dir: 'desc' },
      search: '',
      repoFilter: 'all',
      page: 0,
      pageSize: 50
    };

    function slugToTitle(slug) {
      return (slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // ── Console view ─────────────────────────────────────────────────────────
    const CONSOLE_LS_KEY = lsKey('consoleEvents');
    const CONSOLE_LS_MAX = 200;

    function loadConsoleFromStorage() {
      try { return JSON.parse(localStorage.getItem(CONSOLE_LS_KEY)) || []; } catch (_) { return []; }
    }
    function saveConsoleToStorage(events) {
      try { localStorage.setItem(CONSOLE_LS_KEY, JSON.stringify(events.slice(-CONSOLE_LS_MAX))); } catch (_) {}
    }
    function mergeConsoleEvents(stored, server) {
      // Deduplicate by timestamp+command, prefer server version
      const seen = new Set();
      const merged = [];
      for (const ev of server) {
        const key = (ev.timestamp || '') + '|' + (ev.command || ev.action || '');
        seen.add(key);
        merged.push(ev);
      }
      for (const ev of stored) {
        const key = (ev.timestamp || '') + '|' + (ev.command || ev.action || '');
        if (!seen.has(key)) merged.push(ev);
      }
      merged.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
      return merged.slice(-CONSOLE_LS_MAX);
    }

    const consoleState = { events: loadConsoleFromStorage(), scrollLocked: false };

    async function renderConsole() {
      const container = document.getElementById('console-view');
      if (!container) return;

      // Fetch events from server, merge with localStorage
      let events = consoleState.events;
      try {
        const res = await fetch('/api/console', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const serverEvents = data.events || [];
          events = mergeConsoleEvents(consoleState.events, serverEvents);
          consoleState.events = events;
          saveConsoleToStorage(events);
        }
      } catch (_) {}

      // Build HTML
      const html = [];
      html.push('<div class="console-view">');
      html.push('<div class="console-toolbar">');
      html.push('<button class="console-clear-btn" id="console-clear-btn">Clear</button>');
      html.push(`<span class="console-count">${events.length} event${events.length !== 1 ? 's' : ''}</span>`);
      html.push('</div>');
      html.push('<div class="console-log" id="console-log">');
      if (events.length === 0) {
        html.push('<div class="console-empty">No events yet — run an action to see output here</div>');
      } else {
        // Show newest entries first
        const sorted = [...events].reverse();
        sorted.forEach((evt, idx) => {
          const ts = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
          const ok = evt.ok !== false;
          const statusIcon = ok ? '✓' : '✗';
          const dur = evt.duration != null ? (evt.duration / 1000).toFixed(1) + 's' : '';
          const cmd = escHtml(evt.command || evt.action || evt.type || '');
          const repo = evt.repoPath ? escHtml(evt.repoPath.split('/').pop()) : '';
          const errorClass = ok ? '' : ' error';
          html.push(`<div class="console-entry${errorClass}" data-idx="${idx}">`);
          html.push('<div class="console-entry-row">');
          html.push(`<span class="console-ts">[${escHtml(ts)}]</span>`);
          html.push(`<span class="console-status" style="color:${ok ? 'var(--success)' : 'var(--error)'}">${statusIcon}</span>`);
          if (repo) html.push(`<span class="console-repo">${repo}</span>`);
          html.push(`<span class="console-cmd">${cmd}</span>`);
          html.push(`<span class="console-dur">${escHtml(dur)}</span>`);
          html.push('<span class="console-copy" title="Copy to clipboard">⧉</span>');
          html.push('</div>');
          // Detail section (hidden until click)
          const hasStdout = evt.stdout && evt.stdout.trim();
          const hasStderr = evt.stderr && evt.stderr.trim();
          if (hasStdout || hasStderr) {
            html.push('<div class="console-detail">');
            html.push('<button class="console-close-btn" title="Close">✕</button>');
            if (hasStdout) {
              html.push('<div class="console-detail-section">');
              html.push('<div class="console-detail-label">stdout</div>');
              html.push(`<div class="console-detail-content">${escHtml(evt.stdout)}</div>`);
              html.push('</div>');
            }
            if (hasStderr) {
              html.push('<div class="console-detail-section">');
              html.push('<div class="console-detail-label">stderr</div>');
              html.push(`<div class="console-detail-content console-stderr-content">${escHtml(evt.stderr)}</div>`);
              html.push('</div>');
            }
            html.push('</div>');
          }
          html.push('</div>');
        });
      }
      html.push('</div>'); // .console-log
      html.push('</div>'); // .console-view

      // Preserve expanded state before DOM rebuild
      const expandedBefore = new Set();
      container.querySelectorAll('.console-entry.open').forEach(el => {
        expandedBefore.add(el.dataset.idx);
      });

      container.innerHTML = html.join('');

      // Restore expanded state
      expandedBefore.forEach(idx => {
        const el = container.querySelector(`.console-entry[data-idx="${idx}"]`);
        if (el) el.classList.add('open');
      });

      // Expand on header row click, close on X button
      container.querySelectorAll('.console-entry-row').forEach(row => {
        row.addEventListener('click', () => {
          row.parentElement.classList.toggle('open');
        });
        row.style.cursor = 'pointer';
      });
      // Close button
      container.querySelectorAll('.console-close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          btn.closest('.console-entry').classList.remove('open');
        });
      });
      // Prevent clicks inside detail from toggling
      container.querySelectorAll('.console-detail').forEach(detail => {
        detail.addEventListener('click', (e) => e.stopPropagation());
      });
      // Copy button
      container.querySelectorAll('.console-copy').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const entry = btn.closest('.console-entry');
          const idx = entry ? entry.dataset.idx : null;
          const sorted = [...events].reverse();
          const evt = idx != null ? sorted[parseInt(idx)] : null;
          if (!evt) return;
          const text = [evt.command || evt.action, evt.stdout || '', evt.stderr ? 'STDERR:\n' + evt.stderr : ''].filter(Boolean).join('\n\n');
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = '✓'; setTimeout(() => { btn.textContent = '⧉'; }, 1000);
          });
        });
      });

      // Clear button
      const clearBtn = container.querySelector('#console-clear-btn');
      if (clearBtn) {
        clearBtn.onclick = () => {
          consoleState.events = [];
          saveConsoleToStorage([]);
          renderConsole();
        };
      }

      // Newest entries are at top — scroll to top by default
      const logEl = container.querySelector('#console-log');
      if (logEl && !consoleState.scrollLocked) {
        logEl.scrollTop = 0;
      }

      // Track scroll lock
      if (logEl) {
        logEl.onscroll = () => {
          const atTop = logEl.scrollTop < 40;
          consoleState.scrollLocked = !atTop;
        };
      }
    }

    function renderLogsView() {
      const container = document.getElementById('logs-view');
      document.getElementById('monitor-summary').style.display = 'none';
      document.getElementById('repo-header').style.display = 'none';
      document.getElementById('repos').style.display = 'none';
      document.getElementById('empty').style.display = 'none';

      const data = state.data;
      if (!data || !data.repos) { container.innerHTML = '<div class="stats-empty-msg">No data</div>'; return; }

      // Collect all features from allFeatures (falls back to features if allFeatures absent)
      const allRows = [];
      data.repos.forEach(repo => {
        const src = repo.allFeatures || repo.features || [];
        src.forEach(f => allRows.push({ ...f, repoName: repo.name, repoPath: repo.path, repoDisplay: repo.displayPath }));
      });

      // Repo filter
      let rows = logsState.repoFilter === 'all' ? allRows : allRows.filter(r => r.repoPath === logsState.repoFilter);

      // Search filter
      const q = logsState.search.trim().toLowerCase();
      if (q) rows = rows.filter(r => {
        const title = slugToTitle(r.name).toLowerCase();
        return title.includes(q) || (r.name || '').toLowerCase().includes(q) || String(r.id || '').includes(q);
      });

      // Sort
      const { col, dir } = logsState.sort;
      rows = rows.slice().sort((a, b) => {
        let av, bv;
        if (col === 'id') { av = Number(a.id ?? Infinity); bv = Number(b.id ?? Infinity); }
        else if (col === 'name') { av = slugToTitle(a.name).toLowerCase(); bv = slugToTitle(b.name).toLowerCase(); }
        else if (col === 'stage') { av = a.stage || ''; bv = b.stage || ''; }
        else if (col === 'repo') { av = a.repoName || ''; bv = b.repoName || ''; }
        else { av = a[col] || ''; bv = b[col] || ''; } // ISO dates sort lexically
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
      });

      const total = rows.length;
      const totalPages = Math.max(1, Math.ceil(total / logsState.pageSize));
      if (logsState.page >= totalPages) logsState.page = totalPages - 1;
      const pageRows = rows.slice(logsState.page * logsState.pageSize, (logsState.page + 1) * logsState.pageSize);

      function thHtml(key, label) {
        const active = col === key;
        const arrow = active ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
        return `<th class="${active ? 'sort-active' : ''}" data-sort="${key}">${label}${arrow}</th>`;
      }

      function stageHtml(stage) {
        const cls = 'logs-stage stage-' + (stage || 'inbox').replace(/\s+/g, '-');
        return `<span class="${cls}">${escHtml(stage || '')}</span>`;
      }

      const html = [];
      html.push('<div class="logs-toolbar">');
      html.push(`<input class="logs-search" id="logs-search-input" type="search" placeholder="Search features…" value="${escHtml(logsState.search)}">`);
      html.push('<label style="font-size:12px;color:var(--text-secondary)">Repo:</label>');
      html.push('<select class="stats-select" id="logs-repo-filter">');
      html.push(`<option value="all"${logsState.repoFilter === 'all' ? ' selected' : ''}>All repos</option>`);
      data.repos.forEach(r => {
        const sel = logsState.repoFilter === r.path ? ' selected' : '';
        html.push(`<option value="${escHtml(r.path)}"${sel}>${escHtml(r.displayPath)}</option>`);
      });
      html.push('</select>');
      html.push(`<span style="margin-left:auto;font-size:11px;color:var(--text-tertiary)">${total} feature${total !== 1 ? 's' : ''}</span>`);
      html.push('</div>');

      html.push('<div style="overflow-x:auto">');
      html.push('<table class="logs-table">');
      html.push('<thead><tr>');
      html.push(thHtml('id', 'ID'));
      html.push(thHtml('name', 'Name'));
      html.push(thHtml('stage', 'Stage'));
      html.push(thHtml('repo', 'Repo'));
      html.push(thHtml('createdAt', 'Created'));
      html.push(thHtml('updatedAt', 'Last Changed'));
      html.push('<th style="width:70px"></th>');
      html.push('</tr></thead>');
      html.push('<tbody>');
      pageRows.forEach((r, i) => {
        const title = slugToTitle(r.name);
        const idStr = r.id != null ? `#${String(r.id).padStart(2, '0')}` : '—';
        const hasLog = r.logPaths && r.logPaths.length > 0;
        html.push(`<tr class="logs-row" data-idx="${i}">`);
        html.push(`<td class="col-id">${idStr}</td>`);
        html.push(`<td class="col-name">${escHtml(title)}</td>`);
        html.push(`<td>${stageHtml(r.stage)}</td>`);
        html.push(`<td class="col-repo" title="${escHtml(r.repoDisplay || '')}">${escHtml(r.repoName || '—')}</td>`);
        html.push(`<td class="col-date">${logsDateFmt(r.createdAt)}</td>`);
        html.push(`<td class="col-date">${logsDateFmt(r.updatedAt)}</td>`);
        html.push('<td class="col-actions">');
        html.push(`<button class="logs-action-btn logs-btn-spec" data-idx="${i}" data-tooltip="Open spec"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1h6l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/><path d="M10 1v4h4"/><path d="M6 9h4M6 12h2"/></svg></button>`);
        html.push(`<button class="logs-action-btn logs-btn-log${hasLog ? '' : ' logs-btn-hidden'}" data-idx="${i}" data-tooltip="Open log"${hasLog ? '' : ' disabled'}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2h12v12H2z"/><path d="M5 5h6M5 8h6M5 11h3"/></svg></button>`);
        html.push('</td>');
        html.push('</tr>');
      });
      if (pageRows.length === 0) {
        html.push(`<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:20px 0">${q ? 'No features match your search.' : 'No features found.'}</td></tr>`);
      }
      html.push('</tbody></table></div>');

      // Pagination
      html.push('<div class="logs-pagination">');
      html.push(`<button class="logs-page-btn" id="logs-prev"${logsState.page === 0 ? ' disabled' : ''}>← Prev</button>`);
      html.push(`<span class="logs-page-info">${logsState.page + 1} / ${totalPages}</span>`);
      html.push(`<button class="logs-page-btn" id="logs-next"${logsState.page >= totalPages - 1 ? ' disabled' : ''}>Next →</button>`);
      html.push('</div>');

      container.innerHTML = html.join('');

      // Wire up sort headers
      container.querySelectorAll('th[data-sort]').forEach(th => {
        th.onclick = () => {
          const key = th.getAttribute('data-sort');
          if (logsState.sort.col === key) {
            logsState.sort.dir = logsState.sort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            logsState.sort.col = key;
            logsState.sort.dir = key === 'updatedAt' || key === 'createdAt' ? 'desc' : 'asc';
          }
          logsState.page = 0;
          renderLogsView();
        };
      });

      // Wire up row hover
      container.querySelectorAll('.logs-row').forEach(row => {
        row.onmouseenter = () => row.style.background = 'var(--bg-surface)';
        row.onmouseleave = () => row.style.background = '';
      });

      // Wire up spec buttons
      container.querySelectorAll('.logs-btn-spec').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const r = pageRows[Number(btn.dataset.idx)];
          if (r && r.specPath) openDrawer(r.specPath, slugToTitle(r.name), r.stage);
        };
      });

      // Wire up log buttons
      container.querySelectorAll('.logs-btn-log').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const r = pageRows[Number(btn.dataset.idx)];
          if (r && r.logPaths && r.logPaths.length > 0) {
            openDrawer(r.logPaths[0], slugToTitle(r.name) + ' — Log', r.stage);
          }
        };
      });

      // Wire up repo filter
      const repoFilter = document.getElementById('logs-repo-filter');
      if (repoFilter) repoFilter.onchange = () => { logsState.repoFilter = repoFilter.value; logsState.page = 0; renderLogsView(); };

      // Wire up search
      const searchInput = document.getElementById('logs-search-input');
      if (searchInput) {
        searchInput.oninput = () => { logsState.search = searchInput.value; logsState.page = 0; renderLogsView(); };
      }

      // Wire up pagination
      const prevBtn = document.getElementById('logs-prev');
      const nextBtn = document.getElementById('logs-next');
      if (prevBtn) prevBtn.onclick = () => { logsState.page--; renderLogsView(); };
      if (nextBtn) nextBtn.onclick = () => { logsState.page++; renderLogsView(); };
    }

    const FEAT_LIST_PAGE_SIZE = 20;

    function renderFeatureList() {
      const el = document.getElementById('stats-feature-list');
      if (!el) return;
      const features = statsState.filteredFeatures || [];
      const total = features.length;
      const page = statsState.featureListPage;
      const totalPages = Math.max(1, Math.ceil(total / FEAT_LIST_PAGE_SIZE));
      const start = page * FEAT_LIST_PAGE_SIZE;
      const slice = features.slice(start, start + FEAT_LIST_PAGE_SIZE);

      if (total === 0) {
        el.innerHTML = '<div style="color:var(--text-tertiary);font-size:12px;padding:12px 0">No features in this period.</div>';
        return;
      }

      const rows = slice.map(f => {
        const repo = f.repoPath ? f.repoPath.split('/').pop() : '—';
        const date = f.completedAt ? f.completedAt.slice(0, 10) : '—';
        const ctHours = f.durationMs ? Math.round(f.durationMs / 3600000 * 10) / 10 : null;
        const ctClass = ctHours !== null && ctHours > 48 ? ' class="fl-ct-high"' : '';
        const ctStr = ctHours !== null ? ctHours + 'h' : '—';
        const excludeBadge = f.cycleTimeExclude ? '<span class="feat-exclude-badge">excluded</span>' : '';
        const desc = escHtml(f.desc || '');
        return `<tr>
          <td>${escHtml(date)}</td>
          <td>${escHtml(repo)}</td>
          <td class="fl-num">${escHtml(String(f.featureNum || ''))}</td>
          <td class="fl-desc" title="${desc}">${desc}${excludeBadge}</td>
          <td>${escHtml(f.winnerAgent || '—')}</td>
          <td${ctClass}>${ctStr}</td>
        </tr>`;
      }).join('');

      const pagination = totalPages > 1 ? `
        <div class="feat-list-pagination">
          <button class="vol-nav-btn" id="fl-prev" ${page === 0 ? 'disabled' : ''}>&#8592;</button>
          <span>Page ${page + 1} of ${totalPages} &nbsp;·&nbsp; ${total} features</span>
          <button class="vol-nav-btn" id="fl-next" ${page >= totalPages - 1 ? 'disabled' : ''}>&#8594;</button>
        </div>` : `<div class="feat-list-pagination">${total} features</div>`;

      el.innerHTML = `
        <table class="feat-list-table">
          <thead><tr><th>Date</th><th>Repo</th><th>#</th><th>Feature</th><th>Agent</th><th>Cycle Time</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${pagination}`;

      document.getElementById('fl-prev')?.addEventListener('click', () => {
        statsState.featureListPage = Math.max(0, page - 1);
        renderFeatureList();
      });
      document.getElementById('fl-next')?.addEventListener('click', () => {
        statsState.featureListPage = Math.min(totalPages - 1, page + 1);
        renderFeatureList();
      });
    }

    async function renderStatistics() {
      const container = document.getElementById('statistics-view');
      document.getElementById('monitor-summary').style.display = 'none';
      document.getElementById('repo-header').style.display = 'none';
      document.getElementById('repos').style.display = 'none';
      document.getElementById('empty').style.display = 'none';

      if (!statsState.data) {
        container.innerHTML = '<div class="stats-empty-msg">Loading statistics…</div>';
        await loadAnalytics();
      }

      const analytics = statsState.data;

      if (!analytics || statsState.error) {
        container.innerHTML = `<div class="stats-empty-msg">${escHtml(statsState.error || 'Could not load analytics')}</div>`;
        return;
      }

      // Build repo list for filter
      const repoSet = new Set((analytics.features || []).map(f => f.repoPath).filter(Boolean));
      const repos = [...repoSet];

      const html = [];
      html.push('<div class="stats-view">');

      // Toolbar
      html.push('<div class="stats-toolbar">');
      html.push('<label style="font-size:12px;color:var(--text-secondary)">Repo:</label>');
      html.push('<select class="stats-select" id="stats-repo-filter">');
      html.push(`<option value="all"${statsState.repoFilter === 'all' ? ' selected' : ''}>All repos</option>`);
      repos.forEach(r => {
        const display = r.replace(/^\/Users\/[^/]+\//, '~/');
        const sel = statsState.repoFilter === r ? ' selected' : '';
        html.push(`<option value="${escHtml(r)}"${sel}>${escHtml(display)}</option>`);
      });
      html.push('</select>');
      html.push('<label style="font-size:12px;color:var(--text-secondary)">Period:</label>');
      html.push('<select class="stats-select" id="stats-period-filter">');
      [['7d','Last 7 days'],['30d','Last 30 days'],['90d','Last 90 days'],['all','All time']].forEach(([v,l]) => {
        html.push(`<option value="${v}"${statsState.period === v ? ' selected' : ''}>${l}</option>`);
      });
      html.push('</select>');
      html.push('<button class="btn" id="stats-refresh-btn" style="margin-left:auto">Refresh</button>');
      html.push('</div>');

      // Filter features for the selected period + repo
      const filteredFeatures = filterFeaturesByPeriodAndRepo(analytics.features || [], statsState.period, statsState.repoFilter);
      const totalCompleted = filteredFeatures.length;
      const featWithDur = filteredFeatures.filter(f => f.durationMs && f.durationMs > 0 && !f.cycleTimeExclude);
      const durHoursSorted = featWithDur.map(f => f.durationMs / 3600000).sort((a, b) => a - b);
      const ctMid = Math.floor(durHoursSorted.length / 2);
      const medianCycle = durHoursSorted.length > 0
        ? (durHoursSorted.length % 2 ? durHoursSorted[ctMid] : (durHoursSorted[ctMid - 1] + durHoursSorted[ctMid]) / 2)
        : null;
      const avgCycle = featWithDur.length > 0
        ? featWithDur.reduce((s, f) => s + f.durationMs, 0) / featWithDur.length / (1000 * 3600) : null;
      const firstPassFeats = filteredFeatures.filter(f => f.firstPassSuccess !== null);
      const firstPassRate = firstPassFeats.length > 0
        ? firstPassFeats.filter(f => f.firstPassSuccess).length / firstPassFeats.length : null;
      // Volume cards
      html.push('<div class="stats-section-title">Volume</div>');
      html.push('<div class="stats-cards">');
      const trend30 = analytics.volume && analytics.volume.trend30d;
      html.push(buildStatCard('Features Completed', String(totalCompleted),
        statsState.period === '30d' && trend30 !== null ? trendIcon(trend30) : null));
      html.push(buildStatCard('Cycle Time', fmtHours(medianCycle), null, medianCycle !== null ? 'median, start to close' : null,
        'Median wall-clock time from feature-setup to feature-close. Lower is better.'));
      html.push(buildStatCard('First-Pass Rate', fmtPct(firstPassRate), null, null,
        'Percentage of features that passed evaluation on the first attempt without needing rework.'));
      html.push('</div>');

      // Volume trend line chart
      html.push('<div class="volume-chart-wrap">');
      html.push('<div class="volume-chart-header">');
      html.push('<div class="volume-chart-title">Features Completed Over Time</div>');
      html.push('<div style="display:flex;align-items:center;gap:8px">');
      html.push('<span id="vol-nav-controls" style="display:flex;align-items:center;gap:4px">');
      html.push('<button id="vol-nav-prev" class="vol-nav-btn" title="Earlier">&#8592;</button>');
      html.push('<span id="vol-nav-range" style="font-size:11px;color:var(--text-tertiary);min-width:140px;text-align:center"></span>');
      html.push('<button id="vol-nav-next" class="vol-nav-btn" title="Later">&#8594;</button>');
      html.push('</span>');
      html.push('<div class="volume-granularity-btns" style="margin-left:8px">');
      [['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']].forEach(([g,l]) => {
        const active = statsState.volumeGranularity === g ? ' active' : '';
        html.push(`<button class="vol-gran-btn${active}" data-gran="${g}">${l}</button>`);
      });
      html.push('</div>');
      html.push('</div>');
      html.push('</div>');
      html.push('<div style="height:220px;position:relative"><canvas id="volume-chart-canvas"></canvas></div>');
      html.push('</div>');

      // Quality block
      html.push('<div class="stats-row">');
      const quality = analytics.quality || {};
      const dur = quality.durationHours || {};
      html.push('<div class="stats-block">');
      html.push('<div class="stats-block-title">Quality &amp; Speed</div>');
      html.push('<div class="stats-kv-grid">');
      html.push(`<div class="stats-kv"><div class="stats-kv-label">Cycle time (median)</div><div class="stats-kv-val">${fmtHours(medianCycle !== null ? medianCycle : dur.median)}</div></div>`);
      html.push(`<div class="stats-kv"><div class="stats-kv-label">Cycle time (mean)</div><div class="stats-kv-val">${fmtHours(avgCycle !== null ? avgCycle : dur.average)}</div></div>`);
      html.push(`<div class="stats-kv"><div class="stats-kv-label">Max cycle time</div><div class="stats-kv-val">${fmtHours(dur.max)}</div></div>`);
      html.push(`<div class="stats-kv"><div class="stats-kv-label">${buildKvLabel('Avg iterations', 'Average number of implement-evaluate cycles per feature before it passes review. 1.0 means every feature passes on the first try.')}</div><div class="stats-kv-val">${fmtNum(quality.avgIterationsPerFeature, 1)}</div></div>`);
      html.push('</div>');
      html.push('</div>');
      html.push('</div>'); // end stats-row

      // Cycle time over time chart
      html.push('<div class="volume-chart-wrap">');
      html.push('<div class="volume-chart-header">');
      html.push('<div class="volume-chart-title">Median Cycle Time Over Time</div>');
      html.push('<div style="display:flex;align-items:center;gap:8px">');
      html.push('<span id="ct-nav-controls" style="display:flex;align-items:center;gap:4px">');
      html.push('<button id="ct-nav-prev" class="vol-nav-btn" title="Earlier">&#8592;</button>');
      html.push('<span id="ct-nav-range" style="font-size:11px;color:var(--text-tertiary);min-width:140px;text-align:center"></span>');
      html.push('<button id="ct-nav-next" class="vol-nav-btn" title="Later">&#8594;</button>');
      html.push('</span>');
      html.push('<div class="volume-granularity-btns" style="margin-left:8px">');
      [['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']].forEach(([g,l]) => {
        const active = statsState.volumeGranularity === g ? ' active' : '';
        html.push(`<button class="vol-gran-btn${active}" data-gran="${g}">${l}</button>`);
      });
      html.push('</div>');
      html.push('</div>');
      html.push('</div>');
      html.push('<div style="height:220px;position:relative"><canvas id="cycle-time-chart-canvas"></canvas></div>');
      html.push('</div>');

      // Agent leaderboard — computed from filteredFeatures so repo+period filters apply
      const round1 = v => Math.round(v * 10) / 10;
      const leaderAgentMap = {};
      filteredFeatures.forEach(f => {
        const ag = f.winnerAgent || 'solo';
        if (!leaderAgentMap[ag]) leaderAgentMap[ag] = { completed: 0, durMs: [], firstPassArr: [] };
        leaderAgentMap[ag].completed++;
        if (f.durationMs && f.durationMs > 0 && !f.cycleTimeExclude) leaderAgentMap[ag].durMs.push(f.durationMs);
        if (f.firstPassSuccess !== null) leaderAgentMap[ag].firstPassArr.push(f.firstPassSuccess);
      });

      // Filter eval wins by repo
      const evalWinsByRepo = analytics.evalWinsByRepo || [];
      const filteredEvalWins = statsState.repoFilter === 'all'
        ? analytics.evalWins || []
        : (() => {
            const repoEntries = evalWinsByRepo.filter(e => e.repoPath === statsState.repoFilter);
            const agg = {};
            repoEntries.forEach(e => {
              if (!agg[e.agent]) agg[e.agent] = { agent: e.agent, wins: 0, evals: 0 };
              agg[e.agent].wins += e.wins;
              agg[e.agent].evals += e.evals;
            });
            return Object.values(agg).map(e => ({
              ...e, winRate: e.evals > 0 ? Math.round(e.wins / e.evals * 100) / 100 : 0
            }));
          })();

      const evalMap = {};
      filteredEvalWins.forEach(e => { evalMap[e.agent] = e; });
      const totalEvalWins = filteredEvalWins.reduce((s, e) => s + e.wins, 0);

      const allAgentIds = [...new Set([...Object.keys(leaderAgentMap), ...filteredEvalWins.map(e => e.agent)])];

      if (allAgentIds.length > 0) {
        html.push('<div class="stats-section-title" style="margin-top:4px">Agent Leaderboard</div>');
        html.push('<div class="stats-block" style="overflow-x:auto">');
        html.push('<table class="stats-leaderboard">');
        html.push('<thead><tr><th>Agent</th><th>Features</th><th>Eval wins</th><th>Fleet win %</th><th>Cycle time</th><th>First-pass</th></tr></thead>');
        html.push('<tbody>');

        allAgentIds
          .sort((a, b) => (leaderAgentMap[b] || { completed: 0 }).completed - (leaderAgentMap[a] || { completed: 0 }).completed)
          .forEach(agentId => {
            const d = leaderAgentMap[agentId] || { completed: 0, durMs: [], firstPassArr: [] };
            const ev = evalMap[agentId];
            const sortedDur = d.durMs.slice().sort((a, b) => a - b);
            const ldrMid = Math.floor(sortedDur.length / 2);
            const avgCycle = sortedDur.length > 0
              ? round1(sortedDur.length % 2 ? sortedDur[ldrMid] / 3600000 : (sortedDur[ldrMid - 1] + sortedDur[ldrMid]) / 2 / 3600000)
              : null;
            const fpRate = d.firstPassArr.length > 0 ? d.firstPassArr.filter(Boolean).length / d.firstPassArr.length : null;
            // Share of total eval wins (sums to 100% across agents)
            const winShare = ev && totalEvalWins > 0 ? ev.wins / totalEvalWins : null;
            html.push('<tr>');
            html.push(`<td><span class="agent-mono">${escHtml(agentId)}</span></td>`);
            html.push(`<td>${d.completed}</td>`);
            html.push(`<td>${ev ? ev.wins : '—'}</td>`);
            html.push(`<td>${winShare !== null ? `<span class="win-rate">${fmtPct(winShare)}</span>` : '—'}</td>`);
            html.push(`<td>${fmtHours(avgCycle)}</td>`);
            html.push(`<td>${fmtPct(fpRate)}</td>`);
            html.push('</tr>');
          });
        html.push('</tbody></table>');
        html.push('</div>');
      }

      if (totalCompleted === 0 && allAgentIds.length === 0) {
        html.push('<div class="stats-empty-msg">No completed features found. Statistics will appear here once features are closed.</div>');
      }

      // Feature list section (populated after render via renderFeatureList)
      html.push('<div class="stats-section-title" style="margin-top:4px">Features</div>');
      html.push('<div class="stats-block" style="overflow-x:auto"><div id="stats-feature-list"></div></div>');

      html.push('</div>'); // end stats-view

      // Store filtered features for pagination (avoids re-rendering charts on page change)
      statsState.filteredFeatures = filteredFeatures.slice().sort((a, b) => {
        const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return tb - ta;
      });

      container.innerHTML = html.join('');

      // Render Chart.js charts into canvases now that they're in the DOM
      const volSeries = buildVolumeSeries(filteredFeatures, statsState.volumeGranularity);
      renderVolumeChart(volSeries, statsState.volumeGranularity);

      const ctSeries = buildCycleTimeSeries(filteredFeatures, statsState.volumeGranularity);
      renderCycleTimeChart(ctSeries, statsState.volumeGranularity);

      // Wire up controls
      const repoSel = document.getElementById('stats-repo-filter');
      if (repoSel) repoSel.onchange = () => {
        statsState.repoFilter = repoSel.value;
        statsState.volumeWindowEnd = null;
        statsState.cycleTimeWindowEnd = null;
        statsState.featureListPage = 0;
        saveStatsPrefs();
        renderStatistics();
      };

      const periodSel = document.getElementById('stats-period-filter');
      if (periodSel) periodSel.onchange = () => {
        statsState.period = periodSel.value;
        statsState.volumeWindowEnd = null;
        statsState.cycleTimeWindowEnd = null;
        statsState.featureListPage = 0;
        saveStatsPrefs();
        renderStatistics();
      };

      const refreshBtn = document.getElementById('stats-refresh-btn');
      if (refreshBtn) refreshBtn.onclick = async () => {
        statsState.data = null;
        container.innerHTML = '<div class="stats-empty-msg">Loading…</div>';
        // force=1 busts the server-side analytics cache (picks up backfill changes)
        try {
          const res = await fetch('/api/analytics?force=1', { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          statsState.data = await res.json();
          statsState.error = null;
        } catch (e) {
          statsState.error = e.message;
        }
        statsState.loading = false;
        renderStatistics();
      };

      // Volume granularity buttons — reset both windows on change
      document.querySelectorAll('.vol-gran-btn').forEach(btn => {
        btn.onclick = () => {
          statsState.volumeGranularity = btn.dataset.gran;
          statsState.volumeWindowEnd = null;
          statsState.cycleTimeWindowEnd = null;
          saveStatsPrefs();
          renderStatistics();
        };
      });

      // Volume nav buttons
      document.getElementById('vol-nav-prev')?.addEventListener('click', () => panVolumeChart('prev'));
      document.getElementById('vol-nav-next')?.addEventListener('click', () => panVolumeChart('next'));

      // Cycle time nav buttons
      document.getElementById('ct-nav-prev')?.addEventListener('click', () => panCycleTimeChart('prev'));
      document.getElementById('ct-nav-next')?.addEventListener('click', () => panCycleTimeChart('next'));

      // Feature list
      renderFeatureList();
    }
