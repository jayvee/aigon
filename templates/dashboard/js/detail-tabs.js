/* dashboard-esm-processed */

import { handleFeatureAction, renderActionButtons } from './actions.js';
import { isCompleteStatus } from './utils.js';
import { drawerState } from './spec-drawer.js';
import { state } from './state.js';
import { copyText, escHtml, formatLeaseHolderLabel, showToast } from './utils.js';
    // ── Detail tabs (spec drawer) ────────────────────────────────────────────

    function findEntityInDashboardState(entityType, entityId, repoPath) {
      const pollState = (state && state.data) ? state : null;
      if (!pollState || !pollState.data) return null;
      const repos = pollState.data.repos || [];
      for (const repo of repos) {
        if (repoPath && repo.path !== repoPath) continue;
        const list = entityType === 'research' ? (repo.research || []) : (repo.features || []);
        const hit = list.find((item) => String(item.id) === String(entityId));
        if (hit) return { feature: hit, repo, repoPath: repo.path, pipelineType: entityType === 'research' ? 'research' : 'features' };
      }
      return null;
    }

    function renderDrawerRecoveryActions(entityType, entityId, repoPath) {
      const located = findEntityInDashboardState(entityType, entityId, repoPath);
      if (!located || typeof renderActionButtons !== 'function' || typeof handleFeatureAction !== 'function') return '';
      const allRecoveryActions = (located.feature.validActions || []).filter((va) => va.metadata && va.metadata.recovery);
      const surfaceActions = allRecoveryActions.filter((va) => va.metadata && va.metadata.recoverySurface);
      const recoveryActions = surfaceActions.length ? surfaceActions : allRecoveryActions;
      if (recoveryActions.length === 0) return '';
      const feature = Object.assign({}, located.feature, { validActions: recoveryActions, __showRecoveryActions: true });
      const buttonsHtml = renderActionButtons(feature, located.repoPath, located.pipelineType);
      if (!buttonsHtml) return '';
      return '<div class="deep-status-section drawer-recovery-section">' +
        '<h4 class="deep-status-heading">Recovery</h4>' +
        '<p class="drawer-recovery-copy">Review controller status and choose the next available operation.</p>' +
        '<div class="drawer-recovery-actions">' + buttonsHtml + '</div>' +
      '</div>';
    }

    function wireDrawerRecoveryActions(root, entityType, entityId, repoPath) {
      if (!root || typeof handleFeatureAction !== 'function') return;
      const located = findEntityInDashboardState(entityType, entityId, repoPath);
      if (!located) return;
      root.querySelectorAll('.kcard-va-btn').forEach((btn) => {
        const vaAction = btn.getAttribute('data-va-action');
        const vaAgentId = btn.getAttribute('data-agent') || null;
        const va = (located.feature.validActions || []).find((a) => a.action === vaAction && (a.agentId || null) === vaAgentId);
        if (!va) return;
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.closeAllKcardOverflowMenus === 'function') window.closeAllKcardOverflowMenus();
          await handleFeatureAction(va, located.feature, located.repoPath, btn, located.pipelineType);
        };
      });
    }

    function createDrawerDetailTabs(options) {
      const opts = options || {};
      const drawerEl = opts.drawerEl;
      const tabsEl = opts.tabsEl;
      const detailEl = opts.detailEl;
      const getDrawerState = opts.getDrawerState;
      const onToggleSpecView = opts.onToggleSpecView || (() => {});

      const TAB_ORDER = ['spec', 'status', 'events', 'agents', 'stats', 'code-changes', 'log', 'control'];
      const detailCache = window.__aigonEntityDetailCache || new Map();
      window.__aigonEntityDetailCache = detailCache;
      const state = {
        active: 'spec',
        loading: false,
        payload: null,
        loadedTabs: {},
        // Selected agent within the Agent Log tab (Fleet picker state)
        logSelectedAgent: null,
        codeChangesPayload: null,
        commitExpanded: new Set(),
        diffExpanded: new Set(),
        diffCache: new Map()
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
        state.codeChangesPayload = null;
        state.commitExpanded = new Set();
        state.diffExpanded = new Set();
        state.diffCache = new Map();
        detailEl.innerHTML = '';
        setWideMode(false);
        // If drawer was opened with an initial tab (e.g. from peek button), use it
        const initialTab = (typeof drawerState !== 'undefined' && drawerState._initialTab) || 'spec';
        if (drawerState && drawerState._initialTab) drawerState._initialTab = null;
        if (typeof drawerState !== 'undefined' && drawerState._initialLogAgent) {
          state.logSelectedAgent = drawerState._initialLogAgent;
          drawerState._initialLogAgent = null;
        }
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
        const fingerprint = drawer.detailFingerprint || 'unknown';
        const cacheKey = [
          drawer.repoPath || '',
          parsed.type,
          parsed.id,
          fingerprint
        ].join('|');
        if (detailCache.has(cacheKey)) {
          state.payload = detailCache.get(cacheKey);
          return state.payload;
        }
        const q = new URLSearchParams({
          specPath: drawer.path || ''
        });
        if (drawer.repoPath) q.set('repoPath', drawer.repoPath);
        const segment = parsed.type === 'research' ? 'research' : 'features';
        const res = await fetch(`/api/${segment}/${parsed.id}/details?${q.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        state.payload = data;
        detailCache.set(cacheKey, data);
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
        if (!byType.submitted && !byType['all-submitted'] && !byType['feature-submitted']) {
          const agentFiles = payload.agentFiles || {};
          Object.values(agentFiles).forEach(af => {
            if (af && isCompleteStatus(af.status) && af.updatedAt) {
              if (!agentSubmitTs || af.updatedAt < agentSubmitTs) agentSubmitTs = af.updatedAt;
            }
          });
        }
        const submittedTs = byType.submitted || byType['all-submitted'] || byType['feature.submitted'] || byType['research.submitted'] || byType['feature-submitted'] || byType['research-submitted'] || byType['transition:research-submit'] || byType['signal.agent_ready'] || agentSubmitTs;
        const reviewedTs = byType['review.completed'] || byType['feature.review_requested'] || byType['research.review_requested'] || byType['feature-code-review'] || byType['feature-review'] || byType['research-review'] || byType['transition:feature-code-review'] || byType['transition:feature-review'] || byType['transition:research-review'];
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
        const fmtEvTime = (ts) => {
          const d = new Date(ts);
          if (isNaN(d)) return '';
          return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        };
        const rows = events.map(ev => {
          const ts = ev.at || ev.ts || ev.timestamp || '';
          const kind = ev.type || ev.status || 'event';
          const label = ev.displayLabel || kind;
          const actor = ev.displayActor || ev.actor || ev.agent || ev.agentId || ev.reviewerId || ev.revisionAgentId || 'system';
          const summary = ev.message || ev.detail || '';
          let dotClass = 'timeline-dot';
          let titleHtml = '<span class="timeline-kind">' + escHtml(label) + '</span><span class="timeline-actor">' + escHtml(actor) + '</span>';
          let itemClass = 'timeline-item';
          if (kind === 'agent.token_exhausted') {
            dotClass = 'timeline-dot timeline-dot-warn';
            itemClass = 'timeline-item timeline-item-warn';
            const src = ev.source || 'usage limit';
            titleHtml = '<span class="timeline-kind">🟡 ' + escHtml(actor) + ' hit token limit</span><span class="timeline-actor"> · ' + escHtml(src) + ' · ' + escHtml(fmtEvTime(ts)) + '</span>';
          } else if (kind === 'agent.failover_switched') {
            dotClass = 'timeline-dot timeline-dot-ok';
            itemClass = 'timeline-item timeline-item-ok';
            const prev = ev.previousAgentId || ev.agentId || actor;
            const next = ev.replacementAgentId || '?';
            const commit = ev.lastCommit ? 'last commit ' + ev.lastCommit : '';
            titleHtml = '<span class="timeline-kind">🟢 Failover</span><span class="timeline-actor"> · ' + escHtml(prev) + ' → ' + escHtml(next) + (commit ? ' · ' + escHtml(commit) : '') + ' · ' + escHtml(fmtEvTime(ts)) + '</span>';
          }
          return '<li class="' + itemClass + '">' +
            '<div class="timeline-time">' + escHtml(formatIso(ts)) + '</div>' +
            '<div class="' + dotClass + '"></div>' +
            '<div class="timeline-content">' +
              '<div class="timeline-title">' + titleHtml + '</div>' +
              (summary && kind !== 'agent.token_exhausted' && kind !== 'agent.failover_switched' ? '<div class="timeline-summary">' + escHtml(summary) + '</div>' : '') +
            '</div>' +
          '</li>';
        }).join('');
        detailEl.innerHTML = '<ol class="detail-timeline">' + rows + '</ol>';
      }

      function renderAgents(payload, transcriptBundle) {
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
          const roles = Array.isArray(file.roles) ? file.roles : (file.role ? [file.role] : []);
          return '<section class="agent-detail-card">' +
            '<div class="agent-detail-header">' +
              '<span class="agent-detail-id">' + escHtml(id) + '</span>' +
              '<span class="agent-detail-status status-' + escHtml(String(file.status || 'unknown').toLowerCase()) + '">' + escHtml(file.status || 'unknown') + '</span>' +
            '</div>' +
            '<dl class="agent-detail-grid">' +
              '<div><dt>Role</dt><dd>' + escHtml(roles.length ? roles.join(', ') : 'implementer') + '</dd></div>' +
              '<div><dt>Updated</dt><dd>' + escHtml(formatIso(file.updatedAt || '')) + '</dd></div>' +
              '<div><dt>Worktree</dt><dd class="mono">' + escHtml(file.worktreePath || 'n/a') + '</dd></div>' +
              '<div><dt>Flags</dt><dd>' + escHtml(flags.length ? flags.join(', ') : 'none') + '</dd></div>' +
              '<div><dt>Session</dt><dd>' + escHtml(file.tmuxSession || (file.flags && file.flags.sessionName) || 'n/a') + '</dd></div>' +
              '<div><dt>Transcript</dt><dd>' + transcriptControlsHtml(id, transcriptBundle) + '</dd></div>' +
            '</dl>' +
            (excerpt ? '<details class="agent-excerpt"><summary>Log excerpt</summary><pre>' + escHtml(excerpt) + '</pre></details>' : '<div class="agent-no-excerpt">No excerpt available.</div>') +
          '</section>';
        }).join('');
        detailEl.innerHTML = '<div class="agent-detail-grid-wrap">' + cards + '</div>';
      }

      function renderLeaseSection(entityType, entityId, repoPath) {
        const located = findEntityInDashboardState(entityType, entityId, repoPath);
        const entity = located && located.feature ? located.feature : null;
        const leases = entity && Array.isArray(entity.activeLeases)
          ? entity.activeLeases
          : [];
        if (leases.length === 0) return '';
        const storage = located && located.repo ? located.repo.storage : null;
        const localHolderId = storage && storage.localHolderId ? String(storage.localHolderId) : null;
        const stale = Boolean((entity && entity.leaseDataStale) || (storage && storage.leaseDataStale));
        const rows = leases.map((lease) => {
          const holder = typeof formatLeaseHolderLabel === 'function'
            ? formatLeaseHolderLabel(lease)
            : ((lease.holderId || 'unknown') + (lease.agentId ? ' · ' + String(lease.agentId).toUpperCase() : ''));
          const heldByMe = localHolderId && lease.holderId === localHolderId;
          const stateLabel = stale ? 'stale' : (heldByMe ? 'this machine' : 'active');
          const stateClass = stale ? 'is-stale' : (heldByMe ? 'is-local' : 'is-remote');
          const expires = lease.expiresAt ? formatIso(lease.expiresAt) : 'n/a';
          return '<div class="drawer-lease-row ' + stateClass + '">' +
            '<div class="drawer-lease-icon" aria-hidden="true">&#128274;</div>' +
            '<div class="drawer-lease-main">' +
              '<div class="drawer-lease-holder" title="' + escHtml(holder) + '">' + escHtml(holder) + '</div>' +
              '<div class="drawer-lease-meta">until ' + escHtml(expires) + '</div>' +
            '</div>' +
            '<div class="drawer-lease-state">' + escHtml(stateLabel) + '</div>' +
          '</div>';
        }).join('');
        const heading = leases.length === 1 ? 'Active lock' : 'Active locks';
        return '<div class="deep-status-section drawer-lease-section">' +
          '<h4 class="deep-status-heading">Lock</h4>' +
          '<div class="drawer-lease-title">' + escHtml(heading) + '</div>' +
          '<div class="drawer-lease-list">' + rows + '</div>' +
        '</div>';
      }

      function renderStats(payload) {
        const drawer = getDrawerState();
        const parsed = parseEntityFromSpecPath(drawer.path, drawer.type);
        const stats = computeStats(payload);
        const startup = payload.startupReadiness || (payload.manifest && payload.manifest.startupReadiness) || {};
        const c = (payload.deepStatus && payload.deepStatus.cost) || {};
        const rows = [
          ['Time to start', formatDuration(stats.timeToStart), 'How long the feature sat in the backlog before an agent began working on it'],
          ['Start to first heartbeat', formatDuration(startup.featureStartedToFirstHeartbeatMs), 'Post-start delay until the first agent heartbeat reached the workflow read model'],
          ['Start to all heartbeats', formatDuration(startup.featureStartedToAllHeartbeatsMs), 'Post-start delay until every started agent had emitted a heartbeat'],
          ['Start to all ready', formatDuration(startup.featureStartedToAllReadyMs), 'Wall-clock time from feature.started until every agent emitted agent_ready'],
          ['Time to submit', formatDuration(stats.timeToSubmit), 'How long the agent(s) spent implementing before submitting code'],
          ['Time to evaluate', formatDuration(stats.timeToEvaluate), 'How long between submission and evaluation/close'],
          ['Total lifecycle', formatDuration(stats.totalLifecycle), 'Wall-clock time from the earliest recorded event to close'],
          ['Agent count', String(stats.agentCount || 0)],
          ['Winner', String(stats.winner || 'n/a')]
        ];
        const timelineRows = [
          ['Created', stats.createdAt ? formatIso(stats.createdAt) : 'n/a'],
          ['Started', stats.startedAt ? formatIso(stats.startedAt) : 'n/a'],
          ['Completed', stats.submittedAt ? formatIso(stats.submittedAt) : 'n/a'],
          stats.reviewedAt ? ['Reviewed', formatIso(stats.reviewedAt)] : null,
          ['Evaluated', stats.evaluatedAt ? formatIso(stats.evaluatedAt) : 'n/a']
        ].filter(Boolean);

        // Cost section: per-agent breakdown table
        let costHtml = '';
        const costByAgent = { ...(c.costByAgent || {}) };
        Object.entries(payload.agentFiles || {}).forEach(([id, file]) => {
          if (costByAgent[id]) return;
          costByAgent[id] = {
            agent: id,
            model: null,
            note: file && file.role === 'reviewer' ? 'no cost data (reviewer)' : 'no cost data',
            hasRealData: false
          };
        });
        const costAgentIds = Object.keys(costByAgent).sort();
        if (costAgentIds.length > 0) {
          const fmt = n => String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          const fmtCost = n => '$' + (Math.round(Number(n) * 10000) / 10000);
          let totalInputTokens = 0;
          let totalCacheReadTokens = 0;
          let totalOutputTokens = 0;
          let totalThinkingTokens = 0;
          let totalCostUsd = 0;
          let anyReal = false;
          const rowsHtml = costAgentIds.map(id => {
            const a = costByAgent[id] || {};
            const hasReal = a.hasRealData === true;
            if (hasReal) {
              anyReal = true;
              totalInputTokens += Number(a.inputTokens) || 0;
              totalCacheReadTokens += Number(a.cachedInputTokens) || 0;
              totalOutputTokens += Number(a.outputTokens) || 0;
              totalThinkingTokens += Number(a.thinkingTokens) || 0;
              totalCostUsd += Number(a.costUsd) || 0;
            }
            const displayAgent = (a.agent || id).toUpperCase();
            const modelCell = escHtml(a.model || a.note || 'no cost data');
            const inputCell = hasReal ? fmt(a.inputTokens) : '<span class="cost-na">n/a</span>';
            const cacheCell = hasReal ? (Number(a.cachedInputTokens) > 0 ? fmt(a.cachedInputTokens) : '0') : '<span class="cost-na">n/a</span>';
            const outputCell = hasReal ? fmt(a.outputTokens) : '<span class="cost-na">n/a</span>';
            const thinkCell = hasReal ? (Number(a.thinkingTokens) > 0 ? fmt(a.thinkingTokens) : '0') : '<span class="cost-na">n/a</span>';
            const costCell = hasReal ? escHtml(fmtCost(a.costUsd || 0)) : '<span class="cost-na">n/a</span>';
            return '<tr>' +
              '<td><span class="agent-mono">' + escHtml(displayAgent) + '</span></td>' +
              '<td>' + modelCell + '</td>' +
              '<td>' + inputCell + '</td>' +
              '<td>' + cacheCell + '</td>' +
              '<td>' + outputCell + '</td>' +
              '<td>' + thinkCell + '</td>' +
              '<td>' + costCell + '</td>' +
              '</tr>';
          }).join('');
          const totalRow = anyReal
            ? '<tr class="cost-total-row">' +
              '<td><strong>Total</strong></td>' +
              '<td></td>' +
              '<td><strong>' + fmt(totalInputTokens) + '</strong></td>' +
              '<td><strong>' + fmt(totalCacheReadTokens) + '</strong></td>' +
              '<td><strong>' + fmt(totalOutputTokens) + '</strong></td>' +
              '<td><strong>' + fmt(totalThinkingTokens) + '</strong></td>' +
              '<td><strong>' + escHtml(fmtCost(totalCostUsd)) + '</strong></td>' +
              '</tr>'
            : '';
          costHtml = '<h5 class="stats-section-heading">Cost by Agent</h5>' +
            '<table class="stats-token-table">' +
            '<thead><tr><th>Agent</th><th>Model</th><th>Input</th><th>Cache Read</th><th>Output</th><th>Thinking</th><th>Estimated Cost</th></tr></thead>' +
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

      async function fetchCommits() {
        const drawer = getDrawerState();
        const parsed = parseEntityFromSpecPath(drawer.path, drawer.type);
        if (!parsed.id) throw new Error('This item has no numeric ID yet.');
        if (parsed.type !== 'feature') throw new Error('Code Changes is feature-only.');
        const q = new URLSearchParams();
        if (drawer.repoPath) q.set('repoPath', drawer.repoPath);
        const res = await fetch(`/api/feature/${encodeURIComponent(parsed.id)}/commits?${q.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      async function fetchCommitFileDiff(commitHash, filePath) {
        const drawer = getDrawerState();
        const parsed = parseEntityFromSpecPath(drawer.path, drawer.type);
        if (!parsed.id) throw new Error('This item has no numeric ID yet.');
        const q = new URLSearchParams();
        q.set('path', filePath);
        if (drawer.repoPath) q.set('repoPath', drawer.repoPath);
        const res = await fetch(`/api/feature/${encodeURIComponent(parsed.id)}/commits/${encodeURIComponent(commitHash)}/diff?${q.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      function formatRelativeTimestamp(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return 'unknown';
        const diff = Date.now() - d.getTime();
        if (diff < 0) return formatIso(iso);
        const s = Math.round(diff / 1000);
        if (s < 60) return s + 's ago';
        const m = Math.round(s / 60);
        if (m < 60) return m + 'm ago';
        const h = Math.round(m / 60);
        if (h < 24) return h + 'h ago';
        const days = Math.round(h / 24);
        if (days < 30) return days + 'd ago';
        return formatIso(iso);
      }

      function renderCodeChanges(payload) {
        state.codeChangesPayload = payload || {};
        const commits = Array.isArray(payload && payload.commits) ? payload.commits : [];
        if (commits.length === 0) {
          detailEl.innerHTML = '<div class="drawer-empty">No commits yet.</div>';
          return;
        }
        const sourceLabel = payload.source === 'merged'
          ? 'Merged to main'
          : 'Worktree (in-progress)';
        const rows = commits.map((c, idx) => {
          const files = Array.isArray(c.files) ? c.files : [];
          const commitKey = c.fullHash || c.hash || String(idx);
          const commitOpen = state.commitExpanded.has(commitKey) ? ' open' : '';
          const filesHtml = files.length
            ? '<ul class="commit-files">' + files.map((f, fileIdx) =>
                renderCommitFileRow(payload, c, f, idx, fileIdx)
              ).join('') + '</ul>'
            : '<div class="commit-files-empty">No file diff available.</div>';
          return '<details class="commit-row" data-commit-idx="' + idx + '" data-commit-key="' + escHtml(commitKey) + '"' + commitOpen + '>' +
            '<summary class="commit-summary">' +
              (payload.repoUrl && c.fullHash
                ? '<a class="commit-hash mono" href="' + escHtml(payload.repoUrl + '/commit/' + c.fullHash) + '" target="_blank" rel="noopener noreferrer" title="View on GitHub">' + escHtml(c.hash) + '</a>'
                : '<span class="commit-hash mono" data-copy-hash="' + escHtml(c.hash) + '" title="Click to copy">' + escHtml(c.hash) + '</span>') +
              '<span class="commit-message">' + escHtml(c.message || '') + '</span>' +
              '<span class="commit-meta">' + escHtml(c.author || '') + ' · ' + escHtml(formatRelativeTimestamp(c.timestamp)) + '</span>' +
            '</summary>' +
            filesHtml +
          '</details>';
        }).join('');
        detailEl.innerHTML =
          '<div class="commits-header">' +
            '<span class="commits-source">Source: ' + escHtml(sourceLabel) + '</span>' +
            '<span class="commits-count">' + String(commits.length) + ' commit' + (commits.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
          '<div class="commits-list">' + rows + '</div>';
      }

      function diffCacheKey(commitHash, filePath) {
        return String(commitHash || '') + '\u0000' + String(filePath || '');
      }

      function renderCommitFileRow(payload, commit, file, commitIdx, fileIdx) {
        const fullHash = commit.fullHash || commit.hash || '';
        const filePath = file.path || '';
        const key = diffCacheKey(fullHash, filePath);
        const expanded = state.diffExpanded.has(key);
        const cacheEntry = state.diffCache.get(key);
        const buttonLabel = expanded ? 'Hide diff' : 'View diff';
        const diffHtml = expanded ? renderDiffPanel(payload, fullHash, filePath, cacheEntry) : '';
        return '<li class="commit-file-item' + (expanded ? ' expanded' : '') + '" data-commit-idx="' + String(commitIdx) + '" data-file-idx="' + String(fileIdx) + '" title="' + escHtml(buttonLabel) + '">' +
          '<button type="button" class="commit-file-toggle" data-diff-toggle="1" aria-label="' + escHtml(buttonLabel) + '" title="' + escHtml(buttonLabel) + '">' + (expanded ? '&#9662;' : '&#9656;') + '</button>' +
          '<span class="commit-file-path mono" title="' + escHtml(filePath) + '">' + escHtml(filePath) + '</span>' +
          '<span class="commit-file-stat commit-file-add">+' + (file.added || 0) + '</span>' +
          '<span class="commit-file-stat commit-file-del">-' + (file.removed || 0) + '</span>' +
          diffHtml +
        '</li>';
      }

      function renderDiffPanel(payload, fullHash, filePath, cacheEntry) {
        if (!cacheEntry || cacheEntry.status === 'loading') {
          return '<div class="commit-file-diff"><div class="diff-placeholder">Loading diff…</div></div>';
        }
        if (cacheEntry.status === 'error') {
          return '<div class="commit-file-diff"><div class="diff-placeholder diff-error">' +
            escHtml(cacheEntry.message || 'Failed to load diff') +
            ' <button type="button" class="diff-retry" data-diff-retry="1">Retry</button>' +
            '</div></div>';
        }
        const data = cacheEntry.data || {};
        const repoUrl = data.repoUrl || (payload && payload.repoUrl);
        if (data.binary) {
          return '<div class="commit-file-diff"><div class="diff-placeholder">Binary file</div></div>';
        }
        if (!data.diff) {
          return '<div class="commit-file-diff"><div class="diff-placeholder">No textual diff available</div></div>';
        }
        const truncatedHtml = data.truncated && repoUrl && fullHash
          ? '<div class="diff-truncated">Diff truncated. <a href="' + escHtml(repoUrl + '/commit/' + fullHash) + '" target="_blank" rel="noopener noreferrer">View full diff on GitHub</a></div>'
          : (data.truncated ? '<div class="diff-truncated">Diff truncated.</div>' : '');
        return '<div class="commit-file-diff">' + renderUnifiedDiff(data.diff) + truncatedHtml + '</div>';
      }

      function renderUnifiedDiff(diffText) {
        const lines = String(diffText || '').split('\n');
        let oldLine = null;
        let newLine = null;
        const rows = lines.map(line => {
          const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (hunk) {
            oldLine = parseInt(hunk[1], 10);
            newLine = parseInt(hunk[2], 10);
            return renderDiffLine('diff-hunk', '', '', line);
          }
          if (oldLine === null || /^diff --git |^index |^--- |^\+\+\+ /.test(line)) {
            return renderDiffLine('diff-line-meta', '', '', line);
          }
          if (line[0] === '+') {
            const row = renderDiffLine('diff-line-add', '', String(newLine), line);
            newLine += 1;
            return row;
          }
          if (line[0] === '-') {
            const row = renderDiffLine('diff-line-del', String(oldLine), '', line);
            oldLine += 1;
            return row;
          }
          if (line[0] === '\\') {
            return renderDiffLine('diff-line-meta', '', '', line);
          }
          const row = renderDiffLine('diff-line-ctx', String(oldLine), String(newLine), line);
          oldLine += 1;
          newLine += 1;
          return row;
        }).join('');
        return '<div class="diff-view" role="table">' + rows + '</div>';
      }

      function renderDiffLine(cls, oldNo, newNo, text) {
        return '<div class="diff-line ' + cls + '" role="row">' +
          '<span class="diff-gutter diff-old" role="cell">' + escHtml(oldNo) + '</span>' +
          '<span class="diff-gutter diff-new" role="cell">' + escHtml(newNo) + '</span>' +
          '<span class="diff-code mono" role="cell">' + escHtml(text) + '</span>' +
        '</div>';
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

      async function fetchTranscriptsBundle() {
        const drawer = getDrawerState();
        if (drawer.type === 'feedback') return { records: [] };
        const parsed = parseEntityFromSpecPath(drawer.path, drawer.type);
        if (!parsed.id) return { records: [] };
        const q = new URLSearchParams();
        if (drawer.repoPath) q.set('repoPath', drawer.repoPath);
        const prefix = parsed.type === 'research' ? 'research' : 'features';
        const res = await fetch(`/api/${prefix}/${encodeURIComponent(parsed.id)}/transcripts?${q.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      function buildTranscriptDownloadHref(agentId, record) {
        const drawer = getDrawerState();
        const parsed = parseEntityFromSpecPath(drawer.path, drawer.type);
        if (!parsed.id) return '#';
        const q = new URLSearchParams({ agent: String(agentId || '').toLowerCase() });
        if (drawer.repoPath) q.set('repoPath', drawer.repoPath);
        if (record.agentSessionId) q.set('sessionId', record.agentSessionId);
        else if (record.sessionName) q.set('sessionName', record.sessionName);
        const seg = parsed.type === 'research' ? 'research' : 'features';
        return '/api/' + seg + '/' + encodeURIComponent(parsed.id) + '/transcripts/download?' + q.toString();
      }

      function transcriptControlsHtml(agentId, transcriptBundle) {
        const bundle = transcriptBundle || { records: [] };
        const records = Array.isArray(bundle.records) ? bundle.records : [];
        const forAgent = records.filter(r => String(r.agent || '').toLowerCase() === String(agentId || '').toLowerCase());
        if (forAgent.length === 0) {
          if (bundle._error) {
            return '<div class="transcript-row"><span class="transcript-note">Transcript list unavailable.</span></div>';
          }
          return '<div class="transcript-row"><span class="transcript-note">No indexed session for this agent.</span></div>';
        }
        const lines = forAgent.map(r => {
          if (r.captured) {
            const href = buildTranscriptDownloadHref(agentId, r);
            const label = r.sessionName
              ? String(r.sessionName)
              : (r.agentSessionId ? 'session ' + String(r.agentSessionId).slice(0, 12) : 'transcript');
            return '<div class="transcript-row">' +
              '<a class="btn btn-sm btn-secondary transcript-open-btn" href="' + href + '" download>Open transcript</a>' +
              ' <span class="mono transcript-sess">' + escHtml(label) + '</span></div>';
          }
          return '<div class="transcript-row"><span class="transcript-note">' + escHtml(r.reason || 'Not captured') + '</span></div>';
        });
        return '<div class="transcript-block">' + lines.join('') + '</div>';
      }

      function transcriptInlineOpenHtml(agentId, transcriptBundle) {
        const bundle = transcriptBundle || { records: [] };
        const records = Array.isArray(bundle.records) ? bundle.records : [];
        const forAgent = records.filter(r => String(r.agent || '').toLowerCase() === String(agentId || '').toLowerCase());
        const captured = forAgent.filter(r => r.captured);
        if (captured.length === 0) return '';
        const href = buildTranscriptDownloadHref(agentId, captured[0]);
        const extra = captured.length > 1 ? ' <span class="transcript-note">(+' + String(captured.length - 1) + ')</span>' : '';
        return '<a class="transcript-inline-link" href="' + href + '" download>Open transcript</a>' + extra;
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

      function implementedByHtml(implementedBy) {
        if (!implementedBy) return null;
        const label = typeof formatLeaseHolderLabel === 'function'
          ? formatLeaseHolderLabel(implementedBy)
          : (implementedBy.holderId || implementedBy.user || implementedBy.agentId || 'unknown');
        const hintParts = [];
        if (implementedBy.source === 'stats') hintParts.push('from close stats');
        else if (implementedBy.source === 'event-history') hintParts.push('from lease history');
        if (hintParts.length && implementedBy.acquiredAt) hintParts.push('acquired ' + formatIso(implementedBy.acquiredAt));
        const hint = hintParts.length
          ? '<div class="stats-subval">' + escHtml(hintParts.join(' · ')) + '</div>'
          : '';
        return '<div class="stats-val-main">' + escHtml(label) + '</div>' + hint;
      }

      function renderStatus(data, transcriptBundle) {
        const s = data.session || {};
        const p = data.progress || {};
        const sp = data.spec || {};
        const parsed = parseEntityFromSpecPath(getDrawerState().path, getDrawerState().type);
        const leaseHtml = parsed.id ? renderLeaseSection(parsed.type, parsed.id, getDrawerState().repoPath) : '';

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
        if (parsed.id && data.primaryAgent) {
          sessionRows.push(['Transcript', transcriptControlsHtml(data.primaryAgent, transcriptBundle)]);
        }
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
            const inlineTx = transcriptInlineOpenHtml(id, transcriptBundle);
            const upt = as.uptimeSeconds != null ? ' · ' + formatUptime(as.uptimeSeconds) : '';
            const mid = inlineTx ? ' · ' + inlineTx : '';
            return [escHtml(id), statusIndicator(as.tmuxAlive) + mid + upt];
          });
          agentSessionsHtml = statusSection('Agent Sessions', rows);
        }

        const metaHtml = statusSection('Identity', [
          ['ID', escHtml(String(data.id || ''))],
          ['Name', escHtml(data.name || '')],
          ['Lifecycle', escHtml(data.lifecycle || 'unknown')],
          ['Mode', escHtml(data.mode || 'unknown')],
          ['Primary agent', escHtml(data.primaryAgent || 'none')],
          data.implementedBy ? ['Implemented by', implementedByHtml(data.implementedBy)] : null,
          data.worktreePath ? ['Worktree', '<span class="mono">' + escHtml(data.worktreePath) + '</span>'] : null,
        ]);

        detailEl.innerHTML =
          (parsed.id ? renderDrawerRecoveryActions(parsed.type, parsed.id, getDrawerState().repoPath) : '') +
          '<div class="deep-status-grid">' +
            leaseHtml + sessionHtml + progressHtml + costHtml + specHtml + agentSessionsHtml + metaHtml +
          '</div>' +
          '<div class="deep-status-footer">Collected ' + escHtml(formatIso(data.collectedAt)) + '</div>';
        wireDrawerRecoveryActions(detailEl, parsed.type, parsed.id, getDrawerState().repoPath);
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

      function buildRelatedFeaturesMarkdown(features) {
        const list = Array.isArray(features) ? features : [];
        if (list.length === 0) return '_No features link to this research yet._';
        return list.map(f => {
          const id = f && f.id ? '#' + f.id : '#?';
          const name = f && f.name ? f.name : '(unnamed)';
          const stage = f && f.stage ? f.stage : 'unknown';
          const set = f && f.set ? ' — set: `' + f.set + '`' : '';
          return '- **' + id + '** ' + name + ' — *' + stage + '*' + set;
        }).join('\n');
      }

      function renderLog(payload) {
        const logs = Object.assign({}, (payload && payload.agentLogs) || {});
        const related = (payload && Array.isArray(payload.relatedFeatures)) ? payload.relatedFeatures : [];
        const hasFeaturesTab = related.length > 0;
        if (hasFeaturesTab) {
          logs._features = {
            path: null,
            content: buildRelatedFeaturesMarkdown(related),
          };
        }
        const agentIds = Object.keys(logs).filter(k => k !== '_features').sort();
        const ids = hasFeaturesTab ? [...agentIds, '_features'] : agentIds;
        if (ids.length === 0) {
          detailEl.innerHTML = '<div class="drawer-empty">No agent log written yet.</div>';
          return;
        }
        const labelFor = (id) => id === '_features' ? 'FEATURES' : id.toUpperCase();
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
                '<button type="button" class="log-picker-btn' + (id === state.logSelectedAgent ? ' active' : '') + '" data-log-agent="' + escHtml(id) + '">' + escHtml(labelFor(id)) + '</button>'
              ).join('') + '</div>'
            : '';
          const pathHtml = entry.path
            ? '<div class="log-path mono">' + escHtml(entry.path) + '</div>'
            : '';
          detailEl.innerHTML = pickerHtml + pathHtml + '<div class="markdown-body log-body">' + bodyHtml + '</div>';
          // Re-wire picker on every render — innerHTML replacement destroys prior listeners.
          if (ids.length > 1) {
            detailEl.querySelectorAll('.log-picker-btn').forEach(btn => {
              btn.addEventListener('click', () => {
                state.logSelectedAgent = btn.dataset.logAgent;
                renderBody();
              });
            });
          }
        };
        renderBody();
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
            let transcriptBundle = { records: [] };
            try {
              transcriptBundle = await fetchTranscriptsBundle();
            } catch (_) {
              transcriptBundle = { records: [], _error: true };
            }
            state.loadedTabs[tab] = true;
            renderStatus(deepStatus, transcriptBundle);
          } else if (tab === 'code-changes') {
            const commitsPayload = await fetchCommits();
            state.loadedTabs[tab] = true;
            renderCodeChanges(commitsPayload);
          } else {
            const payload = await fetchDetailPayload();
            let transcriptBundle = { records: [] };
            if (tab === 'agents') {
              try {
                transcriptBundle = await fetchTranscriptsBundle();
              } catch (_) {
                transcriptBundle = { records: [], _error: true };
              }
            }
            if (tab === 'stats') {
              try { payload.deepStatus = await fetchDeepStatus(); } catch (_) {}
            }
            state.loadedTabs[tab] = true;
            if (tab === 'events') renderEvents(payload);
            else if (tab === 'agents') renderAgents(payload, transcriptBundle);
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

      async function toggleCommitFileDiff(row, retry) {
        const payload = state.codeChangesPayload || {};
        const commits = Array.isArray(payload.commits) ? payload.commits : [];
        const commit = commits[Number(row && row.dataset.commitIdx)] || null;
        const file = commit && Array.isArray(commit.files) ? commit.files[Number(row.dataset.fileIdx)] : null;
        if (!commit || !file) return;
        const fullHash = commit.fullHash || commit.hash || '';
        const filePath = file.path || '';
        const key = diffCacheKey(fullHash, filePath);
        state.commitExpanded.add(fullHash || String(row && row.dataset.commitIdx));
        if (!retry && state.diffExpanded.has(key)) {
          state.diffExpanded.delete(key);
          renderCodeChanges(payload);
          return;
        }
        state.diffExpanded.add(key);
        if (!retry && state.diffCache.has(key) && state.diffCache.get(key).status === 'loaded') {
          renderCodeChanges(payload);
          return;
        }
        state.diffCache.set(key, { status: 'loading' });
        renderCodeChanges(payload);
        try {
          const data = await fetchCommitFileDiff(fullHash, filePath);
          state.diffCache.set(key, { status: 'loaded', data });
        } catch (error) {
          state.diffCache.set(key, { status: 'error', message: error && error.message ? error.message : 'Failed to load diff' });
        }
        // Skip stale re-render while a tab refresh/reload is in flight (onDrawerRefresh).
        if (!state.loading) {
          renderCodeChanges(state.codeChangesPayload || payload);
        }
      }

      detailEl.addEventListener('click', async (e) => {
        const diffBtn = e.target.closest('[data-diff-toggle], [data-diff-retry]');
        const fileRow = e.target.closest('.commit-file-item');
        if (diffBtn || (fileRow && !e.target.closest('.commit-file-diff'))) {
          e.preventDefault();
          e.stopPropagation();
          const row = diffBtn ? diffBtn.closest('.commit-file-item') : fileRow;
          const retry = !!(diffBtn && diffBtn.hasAttribute('data-diff-retry'));
          await toggleCommitFileDiff(row, retry);
          return;
        }
        const summaryEl = e.target.closest('.commit-summary');
        if (summaryEl) {
          const detailsEl = summaryEl.closest('.commit-row');
          const key = detailsEl && detailsEl.dataset.commitKey;
          if (key) {
            setTimeout(() => {
              if (detailsEl.open) state.commitExpanded.add(key);
              else state.commitExpanded.delete(key);
            }, 0);
          }
        }
        const hashEl = e.target.closest('[data-copy-hash]');
        if (hashEl) {
          e.preventDefault();
          e.stopPropagation();
          const ok = await copyText(hashEl.dataset.copyHash || '');
          showToast(ok ? 'Copied commit hash' : 'Copy failed');
          return;
        }
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
        clearData() {
          state.payload = null;
          state.loadedTabs = {};
          state.codeChangesPayload = null;
          state.commitExpanded = new Set();
          state.diffExpanded = new Set();
          state.diffCache = new Map();
        },
        getActiveTab() { return state.active; },
        onDrawerRefresh() {
          state.payload = null;
          state.loadedTabs = {};
          detailCache.clear();
          if (state.active !== 'spec') renderTab(state.active);
        }
      };
    }

// ── ESM exports (F623) ──
export { createDrawerDetailTabs };
