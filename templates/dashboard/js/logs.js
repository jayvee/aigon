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
      document.getElementById('settings-view').style.display = 'none';
      document.getElementById('config-view').style.display = 'none';
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

    async function loadInsights(refresh) {
      if (statsState.insightsLoading) return;
      statsState.insightsLoading = true;
      statsState.insightsError = null;
      try {
        const endpoint = refresh ? '/api/insights/refresh' : '/api/insights';
        const method = refresh ? 'POST' : 'GET';
        const repoPath = state.selectedRepo && state.selectedRepo !== 'all' ? state.selectedRepo : '';
        const url = refresh ? endpoint : (repoPath ? endpoint + '?repoPath=' + encodeURIComponent(repoPath) : endpoint);
        const fetchOptions = refresh
          ? {
              method,
              cache: 'no-store',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ repoPath: repoPath || null })
            }
          : { method, cache: 'no-store' };
        const res = await fetch(url, fetchOptions);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        statsState.insightsData = await res.json();
      } catch (e) {
        statsState.insightsError = e.message;
      } finally {
        statsState.insightsLoading = false;
      }
    }

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
        const featureKey = `${f.repoPath || ''}:${String(f.featureNum || '').padStart(2, '0')}`;
        const commitStats = statsState.featureCommitMap[featureKey] || { count: 0, linesChanged: 0 };
        const tokStr = f.billableTokens ? Number(f.billableTokens).toLocaleString() : '—';
        return `<tr>
          <td>${escHtml(date)}</td>
          <td>${escHtml(repo)}</td>
          <td class="fl-num">${escHtml(String(f.featureNum || ''))}</td>
          <td class="fl-desc" title="${desc}">${desc}${excludeBadge}</td>
          <td>${escHtml(f.winnerAgent || '—')}</td>
          <td${ctClass}>${ctStr}</td>
          <td>${escHtml(String(commitStats.count || 0))}</td>
          <td>${escHtml(String(commitStats.linesChanged || 0))}</td>
          <td>${tokStr}</td>
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
          <thead><tr><th>Date</th><th>Repo</th><th>#</th><th>Feature</th><th>Agent</th><th>Cycle Time</th><th>Commits</th><th>Δ Lines</th><th>Tokens</th></tr></thead>
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

    function fmtUsd(v) {
      if (v === null || v === undefined) return '—';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);
    }

    function fmtMetric(v, decimals) {
      if (v === null || v === undefined) return '—';
      return Number(v).toFixed(decimals);
    }

    function buildDailyMetricTrend(features, metricKey, days) {
      const since = Date.now() - days * 86400000;
      const buckets = {};
      features.forEach(f => {
        const completedTs = f.completedAt ? new Date(f.completedAt).getTime() : null;
        if (!completedTs || completedTs < since) return;
        const value = f[metricKey];
        if (value === null || value === undefined) return;
        const day = new Date(completedTs).toISOString().slice(0, 10);
        if (!buckets[day]) buckets[day] = { sum: 0, count: 0 };
        buckets[day].sum += value;
        buckets[day].count += 1;
      });
      return Object.keys(buckets).sort().map(day => ({
        day,
        score: buckets[day].count > 0 ? buckets[day].sum / buckets[day].count : 0
      }));
    }

    function deriveAutonomyLabel(ratio) {
      if (ratio === null || ratio === undefined) return { label: null, cls: '' };
      if (ratio >= 0.95) return { label: 'Full Autonomy', cls: 'autonomy-good' };
      if (ratio >= 0.80) return { label: 'Light Touch', cls: 'autonomy-good' };
      if (ratio >= 0.60) return { label: 'Guided', cls: 'autonomy-mid' };
      if (ratio >= 0.30) return { label: 'Collaborative', cls: 'autonomy-collab' };
      return { label: 'Thrashing', cls: 'autonomy-risk' };
    }

    function buildWeeklyFirstPassTrend(features) {
      const buckets = {};
      features.forEach(f => {
        if (f.firstPassSuccess === null || f.firstPassSuccess === undefined) return;
        const ts = f.completedAt ? new Date(f.completedAt) : null;
        if (!ts || isNaN(ts)) return;
        const d = new Date(ts);
        const dow = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() - dow + 1);
        const key = d.toISOString().slice(0, 10);
        if (!buckets[key]) buckets[key] = { pass: 0, total: 0 };
        buckets[key].total++;
        if (f.firstPassSuccess) buckets[key].pass++;
      });
      return Object.keys(buckets).sort().map(week => ({
        day: week,
        score: buckets[week].total > 0 ? buckets[week].pass / buckets[week].total : 0
      }));
    }

    function getAutonomyClass(label) {
      const normalized = String(label || '').toLowerCase();
      if (normalized.includes('full autonomy') || normalized.includes('light touch')) return 'autonomy-good';
      if (normalized.includes('guided')) return 'autonomy-mid';
      if (normalized.includes('collaborative')) return 'autonomy-collab';
      if (normalized.includes('thrashing')) return 'autonomy-risk';
      return '';
    }

    function buildReworkBadges(feature) {
      const tags = [];
      if (feature.reworkThrashing === true) tags.push('<span class="amp-rework-tag rework-risk">Thrashing</span>');
      if (feature.reworkFixCascade === true) tags.push('<span class="amp-rework-tag rework-warn">Fix cascade</span>');
      if (feature.reworkScopeCreep === true) tags.push('<span class="amp-rework-tag rework-warn">Scope creep</span>');
      if (tags.length === 0) return '<span class="amp-no-rework">No rework flags</span>';
      return tags.join('');
    }

    function buildAmplificationSection(filteredFeatures) {
      const analytics = statsState.data || {};
      const withAade = filteredFeatures.filter(f => f.hasAadeData);
      const withCost = filteredFeatures.filter(f => f.costUsd !== null && f.costUsd !== undefined);
      const withTpl = filteredFeatures.filter(f => f.tokensPerLineChanged !== null && f.tokensPerLineChanged !== undefined);
      const withReworkSignals = filteredFeatures.filter(f => f.firstPassNoRework !== null && f.firstPassNoRework !== undefined);
      const firstPassNoRework = withReworkSignals.length > 0
        ? withReworkSignals.filter(f => f.firstPassNoRework).length / withReworkSignals.length
        : null;
      const reworkRate = withReworkSignals.length > 0
        ? withReworkSignals.filter(f => f.hasReworkFlags).length / withReworkSignals.length
        : null;

      // Autonomy score from filtered features
      const withAutonomy = filteredFeatures.filter(f => f.autonomyRatio !== null && f.autonomyRatio !== undefined);
      const autonomyScore = withAutonomy.length > 0
        ? withAutonomy.reduce((s, f) => s + f.autonomyRatio, 0) / withAutonomy.length
        : null;
      const autonomyDerived = deriveAutonomyLabel(autonomyScore);

      // Sparkline trends
      const costTrend7d = buildDailyMetricTrend(filteredFeatures, 'costUsd', 7);
      const costTrend30d = buildDailyMetricTrend(filteredFeatures, 'costUsd', 30);
      const tplTrend7d = buildDailyMetricTrend(filteredFeatures, 'tokensPerLineChanged', 7);
      const tplTrend30d = buildDailyMetricTrend(filteredFeatures, 'tokensPerLineChanged', 30);
      const costSpark7 = buildSparklineSvg(costTrend7d, '#f59e0b') || '<div class="amp-spark-empty">No data</div>';
      const costSpark30 = buildSparklineSvg(costTrend30d, '#f97316') || '<div class="amp-spark-empty">No data</div>';
      const tplSpark7 = buildSparklineSvg(tplTrend7d, '#22c55e') || '<div class="amp-spark-empty">No data</div>';
      const tplSpark30 = buildSparklineSvg(tplTrend30d, '#16a34a') || '<div class="amp-spark-empty">No data</div>';

      // Autonomy trend sparkline (from server-computed weekly trend)
      const autonomyTrend = (analytics.autonomy && analytics.autonomy.trend) || [];
      const autonomySpark = buildSparklineSvg(autonomyTrend, '#3b82f6') || '<div class="amp-spark-empty">No data</div>';

      // First-pass rate trend (weekly, computed from filtered features)
      const fpTrend = buildWeeklyFirstPassTrend(filteredFeatures);
      const fpSpark = buildSparklineSvg(fpTrend, '#22c55e') || '<div class="amp-spark-empty">No data</div>';

      // Autonomy score display with derived label pill
      const autonomyScoreDisplay = autonomyScore !== null ? fmtPct(autonomyScore) : '—';
      const autonomyLabelHtml = autonomyDerived.label
        ? `<span class="amp-autonomy-pill ${autonomyDerived.cls}" style="font-size:10px">${escHtml(autonomyDerived.label)}</span>`
        : '';

      const withTokens = filteredFeatures.filter(f => f.billableTokens !== null && f.billableTokens !== undefined && f.billableTokens > 0);
      const medianTokensPerFeature = (() => {
        if (withTokens.length === 0) return null;
        const sorted = withTokens.map(f => f.billableTokens).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
      })();

      return `
        <details class="stats-block amplification-section" open>
          <summary class="amplification-summary">
            <span>Amplification</span>
            <span class="amplification-count">${withAade.length} features with amplification data</span>
          </summary>
          <div class="amplification-body">
            <div class="stats-cards amp-top-cards">
              ${buildStatCard('First-Pass Rate (No Rework)', fmtPct(firstPassNoRework), null, withReworkSignals.length > 0 ? `${withReworkSignals.length} features` : 'No rework signal data',
                'Percentage of features completed without triggering any rework flags. Rework flags include: thrashing (repeated back-and-forth edits), fix cascades (one fix causing another), and scope creep (implementation exceeding spec). Higher is better — it means the agent got it right the first time.')}
              ${buildStatCard('Rework Rate', fmtPct(reworkRate), null, withReworkSignals.length > 0 ? `${withReworkSignals.length} features` : 'No rework signal data',
                'Percentage of features that triggered at least one rework flag (thrashing, fix cascade, or scope creep). This is the inverse of First-Pass Rate. Lower is better — high rework suggests specs need more detail or features should be scoped smaller.')}
              ${buildStatCard('Median Cost / Feature', (() => {
                if (withCost.length === 0) return '—';
                const sorted = withCost.map(f => f.costUsd).sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return fmtUsd(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
              })(), null,
                withCost.length > 0 ? `${withCost.length} features with cost data` : 'Awaiting telemetry adapters',
                'Median AI compute cost per feature at API list prices. Uses median instead of average to avoid skew from multi-session outliers. For plan/subscription users this is indicative only — your actual cost depends on your plan.')}
              ${buildStatCard('Median Tokens / Feature', medianTokensPerFeature !== null ? medianTokensPerFeature.toLocaleString() : '—', null,
                withTokens.length > 0 ? `${withTokens.length} features with token data` : 'Awaiting telemetry adapters',
                'Median billable tokens (input + output + thinking) consumed per feature. Uses median instead of average to avoid skew from multi-session outliers. Features with zero tokens are excluded.')}
            </div>
            <div class="stats-row amp-trend-row">
              <div class="stats-block">
                <div class="stats-block-title">First-Pass Rate Trend</div>
                <div class="amp-spark-grid">
                  <div class="amp-spark-card">
                    <div class="amp-spark-title">Weekly</div>
                    <div class="sparkline-wrap amp-spark-wrap">${fpSpark}</div>
                  </div>
                </div>
              </div>
              <div class="stats-block">
                <div class="stats-block-title">Cost per Feature Trend</div>
                <div class="amp-spark-grid">
                  <div class="amp-spark-card">
                    <div class="amp-spark-title">7d</div>
                    <div class="sparkline-wrap amp-spark-wrap">${costSpark7}</div>
                  </div>
                  <div class="amp-spark-card">
                    <div class="amp-spark-title">30d</div>
                    <div class="sparkline-wrap amp-spark-wrap">${costSpark30}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          ${(() => {
            const withBillableTokens = filteredFeatures.filter(f => f.billableTokens != null && f.billableTokens > 0);
            if (withBillableTokens.length < 2) return '';
            const tokenVals = withBillableTokens.map(f => f.billableTokens).sort((a, b) => a - b);
            const tokenSum = tokenVals.reduce((s, v) => s + v, 0);
            const tokenMean = Math.round(tokenSum / tokenVals.length);
            const tokenMid = Math.floor(tokenVals.length / 2);
            const tokenMedian = tokenVals.length % 2 ? tokenVals[tokenMid] : Math.round((tokenVals[tokenMid - 1] + tokenVals[tokenMid]) / 2);
            const tokenP90 = tokenVals[Math.floor(tokenVals.length * 0.9)];
            const tokenMax = tokenVals[tokenVals.length - 1];

            // Top consumers
            const topFeatures = withBillableTokens.slice().sort((a, b) => b.billableTokens - a.billableTokens).slice(0, 8);
            const topRows = topFeatures.map(f => {
              const pct = Math.round(f.billableTokens / tokenSum * 100);
              return '<tr>' +
                '<td>' + escHtml(String(f.featureNum || '')) + '</td>' +
                '<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(f.desc || '') + '">' + escHtml(f.desc || '') + '</td>' +
                '<td>' + escHtml(f.winnerAgent || '—') + '</td>' +
                '<td>' + f.billableTokens.toLocaleString() + ' <span style="color:var(--text-tertiary)">(' + pct + '%)</span></td>' +
                '<td>' + fmtUsd(f.costUsd) + '</td>' +
                '</tr>';
            }).join('');

            // Store data for Chart.js init after DOM render
            window._ampTokenChartData = { withBillableTokens, tokenVals, tokenMedian };

            return '<div class="stats-section-title" style="margin-top:16px">Token Analytics</div>' +
              '<div class="stats-cards amp-top-cards">' +
                buildStatCard('Mean', tokenMean.toLocaleString(), null, withBillableTokens.length + ' features', 'Average billable tokens per feature. Compare with median to see skew.') +
                buildStatCard('Median', tokenMedian.toLocaleString(), null, 'typical feature', 'Half of features use fewer tokens than this.') +
                buildStatCard('P90', tokenP90.toLocaleString(), null, '90th percentile', '90% of features use fewer tokens than this.') +
                buildStatCard('Max', tokenMax.toLocaleString(), null, 'single feature', 'Highest token spend in this period.') +
              '</div>' +
              '<div class="stats-row" style="gap:16px">' +
                '<div class="stats-block" style="flex:1.2"><div class="stats-block-title">Token Distribution</div>' +
                  '<div style="position:relative;height:240px"><canvas id="amp-token-histogram"></canvas></div></div>' +
                '<div class="stats-block" style="flex:1"><div class="stats-block-title">Tokens per Feature Over Time</div>' +
                  '<div style="position:relative;height:240px"><canvas id="amp-token-timeline"></canvas></div></div>' +
              '</div>' +
              '<div class="stats-block"><div class="stats-block-title">Top Token Consumers</div>' +
                '<table class="feat-list-table" style="font-size:12px"><thead><tr><th>#</th><th>Feature</th><th>Agent</th><th>Tokens</th><th>Cost</th></tr></thead>' +
                '<tbody>' + topRows + '</tbody></table></div>';
          })()}
        </details>
      `;
    }

    function initAmpTokenCharts() {
      const data = window._ampTokenChartData;
      if (!data || typeof Chart === 'undefined') return;
      const { withBillableTokens, tokenVals, tokenMedian } = data;

      // Histogram
      const histCanvas = document.getElementById('amp-token-histogram');
      if (histCanvas) {
        const edges = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, Infinity];
        const labels = ['<1K', '1-5K', '5-10K', '10-25K', '25-50K', '50-100K', '100-250K', '250-500K', '500K-1M', '1-2.5M', '2.5-5M', '5M+'];
        const counts = new Array(labels.length).fill(0);
        tokenVals.forEach(v => { for (let i = 0; i < edges.length - 1; i++) { if (v >= edges[i] && v < edges[i + 1]) { counts[i]++; break; } } });
        const first = counts.findIndex(c => c > 0);
        const last = counts.length - 1 - [...counts].reverse().findIndex(c => c > 0);
        const s = Math.max(0, first), e = Math.min(counts.length, last + 2);
        new Chart(histCanvas, {
          type: 'bar',
          data: {
            labels: labels.slice(s, e),
            datasets: [{ data: counts.slice(s, e),
              backgroundColor: edges.slice(s, e).map(v => v >= 1000000 ? 'rgba(239,68,68,0.7)' : v >= 100000 ? 'rgba(245,158,11,0.7)' : 'rgba(34,197,94,0.7)'),
              borderColor: edges.slice(s, e).map(v => v >= 1000000 ? 'rgb(239,68,68)' : v >= 100000 ? 'rgb(245,158,11)' : 'rgb(34,197,94)'),
              borderWidth: 1 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.raw + ' feature' + (ctx.raw !== 1 ? 's' : '') } } },
            scales: { x: { ticks: { color: '#999', font: { size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#999', stepSize: 1, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } } }
          }
        });
      }

      // Timeline scatter
      const timeCanvas = document.getElementById('amp-token-timeline');
      if (timeCanvas) {
        const pts = withBillableTokens.filter(f => f.completedAt).map(f => ({ x: new Date(f.completedAt).getTime(), y: f.billableTokens, label: '#' + f.featureNum + ' ' + f.desc })).sort((a, b) => a.x - b.x);
        if (pts.length > 0) {
          new Chart(timeCanvas, {
            type: 'scatter',
            data: {
              datasets: [
                { data: pts, backgroundColor: pts.map(p => p.y >= 1000000 ? 'rgba(239,68,68,0.8)' : p.y >= 100000 ? 'rgba(245,158,11,0.8)' : 'rgba(34,197,94,0.8)'), pointRadius: 5, pointHoverRadius: 7 },
                { type: 'line', data: [{ x: pts[0].x, y: tokenMedian }, { x: pts[pts.length - 1].x, y: tokenMedian }], borderColor: 'rgba(99,102,241,0.6)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false }
              ]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.datasetIndex === 1 ? 'Median: ' + tokenMedian.toLocaleString() : ctx.raw.label + ': ' + ctx.raw.y.toLocaleString() + ' tokens' } } },
              scales: {
                x: { type: 'time', time: { unit: 'day', tooltipFormat: 'MMM d' }, ticks: { color: '#999', font: { size: 10 }, maxTicksLimit: 8 }, grid: { display: false } },
                y: { type: 'logarithmic', ticks: { color: '#999', font: { size: 10 }, callback: v => v >= 1000000 ? (v/1000000)+'M' : v >= 1000 ? (v/1000)+'K' : v }, grid: { color: 'rgba(255,255,255,0.06)' } }
              }
            }
          });
        }
      }
      delete window._ampTokenChartData;
    }

    async function renderStatistics() {
      const container = document.getElementById('statistics-view');
      document.getElementById('monitor-summary').style.display = 'none';
      document.getElementById('repo-header').style.display = 'none';
      document.getElementById('settings-view').style.display = 'none';
      document.getElementById('config-view').style.display = 'none';
      document.getElementById('empty').style.display = 'none';

      if (!statsState.data) {
        container.innerHTML = '<div class="stats-empty-msg">Loading statistics…</div>';
        await loadAnalytics();
        await loadCommits();
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
      const activeSubTab = statsState.subTab || 'summary';
      html.push('<div class="stats-view">');

      // Sub-tab bar
      html.push('<div class="stats-subtabs">');
      [['summary','Summary'],['charts','Charts'],['details','Details']].forEach(([id,label]) => {
        const active = activeSubTab === id ? ' active' : '';
        html.push(`<button class="stats-subtab${active}" data-subtab="${id}">${label}</button>`);
      });
      html.push('</div>');

      // Toolbar — period filter (always visible)
      html.push('<div class="stats-toolbar">');
      html.push('<label style="font-size:12px;color:var(--text-secondary)">Period:</label>');
      html.push('<select class="stats-select" id="stats-period-filter">');
      [['7d','Last 7 days'],['30d','Last 30 days'],['90d','Last 90 days'],['all','All time']].forEach(([v,l]) => {
        html.push(`<option value="${v}"${statsState.period === v ? ' selected' : ''}>${l}</option>`);
      });
      html.push('</select>');
      html.push('<button class="btn" id="stats-refresh-btn" style="margin-left:auto">Refresh</button>');
      html.push('</div>');

      // Filter features for the selected period + repo
      const filteredFeatures = filterFeaturesByPeriodAndRepo(analytics.features || [], statsState.period, state.selectedRepo);
      const allCommits = (statsState.commitsData && statsState.commitsData.commits) || [];
      const repoPeriodCommits = filterCommitsByPeriodAndRepo(allCommits, statsState.period, state.selectedRepo);
      const commitFeatureOptions = [...new Set(repoPeriodCommits.map(c => c.featureId).filter(Boolean))]
        .sort((a, b) => Number(a) - Number(b));
      const commitAgentOptions = [...new Set(repoPeriodCommits.map(c => c.agent).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      if (statsState.commitFeatureFilter !== 'all' &&
          statsState.commitFeatureFilter !== 'unattributed' &&
          !commitFeatureOptions.includes(statsState.commitFeatureFilter)) {
        statsState.commitFeatureFilter = 'all';
      }
      if (statsState.commitAgentFilter !== 'all' &&
          statsState.commitAgentFilter !== 'unattributed' &&
          !commitAgentOptions.includes(statsState.commitAgentFilter)) {
        statsState.commitAgentFilter = 'all';
      }
      const filteredCommits = repoPeriodCommits.filter(c => {
        // Type filter (feature / non-feature)
        if (statsState.commitTypeFilter === 'feature-only' && !c.featureId) return false;
        if (statsState.commitTypeFilter === 'non-feature-only' && c.featureId) return false;
        if (statsState.commitFeatureFilter === 'unattributed' && c.featureId) return false;
        if (statsState.commitFeatureFilter !== 'all' &&
            statsState.commitFeatureFilter !== 'unattributed' &&
            String(c.featureId || '') !== statsState.commitFeatureFilter) return false;
        if (statsState.commitAgentFilter === 'unattributed' && c.agent) return false;
        if (statsState.commitAgentFilter !== 'all' &&
            statsState.commitAgentFilter !== 'unattributed' &&
            String(c.agent || '') !== statsState.commitAgentFilter) return false;
        return true;
      });
      const featureCommitMap = {};
      filteredCommits.forEach(c => {
        if (!c.featureId) return;
        const key = `${c.repoPath || ''}:${String(c.featureId).padStart(2, '0')}`;
        if (!featureCommitMap[key]) featureCommitMap[key] = { count: 0, linesChanged: 0 };
        featureCommitMap[key].count += 1;
        featureCommitMap[key].linesChanged += Number(c.linesAdded || 0) + Number(c.linesRemoved || 0);
      });
      statsState.featureCommitMap = featureCommitMap;
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
      // Pre-compute commit totals for summary cards
      const commitTotal = filteredCommits.length;
      const commitFiles = filteredCommits.reduce((s, c) => s + Number(c.filesChanged || 0), 0);
      const commitAdded = filteredCommits.reduce((s, c) => s + Number(c.linesAdded || 0), 0);
      const commitRemoved = filteredCommits.reduce((s, c) => s + Number(c.linesRemoved || 0), 0);
      const commitAvgSize = commitTotal > 0 ? Math.round(((commitAdded + commitRemoved) / commitTotal) * 10) / 10 : null;

      // ═══ SUMMARY TAB ═══
      html.push(`<div class="stats-tab-content" data-tab="summary" style="display:${activeSubTab === 'summary' ? '' : 'none'}">`);
      html.push('<div class="stats-cards">');
      const trend30 = analytics.volume && analytics.volume.trend30d;
      const _proActive = typeof isProActive === 'function' ? isProActive() : true;

      // ── Free stat cards ──
      html.push(buildStatCard('Features Completed', String(totalCompleted),
        statsState.period === '30d' && trend30 !== null ? trendIcon(trend30) : null));
      html.push(buildStatCard('Cycle Time', fmtHours(medianCycle), null, medianCycle !== null ? 'median, start to close' : null,
        'Median wall-clock time from feature-start to feature-close. Lower is better.'));
      const featureCommitCount = filteredCommits.filter(c => c.featureId).length;
      const nonFeatureCommitCount = commitTotal - featureCommitCount;
      html.push(buildStatCard('Commits', String(commitTotal), null,
        `${featureCommitCount} feature / ${nonFeatureCommitCount} non-feature`));
      const fmtK = n => n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
      html.push(buildStatCard('Lines Changed', `+${fmtK(commitAdded)} / -${fmtK(commitRemoved)}`));
      html.push(buildStatCard('Avg Lines / Commit', commitAvgSize !== null ? String(commitAvgSize) : '—'));

      html.push('</div>'); // end free stats-cards grid

      // ── Pro stat cards (grouped with section title) ──
      html.push('<div class="stats-section-title" style="margin-top:16px">Agent Quality' + (_proActive ? '' : ' <span style="font-size:8px;font-weight:700;letter-spacing:.06em;color:var(--accent,#3b82f6);opacity:.7;vertical-align:super;margin-left:4px">PRO</span>') + '</div>');
      html.push('<div class="stats-cards">');
      // Commits per feature — median
      const commitsPerFeatureArr = Object.values(featureCommitMap).map(v => v.count).filter(c => c > 0).sort((a, b) => a - b);
      const cpfMedian = commitsPerFeatureArr.length > 0
        ? (commitsPerFeatureArr.length % 2
          ? commitsPerFeatureArr[Math.floor(commitsPerFeatureArr.length / 2)]
          : Math.round((commitsPerFeatureArr[commitsPerFeatureArr.length / 2 - 1] + commitsPerFeatureArr[commitsPerFeatureArr.length / 2]) / 2 * 10) / 10)
        : null;
      const cpfAvg = commitsPerFeatureArr.length > 0
        ? Math.round(commitsPerFeatureArr.reduce((s, v) => s + v, 0) / commitsPerFeatureArr.length * 10) / 10
        : null;
      // Rework ratio — fix commits / total commits
      const fixRegex = /^(fix|fixup|bugfix)\b|fix:/i;
      const fixCommitCount = filteredCommits.filter(c => fixRegex.test(c.message || '')).length;
      const reworkRatio = commitTotal > 0 ? fixCommitCount / commitTotal : null;

      if (_proActive) {
        html.push(buildStatCard('First-Pass Rate', fmtPct(firstPassRate), null, null,
          'Percentage of features that passed evaluation on the first attempt without needing rework.', { pro: true }));
        html.push(buildStatCard('Commits / Feature', cpfMedian !== null ? String(cpfMedian) : '—',
          null, cpfAvg !== null ? `avg ${cpfAvg}` : null,
          'Median number of commits per feature. Lower suggests more focused, single-pass implementations.', { pro: true }));
        html.push(buildStatCard('Rework Ratio', reworkRatio !== null ? fmtPct(reworkRatio) : '—',
          null, fixCommitCount > 0 ? `${fixCommitCount} fix commits` : null,
          'Percentage of commits that are fixes or rework (messages starting with fix:, fixup, or bugfix). Lower is better — means more work lands correctly on the first pass.', { pro: true }));
      } else {
        html.push(buildProGatedStatCard('First-Pass Rate', 'summary-first-pass',
          'Percentage of features that passed evaluation on the first attempt without needing rework.'));
        html.push(buildProGatedStatCard('Commits / Feature', 'summary-cpf',
          'Median number of commits per feature. Lower suggests more focused, single-pass implementations.'));
        html.push(buildProGatedStatCard('Rework Ratio', 'summary-rework',
          'Percentage of commits that are fixes or rework. Lower is better.'));
      }
      html.push('</div>');

      // Quality & Speed stats
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
      const filteredEvalWins = state.selectedRepo === 'all'
        ? analytics.evalWins || []
        : (() => {
            const repoEntries = evalWinsByRepo.filter(e => e.repoPath === state.selectedRepo);
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
        const proTh = ' <span class="pro-badge-inline">PRO</span>';
        html.push('<thead><tr><th>Agent</th><th>Features</th><th>Eval wins' + proTh + '</th><th>Fleet win %' + proTh + '</th><th>Cycle time</th><th>First-pass</th></tr></thead>');
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
            if (_proActive) {
              html.push(`<td>${ev ? ev.wins : '—'}</td>`);
              html.push(`<td>${winShare !== null ? `<span class="win-rate">${fmtPct(winShare)}</span>` : '—'}</td>`);
            } else {
              html.push('<td style="color:var(--accent,#3b82f6);font-size:8px;font-weight:700;letter-spacing:.06em;opacity:.6">PRO</td>');
              html.push('<td style="color:var(--accent,#3b82f6);font-size:8px;font-weight:700;letter-spacing:.06em;opacity:.6">PRO</td>');
            }
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

      html.push('</div>'); // end summary tab

      // ═══ CHARTS TAB ═══
      html.push(`<div class="stats-tab-content" data-tab="charts" style="display:${activeSubTab === 'charts' ? '' : 'none'}">`);

      // Granularity + nav controls (always shown — free charts use them too)
      html.push('<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">');
      html.push('<div class="volume-granularity-btns">');
      [['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']].forEach(([g,l]) => {
        const active = statsState.volumeGranularity === g ? ' active' : '';
        html.push(`<button class="vol-gran-btn${active}" data-gran="${g}">${l}</button>`);
      });
      html.push('</div>');
      html.push('<div style="display:flex;align-items:center;gap:4px">');
      html.push('<button id="vol-nav-prev" class="vol-nav-btn" title="Earlier">&#8592;</button>');
      html.push('<span id="vol-nav-range" style="font-size:11px;color:var(--text-tertiary);min-width:140px;text-align:center"></span>');
      html.push('<button id="vol-nav-next" class="vol-nav-btn" title="Later">&#8594;</button>');
      html.push('</div>');
      html.push('</div>');

      // ── Free charts: Features Completed + Commits ──
      html.push('<div class="volume-chart-wrap">');
      html.push('<div class="volume-chart-header">');
      html.push('<div class="volume-chart-title">Features Completed</div>');
      html.push('</div>');
      html.push('<div style="height:160px;position:relative"><canvas id="volume-chart-canvas"></canvas></div>');
      html.push('</div>');

      html.push('<div class="volume-chart-wrap">');
      html.push('<div class="volume-chart-header">');
      html.push('<div class="volume-chart-title">Commits</div>');
      html.push('</div>');
      html.push('<div style="height:160px;position:relative"><canvas id="commits-chart-canvas"></canvas></div>');
      html.push('</div>');

      // ── Pro charts: Cycle Time, CPF, Rework Ratio ──
      const proBadgeHtml = '<span class="pro-badge-inline">PRO</span>';
      if (_proActive) {
        html.push('<div class="volume-chart-wrap">');
        html.push('<div class="volume-chart-header">');
        html.push('<div class="volume-chart-title">Median Cycle Time ' + proBadgeHtml + ' <span class="stat-info" data-stat-tooltip="Median wall-clock time from feature-start to feature-close per period. Outliers above P95 are excluded. Scale auto-switches between hours and minutes.">?</span></div>');
        html.push('<span id="ct-nav-controls" style="display:flex;align-items:center;gap:4px">');
        html.push('<button id="ct-nav-prev" class="vol-nav-btn" title="Earlier">&#8592;</button>');
        html.push('<span id="ct-nav-range" style="font-size:11px;color:var(--text-tertiary);min-width:140px;text-align:center"></span>');
        html.push('<button id="ct-nav-next" class="vol-nav-btn" title="Later">&#8594;</button>');
        html.push('</span>');
        html.push('</div>');
        html.push('<div style="height:160px;position:relative"><canvas id="cycle-time-chart-canvas"></canvas></div>');
        html.push('</div>');

        html.push('<div class="volume-chart-wrap">');
        html.push('<div class="volume-chart-header">');
        html.push('<div class="volume-chart-title">Commits per Feature ' + proBadgeHtml + ' <span class="stat-info" data-stat-tooltip="Median number of commits per feature completed in each period. Lower values suggest more focused, single-pass implementations. Trending down means features are getting tighter.">?</span></div>');
        html.push('</div>');
        html.push('<div style="height:160px;position:relative"><canvas id="cpf-chart-canvas"></canvas></div>');
        html.push('</div>');

        html.push('<div class="volume-chart-wrap">');
        html.push('<div class="volume-chart-header">');
        html.push('<div class="volume-chart-title">Rework Ratio ' + proBadgeHtml + ' <span class="stat-info" data-stat-tooltip="Percentage of commits that are fixes (messages starting with fix:, fixup, or bugfix). Lower is better — means agents produce correct code on the first pass. Trending down indicates improving code quality.">?</span></div>');
        html.push('</div>');
        html.push('<div style="height:160px;position:relative"><canvas id="rework-chart-canvas"></canvas></div>');
        html.push('</div>');

      } else {
        // Pro-gated: show blurred SVG placeholders for the 3 Pro charts
        html.push(buildProGatedChart('Median Cycle Time', 'chart-cycle-time',
          'Median wall-clock time from feature-start to feature-close per period.'));
        html.push(buildProGatedChart('Commits per Feature', 'chart-cpf',
          'Median number of commits per feature completed in each period.'));
        html.push(buildProGatedChart('Rework Ratio', 'chart-rework',
          'Percentage of commits that are fixes. Lower is better.'));
        html.push('<div style="text-align:center;padding:8px 0;font-size:11px;color:var(--text-tertiary)"><a href="https://aigon.build/pro" target="_blank" style="color:var(--accent,#3b82f6);text-decoration:none">Get Aigon Pro &rarr;</a></div>');
      }

      html.push('</div>'); // end charts tab

      // ═══ DETAILS TAB ═══
      html.push(`<div class="stats-tab-content" data-tab="details" style="display:${activeSubTab === 'details' ? '' : 'none'}">`);

      // Feature list section (populated after render via renderFeatureList)
      html.push('<div class="stats-section-title" style="margin-top:4px">Features</div>');
      html.push('<div class="stats-block" style="overflow-x:auto"><div id="stats-feature-list"></div></div>');

      // Commit table filters (Pro-gated: type + agent filters)
      html.push('<div class="stats-section-title" style="margin-top:16px">Commits</div>');
      const filterGatedClass = _proActive ? '' : ' pro-gated-filters';
      html.push(`<div class="stats-toolbar${filterGatedClass}" style="margin-top:0">`);
      html.push('<label style="font-size:12px;color:var(--text-secondary)">Type:</label>');
      html.push('<select class="stats-select" id="commit-type-filter">');
      const ctf = statsState.commitTypeFilter || 'all';
      [['all','All'],['feature-only','Feature only'],['non-feature-only','Non-feature only']].forEach(([v,l]) => {
        html.push(`<option value="${v}"${ctf === v ? ' selected' : ''}>${l}</option>`);
      });
      html.push('</select>');
      html.push('<label style="font-size:12px;color:var(--text-secondary)">Agent:</label>');
      html.push('<select class="stats-select" id="commit-agent-filter">');
      html.push(`<option value="all"${statsState.commitAgentFilter === 'all' ? ' selected' : ''}>All</option>`);
      html.push(`<option value="unattributed"${statsState.commitAgentFilter === 'unattributed' ? ' selected' : ''}>Unattributed</option>`);
      commitAgentOptions.forEach(a => {
        html.push(`<option value="${escHtml(a)}"${statsState.commitAgentFilter === a ? ' selected' : ''}>${escHtml(a)}</option>`);
      });
      html.push('</select>');
      html.push('</div>');

      const commitSort = statsState.commitSort || { col: 'date', dir: 'desc' };
      const sortedCommits = filteredCommits.slice().sort((a, b) => {
        const toTs = (v) => (v ? new Date(v).getTime() : 0);
        const col = commitSort.col;
        let av;
        let bv;
        if (col === 'date') { av = toTs(a.date); bv = toTs(b.date); }
        else if (col === 'featureId') { av = Number(a.featureId || -1); bv = Number(b.featureId || -1); }
        else if (col === 'agent') { av = String(a.agent || ''); bv = String(b.agent || ''); }
        else if (col === 'filesChanged') { av = Number(a.filesChanged || 0); bv = Number(b.filesChanged || 0); }
        else if (col === 'linesAdded') { av = Number(a.linesAdded || 0); bv = Number(b.linesAdded || 0); }
        else if (col === 'linesRemoved') { av = Number(a.linesRemoved || 0); bv = Number(b.linesRemoved || 0); }
        else if (col === 'message') { av = String(a.message || ''); bv = String(b.message || ''); }
        else { av = String(a[col] || ''); bv = String(b[col] || ''); }
        if (av < bv) return commitSort.dir === 'asc' ? -1 : 1;
        if (av > bv) return commitSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
      const commitRows = sortedCommits.slice(0, 200).map(c => {
        const date = c.date ? c.date.slice(0, 10) : '—';
        const featureLabel = c.featureId
          ? `#${String(c.featureId).padStart(2, '0')}`
          : '<span class="commit-nf-badge">non-feature</span>';
        const hash = c.hash ? c.hash.slice(0, 7) : '—';
        const repo = c.repoPath ? c.repoPath.split('/').pop() : '—';
        const rowClass = c.featureId ? '' : ' class="commit-nonfeature"';
        return `<tr${rowClass}>
          <td>${escHtml(date)}</td>
          <td class="commit-repo">${escHtml(repo)}</td>
          <td class="commit-message" title="${escHtml(c.message || '')}">${escHtml(c.message || '')}</td>
          <td class="commit-num">${featureLabel}</td>
          <td class="commit-num">${escHtml(c.agent || '—')}</td>
          <td class="commit-num">${escHtml(String(c.filesChanged || 0))}</td>
          <td class="commit-num">${escHtml(String(c.linesAdded || 0))}</td>
          <td class="commit-num">${escHtml(String(c.linesRemoved || 0))}</td>
          <td class="commit-hash" title="${escHtml(c.hash || '')}">${escHtml(hash)}</td>
        </tr>`;
      }).join('');
      const sortArrow = (key) => commitSort.col === key ? (commitSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
      html.push('<div class="stats-block" style="overflow-x:auto">');
      html.push('<table class="commit-list-table">');
      html.push('<colgroup><col class="col-date"><col class="col-repo"><col class="col-msg"><col class="col-feat"><col class="col-agent"><col class="col-files"><col class="col-add"><col class="col-rem"><col class="col-hash"></colgroup>');
      html.push('<thead><tr>');
      html.push(`<th data-commit-sort="date">Date${sortArrow('date')}</th>`);
      html.push('<th>Repo</th>');
      html.push(`<th data-commit-sort="message">Message${sortArrow('message')}</th>`);
      html.push(`<th data-commit-sort="featureId">Feature${sortArrow('featureId')}</th>`);
      html.push(`<th data-commit-sort="agent">Agent${sortArrow('agent')}</th>`);
      html.push(`<th data-commit-sort="filesChanged">Files${sortArrow('filesChanged')}</th>`);
      html.push(`<th data-commit-sort="linesAdded">+Lines${sortArrow('linesAdded')}</th>`);
      html.push(`<th data-commit-sort="linesRemoved">-Lines${sortArrow('linesRemoved')}</th>`);
      html.push('<th>Hash</th>');
      html.push('</tr></thead>');
      html.push(`<tbody>${commitRows || '<tr><td colspan="9" class="commit-empty">No commits for the selected filters.</td></tr>'}</tbody>`);
      html.push('</table>');
      if (sortedCommits.length > 200) {
        html.push(`<div class="commit-footnote">Showing latest 200 of ${sortedCommits.length} commits.</div>`);
      }
      html.push('</div>');

      html.push('</div>'); // end details tab
      html.push('</div>'); // end stats-view

      // Store filtered features for pagination (avoids re-rendering charts on page change)
      statsState.filteredFeatures = filteredFeatures.slice().sort((a, b) => {
        const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return tb - ta;
      });

      container.innerHTML = html.join('');

      // Temporarily show all tabs so Chart.js can measure canvas dimensions
      document.querySelectorAll('.stats-tab-content').forEach(el => { el.style.display = ''; });

      // Render Chart.js charts — free charts always, Pro charts only when active
      {
        const rawVolSeries = buildVolumeSeries(filteredFeatures, statsState.volumeGranularity);
        const rawCommitSeries = buildCommitSeries(filteredCommits, statsState.volumeGranularity);
        const rawCtSeries = _proActive ? buildCycleTimeSeries(filteredFeatures, statsState.volumeGranularity) : [];
        const rawCpfSeries = _proActive ? buildCommitsPerFeatureSeries(filteredFeatures, featureCommitMap, statsState.volumeGranularity) : [];
        const rawReworkSeries = _proActive ? buildReworkRatioSeries(filteredCommits, statsState.volumeGranularity) : [];
        const [alignedVol, alignedCommit, alignedCt, alignedCpf, alignedRework] = alignAllSeries(rawVolSeries, rawCommitSeries, rawCtSeries, rawCpfSeries, rawReworkSeries);
        renderVolumeChart(alignedVol, statsState.volumeGranularity);
        renderCommitChart(alignedCommit, statsState.volumeGranularity);
        if (_proActive) {
          renderCycleTimeChart(alignedCt, statsState.volumeGranularity);
          renderCpfChart(alignedCpf, statsState.volumeGranularity);
          renderReworkChart(alignedRework, statsState.volumeGranularity);
        }
      }

      // Hide inactive tabs now that charts are rendered
      document.querySelectorAll('.stats-tab-content').forEach(el => {
        el.style.display = el.dataset.tab === activeSubTab ? '' : 'none';
      });

      // Wire up sub-tab switching
      document.querySelectorAll('.stats-subtab').forEach(btn => {
        btn.onclick = () => {
          statsState.subTab = btn.dataset.subtab;
          localStorage.setItem('aigon.stats.subtab', statsState.subTab);
          document.querySelectorAll('.stats-subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab === statsState.subTab));
          document.querySelectorAll('.stats-tab-content').forEach(el => {
            el.style.display = el.dataset.tab === statsState.subTab ? '' : 'none';
          });
          // Re-render charts when switching to charts tab (canvas needs to be visible)
          if (statsState.subTab === 'charts') {
            if (statsState.volumeChart) { statsState.volumeChart.resize(); applyVolumeWindow(); }
            if (statsState.commitChart) { statsState.commitChart.resize(); applyCommitWindow(); }
            if (_proActive && statsState.cycleTimeChart) { statsState.cycleTimeChart.resize(); applyCycleTimeWindow(); }
            if (_proActive && statsState.cpfChart) { statsState.cpfChart.resize(); applyCpfWindow(); }
            if (_proActive && statsState.reworkChart) { statsState.reworkChart.resize(); applyReworkWindow(); }
          }
        };
      });

      // Wire up controls
      const periodSel = document.getElementById('stats-period-filter');
      if (periodSel) periodSel.onchange = () => {
        statsState.period = periodSel.value;
        statsState.volumeWindowEnd = null;
        statsState.cycleTimeWindowEnd = null;
        statsState.commitWindowEnd = null;
        statsState.cpfWindowEnd = null;
        statsState.reworkWindowEnd = null;
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
          await loadCommits(true);
          statsState.error = null;
        } catch (e) {
          statsState.error = e.message;
        }
        statsState.loading = false;
        renderStatistics();
      };

      // Granularity buttons — reset all chart windows on change
      document.querySelectorAll('.vol-gran-btn').forEach(btn => {
        btn.onclick = () => {
          statsState.volumeGranularity = btn.dataset.gran;
          statsState.volumeWindowEnd = null;
          statsState.cycleTimeWindowEnd = null;
          statsState.commitWindowEnd = null;
        statsState.cpfWindowEnd = null;
        statsState.reworkWindowEnd = null;
          saveStatsPrefs();
          renderStatistics();
        };
      });

      const commitTypeSel = document.getElementById('commit-type-filter');
      if (commitTypeSel) commitTypeSel.onchange = () => {
        statsState.commitTypeFilter = commitTypeSel.value;
        statsState.commitWindowEnd = null;
        statsState.cpfWindowEnd = null;
        statsState.reworkWindowEnd = null;
        renderStatistics();
      };
      const commitAgentSel = document.getElementById('commit-agent-filter');
      if (commitAgentSel) commitAgentSel.onchange = () => {
        statsState.commitAgentFilter = commitAgentSel.value;
        statsState.commitWindowEnd = null;
        statsState.cpfWindowEnd = null;
        statsState.reworkWindowEnd = null;
        renderStatistics();
      };

      document.querySelectorAll('th[data-commit-sort]').forEach(th => {
        th.onclick = () => {
          const key = th.getAttribute('data-commit-sort');
          if (statsState.commitSort.col === key) {
            statsState.commitSort.dir = statsState.commitSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            statsState.commitSort.col = key;
            statsState.commitSort.dir = key === 'date' ? 'desc' : 'asc';
          }
          renderStatistics();
        };
      });

      // Volume nav buttons
      document.getElementById('vol-nav-prev')?.addEventListener('click', () => panVolumeChart('prev'));
      document.getElementById('vol-nav-next')?.addEventListener('click', () => panVolumeChart('next'));

      // Cycle time nav buttons
      document.getElementById('ct-nav-prev')?.addEventListener('click', () => panCycleTimeChart('prev'));
      document.getElementById('ct-nav-next')?.addEventListener('click', () => panCycleTimeChart('next'));
      // commit chart nav is synced via panAllCharts from the shared vol-nav buttons


      // Feature list
      renderFeatureList();

      // Load pro-reports.js when Pro is active — replaces data-pro-slot placeholders
      if (_proActive && !window._proReportsLoaded) {
        const script = document.createElement('script');
        script.src = '/js/pro-reports.js';
        script.onload = () => {
          window._proReportsLoaded = true;
          if (typeof window.renderProReports === 'function') {
            window.renderProReports(container, statsState.data);
          }
        };
        document.head.appendChild(script);
      } else if (_proActive && typeof window.renderProReports === 'function') {
        window.renderProReports(container, statsState.data);
      }
    }
