    // ── Detail tabs (spec drawer) ────────────────────────────────────────────

    function createDrawerDetailTabs(options) {
      const opts = options || {};
      const drawerEl = opts.drawerEl;
      const tabsEl = opts.tabsEl;
      const detailEl = opts.detailEl;
      const getDrawerState = opts.getDrawerState;
      const onToggleSpecView = opts.onToggleSpecView || (() => {});

      const TAB_ORDER = ['spec', 'status', 'events', 'agents', 'stats', 'log', 'control'];
      const state = {
        active: 'spec',
        loading: false,
        payload: null,
        loadedTabs: {},
        // Selected agent within the Agent Log tab (Fleet picker state)
        logSelectedAgent: null
      };

      function setWideMode(enabled) {
        drawerEl.classList.toggle('drawer-wide', !!enabled);
        document.body.classList.toggle('drawer-wide', !!enabled);
      }

      function switchTab(tab) {
        const key = TAB_ORDER.includes(tab) ? tab : 'spec';
        state.active = key;
        tabsEl.querySelectorAll('.drawer-tab').forEach(btn => {
          const active = btn.dataset.tab === key;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (key === 'spec') {
          setWideMode(false);
          onToggleSpecView(true);
          return;
        }
        onToggleSpecView(false);
        setWideMode(true);
        renderTab(key);
      }

      function reset() {
        state.active = 'spec';
        state.loading = false;
        state.payload = null;
        state.loadedTabs = {};
        state.logSelectedAgent = null;
        detailEl.innerHTML = '';
        setWideMode(false);
        // If drawer was opened with an initial tab (e.g. from peek button), use it
        const initialTab = (typeof drawerState !== 'undefined' && drawerState._initialTab) || 'spec';
        if (drawerState && drawerState._initialTab) drawerState._initialTab = null;
        switchTab(initialTab);
      }

      function parseEntityFromSpecPath(specPath, fallbackType) {
        const file = String(specPath || '').split('/').pop() || '';
        const feature = file.match(/^feature-(\d+)-/);
        if (feature) return { type: 'feature', id: feature[1] };
        const research = file.match(/^research-(\d+)-/);
        if (research) return { type: 'research', id: research[1] };
        const pref = fallbackType === 'research' ? 'research' : 'feature';
        return { type: pref, id: null };
      }

      function formatIso(ts) {
        const d = new Date(ts);
        if (isNaN(d)) return 'Unknown';
        return d.toLocaleString();
      }

      function formatDuration(ms) {
        if (!Number.isFinite(ms) || ms < 0) return 'n/a';
        const s = Math.round(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h) return `${h}h ${m}m`;
        if (m) return `${m}m ${sec}s`;
        return `${sec}s`;
      }

      function jsonSyntaxHighlight(raw) {
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw || {}, null, 2);
        const re = /(\"(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\\"])*\"(?:\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?)\b/g;
        let result = '';
        let lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          result += escHtml(text.slice(lastIndex, m.index));
          let cls = 'json-number';
          if (m[0].startsWith('"') && m[0].endsWith(':')) cls = 'json-key';
          else if (m[0].startsWith('"')) cls = 'json-string';
          else if (m[0] === 'true' || m[0] === 'false') cls = 'json-boolean';
          else if (m[0] === 'null') cls = 'json-null';
          result += '<span class="' + cls + '">' + escHtml(m[0]) + '</span>';
          lastIndex = re.lastIndex;
        }
        result += escHtml(text.slice(lastIndex));
        return result;
      }

      async function fetchDetailPayload() {
        if (state.payload) return state.payload;
        const drawer = getDrawerState();
        const parsed = parseEntityFromSpecPath(drawer.path, drawer.type);
        if (!parsed.id) throw new Error('This item has no numeric ID yet.');
        const q = new URLSearchParams({
          specPath: drawer.path || ''
        });
        if (drawer.repoPath) q.set('repoPath', drawer.repoPath);
        const res = await fetch(`/api/detail/${parsed.type}/${parsed.id}?${q.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        state.payload = data;
        return data;
      }

      function computeStats(payload) {
        const manifest = payload.manifest || {};
        const events = Array.isArray(payload.events)
          ? payload.events
          : (Array.isArray(manifest.events) ? manifest.events : []);
        const byType = {};
        events.forEach(ev => {
          const key = String(ev.type || ev.status || '').trim().toLowerCase();
          if (!key) return;
          byType[key] = ev.at || ev.ts || ev.timestamp || null;
        });
        const firstEventTs = events.length > 0 ? (events[0].at || events[0].ts || events[0].timestamp || null) : null;
        const createdTs = manifest.createdAt || byType.created || byType['feature-created'] || byType['transition:feature-create'] || byType['transition:research-create'] || byType['transition:feature-prioritise'] || byType['transition:research-prioritise'] || byType.bootstrapped || firstEventTs;
        const startedTs = byType.started || byType['feature.started'] || byType['research.started'] || byType['feature-started'] || byType['research-started'] || byType['transition:feature-start'] || byType['transition:research-start'] || byType['signal.agent_started'];
        // Fallback: derive submit time from agent status files if no manifest event
        let agentSubmitTs = null;
        if (!byType.submitted && !byType['all-submitted'] && !byType['feature-submitted'] && !byType['transition:feature-submit']) {
          const agentFiles = payload.agentFiles || {};
          Object.values(agentFiles).forEach(af => {
            if (af && af.status === 'submitted' && af.updatedAt) {
              if (!agentSubmitTs || af.updatedAt < agentSubmitTs) agentSubmitTs = af.updatedAt;
            }
          });
        }
        const submittedTs = byType.submitted || byType['all-submitted'] || byType['feature.submitted'] || byType['research.submitted'] || byType['feature-submitted'] || byType['research-submitted'] || byType['transition:feature-submit'] || byType['transition:research-submit'] || byType['signal.agent_ready'] || agentSubmitTs;
        const reviewedTs = byType['review.completed'] || byType['feature.review_requested'] || byType['research.review_requested'] || byType['feature-review'] || byType['research-review'] || byType['transition:feature-review'] || byType['transition:research-review'];
        const evaluatedTs = byType['eval.completed'] || byType['feature.eval_requested'] || byType['research.eval_requested'] || byType['feature.closed'] || byType['research.closed'] || byType.evaluated || byType.closed || byType['feature-evaluated'] || byType['research-evaluated'] || byType['transition:feature-eval'] || byType['transition:feature-close'] || byType['transition:research-eval'] || byType['transition:research-close'];

        const created = createdTs ? new Date(createdTs) : null;
        const started = startedTs ? new Date(startedTs) : null;
        const submitted = submittedTs ? new Date(submittedTs) : null;
        const reviewed = reviewedTs ? new Date(reviewedTs) : null;
        const evaluated = evaluatedTs ? new Date(evaluatedTs) : null;
        const lastMilestone = evaluated || reviewed || submitted || started;

        return {
          // 0ms means feature was started immediately on creation (no backlog wait) — show as NaN/—
          timeToStart: created && started && (started - created) > 0 ? (started - created) : NaN,
          timeToSubmit: started && submitted ? (submitted - started) : NaN,
          timeToEvaluate: submitted && (evaluated || reviewed) ? ((evaluated || reviewed) - submitted) : NaN,
          totalLifecycle: created && lastMilestone ? (lastMilestone - created) : NaN,
          agentCount: Array.isArray(manifest.agents) ? manifest.agents.length : Object.keys(payload.agentFiles || {}).length,
          winner: manifest.winner || manifest.winningAgent || manifest.winnerAgentId || 'n/a',
          createdAt: createdTs || null,
          startedAt: startedTs || null,
          submittedAt: submittedTs || null,
          reviewedAt: reviewedTs || null,
          evaluatedAt: evaluatedTs || null
        };
      }

      function renderEvents(payload) {
        const rawEvents = Array.isArray(payload.events)
          ? payload.events
          : (Array.isArray(payload.manifest && payload.manifest.events) ? payload.manifest.events : []);
        // Filter out heartbeat noise — only show lifecycle and problem events
        const events = rawEvents.filter(ev => {
          const type = (ev.type || '').toLowerCase();
          return type !== 'signal.heartbeat';
        });
        if (events.length === 0) {
          detailEl.innerHTML = '<div class="drawer-empty">No events recorded.</div>';
          return;
        }
        const rows = events.map(ev => {
          const ts = ev.at || ev.ts || ev.timestamp || '';
          const kind = ev.type || ev.status || 'event';
          const actor = ev.actor || ev.agent || ev.agentId || 'system';
          const summary = ev.message || ev.detail || '';
          return '<li class="timeline-item">' +
            '<div class="timeline-time">' + escHtml(formatIso(ts)) + '</div>' +
            '<div class="timeline-dot"></div>' +
            '<div class="timeline-content">' +
              '<div class="timeline-title"><span class="timeline-kind">' + escHtml(kind) + '</span><span class="timeline-actor">' + escHtml(actor) + '</span></div>' +
              (summary ? '<div class="timeline-summary">' + escHtml(summary) + '</div>' : '') +
            '</div>' +
          '</li>';
        }).join('');
        detailEl.innerHTML = '<ol class="detail-timeline">' + rows + '</ol>';
      }

      function renderAgents(payload) {
        const files = payload.agentFiles || {};
        const excerpts = payload.logExcerpts || {};
        const ids = Object.keys(files).sort();
        if (ids.length === 0) {
          detailEl.innerHTML = '<div class="drawer-empty">No agent status files found.</div>';
          return;
        }
        const cards = ids.map(id => {
          const file = files[id] || {};
          const ex = excerpts[id] || {};
          const excerpt = ex.plan || ex.progress || ex.findings || ex.summary || '';
          const flags = file.flags && typeof file.flags === 'object' ? Object.keys(file.flags) : [];
          return '<section class="agent-detail-card">' +
            '<div class="agent-detail-header">' +
              '<span class="agent-detail-id">' + escHtml(id) + '</span>' +
              '<span class="agent-detail-status status-' + escHtml(String(file.status || 'unknown').toLowerCase()) + '">' + escHtml(file.status || 'unknown') + '</span>' +
            '</div>' +
            '<dl class="agent-detail-grid">' +
              '<div><dt>Updated</dt><dd>' + escHtml(formatIso(file.updatedAt || '')) + '</dd></div>' +
              '<div><dt>Worktree</dt><dd class="mono">' + escHtml(file.worktreePath || 'n/a') + '</dd></div>' +
              '<div><dt>Flags</dt><dd>' + escHtml(flags.length ? flags.join(', ') : 'none') + '</dd></div>' +
              '<div><dt>Session</dt><dd>' + escHtml(file.tmuxSession || (file.flags && file.flags.sessionName) || 'n/a') + '</dd></div>' +
            '</dl>' +
            (excerpt ? '<details class="agent-excerpt"><summary>Log excerpt</summary><pre>' + escHtml(excerpt) + '</pre></details>' : '<div class="agent-no-excerpt">No excerpt available.</div>') +
          '</section>';
        }).join('');
        detailEl.innerHTML = '<div class="agent-detail-grid-wrap">' + cards + '</div>';
      }

      function renderStats(payload) {
        const stats = computeStats(payload);
        const c = (payload.deepStatus && payload.deepStatus.cost) || {};
        const rows = [
          ['Time to start', formatDuration(stats.timeToStart), 'How long the feature sat in the backlog before an agent began working on it'],
          ['Time to submit', formatDuration(stats.timeToSubmit), 'How long the agent(s) spent implementing before submitting code'],
          ['Time to evaluate', formatDuration(stats.timeToEvaluate), 'How long between submission and evaluation/close'],
          ['Total lifecycle', formatDuration(stats.totalLifecycle), 'Wall-clock time from the earliest recorded event to close'],
          ['Agent count', String(stats.agentCount || 0)],
          ['Winner', String(stats.winner || 'n/a')]
        ];
        const timelineRows = [
          ['Created', stats.createdAt ? formatIso(stats.createdAt) : 'n/a'],
          ['Started', stats.startedAt ? formatIso(stats.startedAt) : 'n/a'],
          ['Submitted', stats.submittedAt ? formatIso(stats.submittedAt) : 'n/a'],
          stats.reviewedAt ? ['Reviewed', formatIso(stats.reviewedAt)] : null,
          ['Evaluated', stats.evaluatedAt ? formatIso(stats.evaluatedAt) : 'n/a']
        ].filter(Boolean);

        // Cost section: per-agent breakdown table
        let costHtml = '';
        const costByAgent = c.costByAgent || {};
        const costAgentIds = Object.keys(costByAgent).sort();
        if (costAgentIds.length > 0) {
          const fmt = n => String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          const fmtCost = n => '$' + (Math.round(Number(n) * 10000) / 10000);
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let totalCostUsd = 0;
          let anyReal = false;
          const rowsHtml = costAgentIds.map(id => {
            const a = costByAgent[id] || {};
            const hasReal = a.hasRealData === true;
            if (hasReal) {
              anyReal = true;
              totalInputTokens += Number(a.inputTokens) || 0;
              totalOutputTokens += Number(a.outputTokens) || 0;
              totalCostUsd += Number(a.costUsd) || 0;
            }
            const displayAgent = (a.agent || id).toUpperCase();
            const modelCell = escHtml(a.model || '—');
            const inputCell = hasReal ? fmt(a.inputTokens) : '<span class="cost-na">n/a</span>';
            const outputCell = hasReal ? fmt(a.outputTokens) : '<span class="cost-na">n/a</span>';
            const costCell = hasReal ? escHtml(fmtCost(a.costUsd || 0)) : '<span class="cost-na">n/a</span>';
            return '<tr>' +
              '<td><span class="agent-mono">' + escHtml(displayAgent) + '</span></td>' +
              '<td>' + modelCell + '</td>' +
              '<td>' + inputCell + '</td>' +
              '<td>' + outputCell + '</td>' +
              '<td>' + costCell + '</td>' +
              '</tr>';
          }).join('');
          const totalRow = anyReal
            ? '<tr class="cost-total-row">' +
              '<td><strong>Total</strong></td>' +
              '<td></td>' +
              '<td><strong>' + fmt(totalInputTokens) + '</strong></td>' +
              '<td><strong>' + fmt(totalOutputTokens) + '</strong></td>' +
              '<td><strong>' + escHtml(fmtCost(totalCostUsd)) + '</strong></td>' +
              '</tr>'
            : '';
          costHtml = '<h5 class="stats-section-heading">Cost by Agent</h5>' +
            '<table class="stats-token-table">' +
            '<thead><tr><th>Agent</th><th>Model</th><th>Input Tokens</th><th>Output Tokens</th><th>Estimated Cost</th></tr></thead>' +
            '<tbody>' + rowsHtml + totalRow + '</tbody>' +
            '</table>';
        }

        detailEl.innerHTML =
          '<div class="stats-grid">' +
            rows.map(([k, v, tip]) => '<div class="stats-row"><div class="stats-key">' + escHtml(k) + (tip ? ' <span class="stats-tip" data-tip="' + escHtml(tip) + '">?</span>' : '') + '</div><div class="stats-val">' + escHtml(v) + '</div></div>').join('') +
          '</div>' +
          '<div class="stats-events">' +
            timelineRows.map(([k, v]) => '<div class="stats-row"><div class="stats-key">' + escHtml(k) + '</div><div class="stats-val">' + escHtml(v) + '</div></div>').join('') +
          '</div>' +
          costHtml;
      }

      async function fetchDeepStatus() {
        const drawer = getDrawerState();
        const parsed = parseEntityFromSpecPath(drawer.path, drawer.type);
        if (!parsed.id) throw new Error('This item has no numeric ID yet.');
        const q = new URLSearchParams();
        if (drawer.repoPath) q.set('repoPath', drawer.repoPath);
        if (parsed.type === 'research') q.set('type', 'research');
        const res = await fetch(`/api/feature-status/${parsed.id}?${q.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      function formatUptime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return 'n/a';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h) return h + 'h ' + m + 'm';
        if (m) return m + 'm ' + s + 's';
        return s + 's';
      }

      function statusIndicator(alive, session) {
        if (session && session.completed) {
          return '<span class="status-dot status-completed"></span> Completed';
        }
        const cls = alive ? 'status-alive' : 'status-dead';
        const label = alive ? 'Alive' : 'Dead';
        return '<span class="status-dot ' + cls + '"></span> ' + escHtml(label);
      }

      function statusSection(title, rows) {
        const body = rows
          .filter(r => r)
          .map(([k, v]) => '<div class="stats-row"><div class="stats-key">' + escHtml(k) + '</div><div class="stats-val">' + (v || 'n/a') + '</div></div>')
          .join('');
        return '<div class="deep-status-section"><h4 class="deep-status-heading">' + escHtml(title) + '</h4>' + body + '</div>';
      }

      function renderStatus(data) {
        const s = data.session || {};
        const p = data.progress || {};
        const sp = data.spec || {};

        const sessionRows = s.completed
          ? [
              ['Status', statusIndicator(false, s)],
              s.completedAt ? ['Completed at', escHtml(formatIso(s.completedAt))] : null,
              s.durationMs != null ? ['Duration', formatUptime(Math.floor(s.durationMs / 1000))] : null,
            ]
          : [
              ['Status', statusIndicator(s.tmuxAlive)],
              ['Session name', s.sessionName ? escHtml(s.sessionName) : 'n/a'],
              ['Uptime', formatUptime(s.uptimeSeconds)],
              s.pid ? ['PID', escHtml(String(s.pid))] : null,
            ];
        const sessionHtml = statusSection('Session', sessionRows);

        const progressHtml = statusSection('Progress', [
          ['Commits', escHtml(String(p.commitCount || 0))],
          ['Last commit', p.lastCommitAt ? escHtml(formatIso(p.lastCommitAt)) : 'n/a'],
          ['Last message', p.lastCommitMessage ? escHtml(p.lastCommitMessage) : 'n/a'],
          ['Files changed', escHtml(String(p.filesChanged || 0))],
          ['Lines', '+' + (p.linesAdded || 0) + ' / -' + (p.linesRemoved || 0)],
        ]);

        const costHtml = '';

        const criteriaLabel = sp.criteriaTotal
          ? escHtml(sp.criteriaDone + '/' + sp.criteriaTotal)
          : 'n/a';
        const specHtml = statusSection('Spec', [
          ['Criteria', criteriaLabel],
          ['Spec path', sp.specPath ? '<span class="mono">' + escHtml(sp.specPath) + '</span>' : 'n/a'],
          ['Log path', sp.logPath ? '<span class="mono">' + escHtml(sp.logPath) + '</span>' : 'n/a'],
        ]);

        // Multi-agent sessions
        let agentSessionsHtml = '';
        const agentSessions = data.agentSessions || {};
        const agentIds = Object.keys(agentSessions);
        if (agentIds.length > 1) {
          const rows = agentIds.map(id => {
            const as = agentSessions[id] || {};
            return [escHtml(id), statusIndicator(as.tmuxAlive) + (as.uptimeSeconds != null ? ' · ' + formatUptime(as.uptimeSeconds) : '')];
          });
          agentSessionsHtml = statusSection('Agent Sessions', rows);
        }

        const metaHtml = statusSection('Identity', [
          ['ID', escHtml(String(data.id || ''))],
          ['Name', escHtml(data.name || '')],
          ['Lifecycle', escHtml(data.lifecycle || 'unknown')],
          ['Mode', escHtml(data.mode || 'unknown')],
          ['Primary agent', escHtml(data.primaryAgent || 'none')],
          data.worktreePath ? ['Worktree', '<span class="mono">' + escHtml(data.worktreePath) + '</span>'] : null,
        ]);

        detailEl.innerHTML =
          '<div class="deep-status-grid">' +
            sessionHtml + progressHtml + costHtml + specHtml + agentSessionsHtml + metaHtml +
          '</div>' +
          '<div class="deep-status-footer">Collected ' + escHtml(formatIso(data.collectedAt)) + '</div>';
      }

      function buildControlBlock(id, label, raw) {
        return '<section class="control-block">' +
          '<div class="control-header">' +
            '<strong>' + escHtml(label) + '</strong>' +
            '<button class="btn btn-sm detail-copy-json" data-copy-id="' + escHtml(id) + '">Copy</button>' +
          '</div>' +
          '<pre class="json-block" data-json-id="' + escHtml(id) + '">' + jsonSyntaxHighlight(raw) + '</pre>' +
        '</section>';
      }

      function renderLog(payload) {
        const logs = (payload && payload.agentLogs) || {};
        const ids = Object.keys(logs).sort();
        if (ids.length === 0) {
          detailEl.innerHTML = '<div class="drawer-empty">No agent log written yet.</div>';
          return;
        }
        // Default the picker to the first agent (or keep prior selection if still present)
        if (!state.logSelectedAgent || !logs[state.logSelectedAgent]) {
          state.logSelectedAgent = ids[0];
        }
        const renderBody = () => {
          const entry = logs[state.logSelectedAgent] || {};
          const bodyHtml = entry.content
            ? marked.parse(entry.content)
            : '<div class="drawer-empty">No agent log written yet.</div>';
          const pickerHtml = ids.length > 1
            ? '<div class="log-picker">' + ids.map(id =>
                '<button type="button" class="log-picker-btn' + (id === state.logSelectedAgent ? ' active' : '') + '" data-log-agent="' + escHtml(id) + '">' + escHtml(id.toUpperCase()) + '</button>'
              ).join('') + '</div>'
            : '';
          const pathHtml = entry.path
            ? '<div class="log-path mono">' + escHtml(entry.path) + '</div>'
            : '';
          detailEl.innerHTML = pickerHtml + pathHtml + '<div class="markdown-body log-body">' + bodyHtml + '</div>';
        };
        renderBody();
        // Wire picker clicks (Fleet only). Re-renders the body without re-fetching.
        if (ids.length > 1) {
          detailEl.querySelectorAll('.log-picker-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              state.logSelectedAgent = btn.dataset.logAgent;
              renderBody();
            });
          });
        }
      }

      function renderControl(payload) {
        const manifestRaw = payload.rawManifest || JSON.stringify(payload.manifest || {}, null, 2);
        const files = payload.agentFiles || {};
        const rawFiles = payload.rawAgentFiles || {};
        const ids = Object.keys(files).sort();
        let html = buildControlBlock('manifest', 'Coordinator manifest', manifestRaw);
        ids.forEach(id => {
          const raw = rawFiles[id] || JSON.stringify(files[id] || {}, null, 2);
          html += buildControlBlock('agent-' + id, `Agent ${id}`, raw);
        });
        if (ids.length === 0) {
          html += '<div class="drawer-empty">No agent control files found.</div>';
        }
        detailEl.innerHTML = '<div class="control-wrap">' + html + '</div>';
      }

      async function renderTab(tab) {
        if (tab === 'spec') return;
        if (state.loading) return;
        detailEl.innerHTML = '<div class="drawer-empty">Loading…</div>';
        try {
          state.loading = true;
          if (tab === 'status') {
            const deepStatus = await fetchDeepStatus();
            state.loadedTabs[tab] = true;
            renderStatus(deepStatus);
          } else {
            const payload = await fetchDetailPayload();
            if (tab === 'stats') {
              try { payload.deepStatus = await fetchDeepStatus(); } catch (_) {}
            }
            state.loadedTabs[tab] = true;
            if (tab === 'events') renderEvents(payload);
            else if (tab === 'agents') renderAgents(payload);
            else if (tab === 'stats') renderStats(payload);
            else if (tab === 'log') renderLog(payload);
            else if (tab === 'control') renderControl(payload);
            else detailEl.innerHTML = '<div class="drawer-empty">Unknown tab.</div>';
          }
        } catch (e) {
          detailEl.innerHTML = '<div class="drawer-empty drawer-empty-error">' + escHtml(e.message || 'Failed to load detail data') + '</div>';
        } finally {
          state.loading = false;
        }
      }

      tabsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.drawer-tab');
        if (!btn) return;
        switchTab(btn.dataset.tab || 'spec');
      });

      detailEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('.detail-copy-json');
        if (!btn) return;
        const id = btn.dataset.copyId;
        const pre = detailEl.querySelector('[data-json-id="' + id + '"]');
        if (!pre) return;
        const text = pre.textContent || '';
        const ok = await copyText(text);
        showToast(ok ? 'Copied JSON' : 'Copy failed');
      });

      return {
        switchTab,
        reset,
        clearData() { state.payload = null; state.loadedTabs = {}; },
        getActiveTab() { return state.active; },
        onDrawerRefresh() {
          state.payload = null;
          state.loadedTabs = {};
          if (state.active !== 'spec') renderTab(state.active);
        }
      };
    }
