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
      if (state.failures === 0) { dot.style.background = '#22c55e'; text.textContent = 'Connected'; return; }
      if (state.failures < 3) { dot.style.background = '#f59e0b'; text.textContent = 'Reconnecting...'; return; }
      dot.style.background = '#ef4444'; text.textContent = 'Disconnected';
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

    // Helper: builds the "run next" button group HTML for a feature card (used via x-html)
    function buildNextActionHtml(feature, repoPath) {
      const nextActions = feature.nextActions && feature.nextActions.length > 0
        ? feature.nextActions
        : (feature.nextAction && feature.nextAction.command ? [{ command: feature.nextAction.command, label: 'Run', reason: feature.nextAction.reason || '', mode: 'fire-and-forget' }] : []);
      if (nextActions.length === 0) return '';
      const primary = nextActions[0];
      const extras = nextActions.slice(1);
      const dropdownHtml = extras.length > 0
        ? '<button class="btn btn-primary run-next-chevron" aria-haspopup="true" title="More actions">▾</button>' +
          '<div class="run-next-dropdown" role="menu">' +
          extras.map(a => '<button class="dropdown-item" data-command="' + escHtml(a.command) + '" data-mode="' + escHtml(a.mode) + '">' +
            '<span class="item-label">' + escHtml(a.label) + '</span>' +
            '<code class="item-command">' + escHtml(a.command) + '</code>' +
            '<span class="item-reason">' + escHtml(a.reason) + '</span>' +
            '</button>').join('') + '</div>'
        : '';
      // Remap raw state-machine labels ("Focus cc", "View cc") to clean button text.
      // Works from the first word so it doesn't depend on action metadata from the server.
      const NEXT_ACTION_FIRST_WORD_MAP = { Focus: 'View', Attach: 'View' };
      const firstWord = primary.label.split(' ')[0];
      const primaryLabel = NEXT_ACTION_FIRST_WORD_MAP[firstWord] || firstWord;
      return '<span class="run-next-group">' +
        '<button class="btn btn-primary run-next-primary" data-command="' + escHtml(primary.command) + '" data-mode="' + escHtml(primary.mode) + '" data-repo="' + escHtml(repoPath) + '" title="' + escHtml(primary.command) + ' — ' + escHtml(primary.reason) + '">' + escHtml(primaryLabel) + '</button>' +
        dropdownHtml + '</span>';
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
          if (this.visibleRepos.length === 0) return s.selectedRepo === 'all' ? 'No repos registered. Run: aigon conductor add' : 'No data for selected repo.';
          const hasItems = this.visibleRepos.some(r => this.getFeatures(r).length > 0 || this.getResearch(r).length > 0 || this.getFeedback(r).length > 0);
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
          const raw = [...(repo.research || [])].filter(r => r.stage === 'in-progress').sort((a, b) => featureRank(a) - featureRank(b) || Number(a.id) - Number(b.id));
          return s.filter === 'all' ? raw : raw.filter(r => r.agents.some(a => a.status === s.filter));
        },
        getFeedback(repo) {
          const s = Alpine.store('dashboard');
          const mt = s.monitorType || 'all';
          if (mt !== 'all' && mt !== 'feedback') return [];
          const raw = [...(repo.feedback || [])].filter(f => f.stage === 'in-progress').sort((a, b) => featureRank(a) - featureRank(b) || Number(a.id) - Number(b.id));
          return s.filter === 'all' ? raw : raw.filter(f => (f.agents || []).some(a => a.status === s.filter));
        },
        getTotalItems(repo) { return this.getFeatures(repo).length + this.getResearch(repo).length + this.getFeedback(repo).length; },
        sortedAgents(agents) { return [...(agents || [])].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.id.localeCompare(b.id)); },
        relTimeProxy(iso) { return relTime(iso); },
        featureTitle(feature) {
          const evalBadge = feature.stage === 'in-evaluation' ? '<span class="eval-badge' + (feature.evalStatus === 'pick winner' ? ' pick-winner' : '') + '">' + escHtml(feature.evalStatus || 'evaluating') + '</span>' : '';
          return (feature.id ? '#' + escHtml(feature.id) + ' ' : '') + escHtml(feature.name) + evalBadge;
        },
        researchTitle(item) {
          const allSubmitted = item.agents.length > 0 && item.agents.every(a => a.status === 'submitted');
          const badge = allSubmitted ? '<span class="research-badge all-submitted">ready to synthesize</span>' : '<span class="research-badge">research</span>';
          return (item.id ? 'R#' + escHtml(item.id) + ' ' : '') + escHtml(item.name) + badge;
        },
        feedbackTitle(item) { return (item.id ? 'FB#' + escHtml(item.id) + ' ' : '') + escHtml(item.name) + '<span class="research-badge">feedback</span>'; },
        researchSynthBtn(item) {
          if (!(item.agents.length > 0 && item.agents.every(a => a.status === 'submitted'))) return '';
          const synthCmd = '/ars ' + String(item.id).padStart(2, '0');
          return '<button class="copy btn btn-primary next-copy" data-copy="' + escHtml(synthCmd) + '" title="All agents submitted — synthesize findings">Copy next</button>';
        },
        buildNextActionHtml(feature, repoPath) { return buildNextActionHtml(feature, repoPath); },
        buildAskAgentHtml(repoPath) { return buildAskAgentHtml(repoPath); },
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
          const features = this.getFeatures(repo), research = this.getResearch(repo), feedback = this.getFeedback(repo);
          const total = features.length + research.length + feedback.length;
          const waitingCards = features.filter(f => f.agents.some(a => a.status === 'waiting')).length
            + research.filter(r => r.agents.some(a => a.status === 'waiting')).length
            + feedback.filter(f => (f.agents || []).some(a => a.status === 'waiting')).length;
          const collapsed = this.isCollapsed(repo.path);
          return (waitingCards ? '<span class="pill-filter waiting" style="font-size:10px;padding:1px 6px">' + waitingCards + ' waiting</span>' : '') + ' <span style="color:var(--text-tertiary);font-size:11px" aria-label="Toggle">' + (collapsed ? '▸' : '▾') + '</span>';
        },
        openFeatureSpec(e, feature) {
          if (e.target.closest('button') || e.target.closest('.btn')) return;
          if (!feature.specPath) return;
          openDrawer(feature.specPath, (feature.id ? '#' + feature.id + ' ' : '') + feature.name, feature.stage);
        },
        openSpecItem(e, item, prefix) {
          if (e.target.closest('button') || e.target.closest('.btn')) return;
          if (!item.specPath) return;
          openDrawer(item.specPath, (item.id ? prefix + item.id + ' ' : '') + item.name, 'in-progress');
        },
        copyCmd(text) { copyText(text).then(ok => showToast(ok ? 'Copied: ' + text : 'Copy failed')); },
        attachAgent(repoPath, featureId, agentId, tmuxSession) { requestAttach(repoPath, featureId, agentId, tmuxSession); },
        // Event delegation for x-html injected buttons (run-next group, synth copy btn)
        handleMonitorClick(e) {
          const btn = e.target.closest('button');
          if (!btn) return;
          if (btn.classList.contains('copy') || btn.classList.contains('next-copy')) {
            const text = btn.getAttribute('data-copy') || '';
            if (text) copyText(text).then(ok => showToast(ok ? 'Copied: ' + text : 'Copy failed'));
            return;
          }
          if (btn.classList.contains('run-next-primary')) {
            e.stopPropagation();
            executeNextAction(btn.getAttribute('data-command') || '', btn.getAttribute('data-mode') || 'fire-and-forget', btn.getAttribute('data-repo') || '', btn);
            return;
          }
          if (btn.classList.contains('run-next-chevron')) {
            e.stopPropagation();
            const group = btn.closest('.run-next-group');
            const dropdown = group && group.querySelector('.run-next-dropdown');
            if (!dropdown) return;
            const isOpen = dropdown.classList.contains('open');
            document.querySelectorAll('.run-next-dropdown.open').forEach(d => d.classList.remove('open'));
            if (!isOpen) {
              dropdown.classList.add('open');
              setTimeout(() => document.addEventListener('click', function close(ev) {
                if (!group.contains(ev.target)) { dropdown.classList.remove('open'); document.removeEventListener('click', close); }
              }), 0);
            }
            return;
          }
          if (btn.classList.contains('dropdown-item')) {
            e.stopPropagation();
            const group = btn.closest('.run-next-group');
            const primaryBtn = group && group.querySelector('.run-next-primary');
            const repoPath = primaryBtn ? primaryBtn.getAttribute('data-repo') || '' : '';
            const dropdown = btn.closest('.run-next-dropdown');
            if (dropdown) dropdown.classList.remove('open');
            executeNextAction(btn.getAttribute('data-command') || '', btn.getAttribute('data-mode') || 'fire-and-forget', repoPath, primaryBtn || btn);
          }
        }
      };
    }


