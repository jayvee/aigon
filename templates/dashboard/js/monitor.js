    // ── Shared render helpers ─────────────────────────────────────────────────

    function updateTitleAndFavicon(waiting){
      document.title = waiting > 0 ? '(' + waiting + ') Aigon Dashboard' : 'Aigon Dashboard';
      const link = document.querySelector('link[rel="icon"]') || (() => { const x = document.createElement('link'); x.rel = 'icon'; document.head.appendChild(x); return x; })();
      if (!waiting) { link.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22></svg>'; return; }
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#111113'; ctx.fillRect(0,0,32,32);
      ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(16,16,13,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(String(waiting > 99 ? '99+' : waiting), 16, 16);
      link.href = c.toDataURL('image/png');
    }

    function setHealth() {
      const dot = document.getElementById('health-dot');
      const text = document.getElementById('health-text');
      if (state.failures === 0) {
        dot.style.background = '#22c55e';
        // feature 234: if we were showing the restart banner, a successful poll
        // means the new server is up — clear it.
        if (state.serverRestarting) hideServerRestartBanner();
        text.textContent = 'Connected';
        return;
      }
      if (state.failures < 3) { dot.style.background = '#f59e0b'; text.textContent = 'Reconnecting...'; return; }
      dot.style.background = '#ef4444'; text.textContent = 'Disconnected';
    }

    // feature 234: transient banner shown while the dashboard server restarts
    // after a lib/*.js merge. Created lazily so it doesn't clutter index.html.
    function showServerRestartBanner() {
      state.serverRestarting = true;
      let el = document.getElementById('server-restart-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'server-restart-banner';
        el.setAttribute('role', 'status');
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 14px;background:#1e3a8a;color:#fff;text-align:center;font-size:13px;z-index:9999;box-shadow:0 2px 6px rgba(0,0,0,.25);';
        el.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span>Reloading backend…';
        if (!document.getElementById('server-restart-banner-style')) {
          const style = document.createElement('style');
          style.id = 'server-restart-banner-style';
          style.textContent = '@keyframes spin{to{transform:rotate(360deg);}}';
          document.head.appendChild(style);
        }
        document.body.appendChild(el);
      }
    }

    function hideServerRestartBanner() {
      state.serverRestarting = false;
      const el = document.getElementById('server-restart-banner');
      if (el) el.remove();
    }

    function updateViewTabs() {
      document.querySelectorAll('.view-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-view') === state.view);
      });
    }

    function getVisibleRepos(data) {
      if (!data || !data.repos) return [];
      const hidden = state.hiddenRepos || [];
      if (state.selectedRepo === 'all') return data.repos.filter(r => !hidden.includes(r.path));
      return data.repos.filter(r => r.path === state.selectedRepo);
    }

    // ── Monitor view — Alpine component ──────────────────────────────────────

    // Helper: builds unified action buttons for a feature card (used via x-html).
    // Delegates to the shared renderActionButtons() from actions.js, wrapping in
    // a container with data-repo for event delegation.
    function buildMonitorActionHtml(feature, repoPath) {
      const pipelineType = feature.stage ? 'features' : 'features';
      const html = renderActionButtons(feature, repoPath, pipelineType);
      if (!html) return '';
      return '<span class="monitor-actions" data-repo="' + escHtml(repoPath) + '" data-feature-id="' + escHtml(feature.id) + '">' + html + '</span>';
    }

    function buildSetActionHtml(setCard, repoPath) {
      const html = renderActionButtons(setCard, repoPath, 'sets');
      if (!html) return '';
      return '<span class="monitor-actions" data-repo="' + escHtml(repoPath) + '" data-set-slug="' + escHtml(setCard.slug) + '">' + html + '</span>';
    }

    function buildSetCardHtml(setCard) {
      const renderer = window.AIGON_SET_CARDS;
      if (!renderer || typeof renderer.buildSetCardBodyHtml !== 'function') return '';
      return renderer.buildSetCardBodyHtml(setCard);
    }

    // Render the amber "awaiting your input" badge + tooltip for a card.
    // Shows the first agent on the card that is paused. Tooltip offers a
    // copy-attach-command button so the user can jump into the tmux session.
    function buildAwaitingBadgeHtml(item) {
      if (!item || !item.anyAwaitingInput) return '';
      const agent = (item.agents || []).find(a => a && a.awaitingInput && a.awaitingInput.message);
      if (!agent) return '';
      const name = (window.AGENT_DISPLAY_NAMES && window.AGENT_DISPLAY_NAMES[agent.id]) || agent.id;
      const msg = agent.awaitingInput.message;
      const attach = agent.attachCommand || '';
      const attachBtn = attach
        ? '<button class="btn btn-xs copy" data-copy="' + escHtml(attach) + '" x-on:click.stop type="button">Copy attach</button>'
        : '';
      return '<span class="awaiting-badge" role="status" tabindex="0" aria-label="Awaiting your input: ' + escHtml(msg) + '" x-on:click.stop>'
        + 'Awaiting input'
        + '<span class="awaiting-tip">'
          + '<span class="awaiting-tip-who">' + escHtml(name) + ' is waiting for you</span>'
          + '<span class="awaiting-tip-msg">' + escHtml(msg) + '</span>'
          + (attachBtn ? '<span class="awaiting-tip-cmd">' + attachBtn + '</span>' : '')
        + '</span>'
      + '</span>';
    }

    // Supervisor-derived workflow idle (no progress signals while tmux alive) — display only.
    function buildWorkflowIdleBadgeHtml(item) {
      if (!item || !item.agents) return '';
      const agent = item.agents.find(a => a && a.idleState && a.idleState.level);
      if (!agent) return '';
      const name = (window.AGENT_DISPLAY_NAMES && window.AGENT_DISPLAY_NAMES[agent.id]) || agent.id;
      const mins = agent.idleState.idleMinutes;
      const lvl = agent.idleState.level;
      const tip = name + ' — no workflow progress for ~' + mins + ' min (tmux still running). Threshold: ' + lvl + '.';
      return '<span class="workflow-idle-badge" role="status" tabindex="0" aria-label="' + escHtml(tip) + '" x-on:click.stop>'
        + 'Awaiting input'
        + '<span class="workflow-idle-tip">'
          + '<span class="workflow-idle-tip-title">Workflow idle</span>'
          + '<span class="workflow-idle-tip-msg">' + escHtml(tip) + '</span>'
        + '</span>'
      + '</span>';
    }

    function monitorView() {
      return {
        monitorTypeOpts: [
          { key: 'all', label: 'All' },
          { key: 'features', label: 'Features' },
          { key: 'research', label: 'Research' },
          { key: 'feedback', label: 'Feedback' }
        ],
        get visibleRepos() { return getVisibleRepos(Alpine.store('dashboard').data || { repos: [] }); },
        get computedSummary() {
          const s = Alpine.store('dashboard');
          const data = s.data || { repos: [], summary: { implementing: 0, waiting: 0, submitted: 0, error: 0 } };
          if (s.selectedRepo === 'all') return data.summary || { implementing: 0, waiting: 0, submitted: 0, error: 0 };
          const summary = { implementing: 0, waiting: 0, submitted: 0, error: 0 };
          const monitorType = s.monitorType || 'all';
          const itemTypes = monitorType === 'all' ? ['features', 'research', 'feedback'] : [monitorType];
          this.visibleRepos.forEach(repo => {
            itemTypes.forEach(t => { (repo[t] || []).forEach(item => { (item.agents || []).forEach(a => { if (summary[a.status] !== undefined) summary[a.status]++; }); }); });
          });
          return summary;
        },
        get emptyMessage() {
          const s = Alpine.store('dashboard');
          if (this.visibleRepos.length === 0) return s.selectedRepo === 'all' ? 'No repos registered. Run: aigon server add' : 'No data for selected repo.';
          const hasItems = this.visibleRepos.some(r => this.getSets(r).length > 0 || this.getFeatures(r).length > 0 || this.getResearch(r).length > 0 || this.getFeedback(r).length > 0);
          if (hasItems) return '';
          return s.filter === 'all' ? 'No items in progress.' : 'No items match filter: ' + s.filter;
        },
        isCollapsed(path) { return !!(Alpine.store('dashboard').collapsed || {})[path]; },
        toggleCollapse(path) {
          const s = Alpine.store('dashboard');
          s.collapsed[path] = !s.collapsed[path];
          localStorage.setItem(lsKey('collapsed'), JSON.stringify(s.collapsed));
        },
        setFilter(f) { Alpine.store('dashboard').filter = f; localStorage.setItem(lsKey('filter'), f); },
        setMonitorType(t) { Alpine.store('dashboard').monitorType = t; localStorage.setItem(lsKey('monitorType'), t); },
        getSets(repo) {
          return [...(repo.sets || [])].sort((a, b) => {
            const rank = (set) => {
              if (set.status === 'running') return 0;
              if (set.status === 'paused-on-failure') return 1;
              return 2;
            };
            return rank(a) - rank(b) || String(a.slug || '').localeCompare(String(b.slug || ''));
          });
        },
        getFeatures(repo) {
          const s = Alpine.store('dashboard');
          const mt = s.monitorType || 'all';
          if (mt !== 'all' && mt !== 'features') return [];
          const raw = [...(repo.features || [])].filter(f => f.stage === 'in-progress' || f.stage === 'in-evaluation').sort((a, b) => featureRank(a) - featureRank(b) || Number(a.id) - Number(b.id));
          return s.filter === 'all' ? raw : raw.filter(f => f.agents.some(a => a.status === s.filter));
        },
        getResearch(repo) {
          const s = Alpine.store('dashboard');
          const mt = s.monitorType || 'all';
          if (mt !== 'all' && mt !== 'research') return [];
          const raw = [...(repo.research || [])].filter(r => r.stage === 'in-progress' || r.stage === 'in-evaluation').sort((a, b) => featureRank(a) - featureRank(b) || Number(a.id) - Number(b.id));
          return s.filter === 'all' ? raw : raw.filter(r => r.agents.some(a => a.status === s.filter));
        },
        getFeedback(repo) {
          const s = Alpine.store('dashboard');
          const mt = s.monitorType || 'all';
          if (mt !== 'all' && mt !== 'feedback') return [];
          const raw = [...(repo.feedback || [])].filter(f => f.stage === 'in-progress').sort((a, b) => featureRank(a) - featureRank(b) || Number(a.id) - Number(b.id));
          return s.filter === 'all' ? raw : raw.filter(f => (f.agents || []).some(a => a.status === s.filter));
        },
        getTotalItems(repo) { return this.getSets(repo).length + this.getFeatures(repo).length + this.getResearch(repo).length + this.getFeedback(repo).length; },
        sortedAgents(agents) { return [...(agents || [])].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.id.localeCompare(b.id)); },
        relTimeProxy(iso) { return relTime(iso); },
        buildSetActionHtml(setCard, repoPath) { return buildSetActionHtml(setCard, repoPath); },
        buildSetCardHtml(setCard) { return buildSetCardHtml(setCard); },
        featureTitle(feature) {
          const evalBadge = feature.stage === 'in-evaluation' ? '<span class="eval-badge' + (feature.evalStatus === 'pick winner' ? ' pick-winner' : '') + '">' + escHtml(feature.evalStatus || 'evaluating') + '</span>' : '';
          const autoBadge = feature.autonomousSession && feature.autonomousSession.running
            ? '<span class="autonomous-badge">Running autonomously</span>'
            : '';
          const complexityBadge = typeof complexityBadgeHtml === 'function' ? complexityBadgeHtml(feature.complexity) : '';
          return (feature.id ? '#' + escHtml(feature.id) + ' ' : '') + escHtml(feature.name) + complexityBadge + autoBadge + evalBadge;
        },
        researchTitle(item) {
          const readyToEval = (item.validActions || []).some(a => a.action === 'research-eval');
          const inEval = item.stage === 'in-evaluation';
          const badge = inEval ? '<span class="eval-badge">evaluating</span>'
            : readyToEval ? '<span class="research-badge all-submitted">ready to evaluate</span>'
            : '<span class="research-badge">research</span>';
          const complexityBadge = typeof complexityBadgeHtml === 'function' ? complexityBadgeHtml(item.complexity) : '';
          return (item.id ? 'R#' + escHtml(item.id) + ' ' : '') + escHtml(item.name) + complexityBadge + badge;
        },
        feedbackTitle(item) { return (item.id ? 'FB#' + escHtml(item.id) + ' ' : '') + escHtml(item.name) + '<span class="research-badge">feedback</span>'; },
        researchEvalBtn(item) {
          if (!(item.validActions || []).some(a => a.action === 'research-eval')) return '';
          const evalCmd = '/are ' + String(item.id).padStart(2, '0');
          return '<button class="copy btn btn-primary next-copy" data-copy="' + escHtml(evalCmd) + '" title="All agents submitted — evaluate findings">Copy next</button>';
        },
        buildNextActionHtml(feature, repoPath) { return buildMonitorActionHtml(feature, repoPath); },
        buildAgentOverflowHtml(agent, feature, repoPath) {
          const canStartDevServer = !agent.devServerUrl && agent.devServerEligible && agent.worktreePath;
          if (!canStartDevServer) return '';
          const items = '<button class="kcard-overflow-item kcard-overflow-item-neutral monitor-dev-server-start" ' +
            'data-dev-server-start="1" data-worktree-path="' + escHtml(agent.worktreePath) + '" data-repo-path="' + escHtml(repoPath || '') + '">' +
            'Start Dev Server</button>';
          return '<div class="kcard-overflow"><button class="btn btn-overflow kcard-overflow-toggle" type="button">⋯</button><div class="kcard-overflow-menu">' + items + '</div></div>';
        },
        buildAskAgentHtml(repoPath) { return buildAskAgentHtml(repoPath); },
        buildMainDevServerHtml(repo) { return buildMainDevServerHtml(repo); },
        buildAwaitingBadgeHtml(item) { return buildAwaitingBadgeHtml(item); },
        buildWorkflowIdleBadgeHtml(item) { return buildWorkflowIdleBadgeHtml(item); },
        handleAskClick(e) {
          const btn = e.target.closest('[data-ask-run]');
          if (btn) { runAskAgent(btn.dataset.askRepo, btn.dataset.askRun); return; }
          const tog = e.target.closest('[data-ask-toggle]');
          if (tog) {
            const group = tog.closest('.ask-agent-group');
            const dd = group && group.querySelector('.ask-agent-dropdown');
            document.querySelectorAll('.ask-agent-dropdown.open').forEach(d => { if (d !== dd) d.classList.remove('open'); });
            dd && dd.classList.toggle('open');
            return;
          }
          const opt = e.target.closest('[data-ask-agent]');
          if (opt) {
            setAskAgent(opt.dataset.askAgent);
            runAskAgent(opt.dataset.askRepo, opt.dataset.askAgent);
            document.querySelectorAll('.ask-agent-dropdown.open').forEach(d => d.classList.remove('open'));
          }
        },
        repoSummaryText(repo) {
          const sets = this.getSets(repo), features = this.getFeatures(repo), research = this.getResearch(repo), feedback = this.getFeedback(repo);
          const total = sets.length + features.length + research.length + feedback.length;
          const waitingCards = features.filter(f => f.agents.some(a => a.status === 'waiting')).length
            + research.filter(r => r.agents.some(a => a.status === 'waiting')).length
            + feedback.filter(f => (f.agents || []).some(a => a.status === 'waiting')).length;
          const collapsed = this.isCollapsed(repo.path);
          const setBadge = sets.length > 0
            ? '<span class="pill-filter" style="font-size:10px;padding:1px 6px">' + sets.length + ' sets</span>'
            : '';
          return (setBadge || '') + (waitingCards ? '<span class="pill-filter waiting" style="font-size:10px;padding:1px 6px">' + waitingCards + ' waiting</span>' : '') + ' <span style="color:var(--text-tertiary);font-size:11px" aria-label="Toggle">' + (collapsed ? '▸' : '▾') + '</span>';
        },
        openFeatureSpec(e, feature) {
          if (e.target.closest('button') || e.target.closest('.btn')) return;
          if (!feature.specPath) return;
          openDrawer(feature.specPath, feature.name, feature.stage);
        },
        openSpecItem(e, item, prefix) {
          if (e.target.closest('button') || e.target.closest('.btn')) return;
          if (!item.specPath) return;
          openDrawer(item.specPath, item.name, 'in-progress');
        },
        copyCmd(text) { copyText(text).then(ok => showToast(ok ? 'Copied: ' + text : 'Copy failed')); },
        attachAgent(repoPath, featureId, agentId, tmuxSession) { requestAttach(repoPath, featureId, agentId, tmuxSession); },
        // Event delegation for x-html injected buttons (unified actions, synth copy btn)
        handleMonitorClick(e) {
          const btn = e.target.closest('button');
          if (!btn) return;
          if (btn.classList.contains('copy') || btn.classList.contains('next-copy')) {
            const text = btn.getAttribute('data-copy') || '';
            if (text) copyText(text).then(ok => showToast(ok ? 'Copied: ' + text : 'Copy failed'));
            return;
          }
          // Unified validAction buttons (from renderActionButtons)
          if (btn.classList.contains('kcard-va-btn')) {
            e.stopPropagation();
            const container = btn.closest('.monitor-actions');
            const repoPath = container ? container.getAttribute('data-repo') || '' : '';
            const setSlug = container ? container.getAttribute('data-set-slug') || '' : '';
            if (setSlug) {
              const s = Alpine.store('dashboard');
              const data = s.data || { repos: [] };
              let setCard = null;
              for (const repo of (data.repos || [])) {
                setCard = (repo.sets || []).find(item => String(item.slug) === String(setSlug));
                if (setCard) break;
              }
              if (!setCard) return;
              const vaAction = btn.getAttribute('data-va-action') || '';
              const va = (setCard.validActions || []).find(a => a.action === vaAction) || { action: vaAction, label: btn.textContent };
              btn._origText = btn.textContent;
              handleSetAction(va, setCard, repoPath, btn);
              return;
            }
            const featureId = container ? container.getAttribute('data-feature-id') || '' : '';
            const vaAction = btn.getAttribute('data-va-action') || '';
            const vaAgentId = btn.getAttribute('data-agent') || null;
            // Find the card payload from Alpine store (same repo row as this monitor-actions strip).
            const s = Alpine.store('dashboard');
            const data = s.data || { repos: [] };
            // REGRESSION: research/feedback rows must not use pipelineType "features" — pCmd() and open-session routing depend on the real bucket.
            const repoCandidates = repoPath
              ? (data.repos || []).filter(r => r.path === repoPath)
              : (data.repos || []);
            let feature = null;
            let pipelineTypeForCard = 'features';
            for (const repo of (repoCandidates.length ? repoCandidates : data.repos || [])) {
              const fHit = (repo.features || []).find(x => String(x.id) === String(featureId));
              if (fHit) { feature = fHit; pipelineTypeForCard = 'features'; break; }
              const rHit = (repo.research || []).find(x => String(x.id) === String(featureId));
              if (rHit) { feature = rHit; pipelineTypeForCard = 'research'; break; }
              const fbHit = (repo.feedback || []).find(x => String(x.id) === String(featureId));
              if (fbHit) { feature = fbHit; pipelineTypeForCard = 'feedback'; break; }
            }
            if (!feature) return;
            const va = (feature.validActions || []).find(a => a.action === vaAction && (a.agentId || null) === vaAgentId) || { action: vaAction, agentId: vaAgentId, label: btn.textContent };
            btn._origText = btn.textContent;
            handleFeatureAction(va, feature, repoPath, btn, pipelineTypeForCard);
            return;
          }
          if (btn.dataset.devServerStart === '1') {
            e.stopPropagation();
            const worktreePath = btn.dataset.worktreePath || '';
            const repoPath = btn.dataset.repoPath || '';
            if (!worktreePath) return;
            btn._origText = btn.textContent;
            requestAction('dev-server', ['start', '--worktree', worktreePath], repoPath, btn);
            return;
          }
          // Overflow toggle
          if (btn.classList.contains('kcard-overflow-toggle')) {
            e.stopPropagation();
            const menu = btn.parentElement.querySelector('.kcard-overflow-menu');
            const isOpen = menu && menu.classList.contains('open');
            document.querySelectorAll('.kcard-overflow-menu.open').forEach(m => m.classList.remove('open'));
            if (!isOpen && menu) {
              menu.classList.add('open');
              setTimeout(() => document.addEventListener('click', function close(ev) {
                if (!btn.parentElement.contains(ev.target)) { menu.classList.remove('open'); document.removeEventListener('click', close); }
              }), 0);
            }
            return;
          }
        }
      };
    }
