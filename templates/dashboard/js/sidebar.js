    // ── AI session picker ──────────────────────────────────────────────────────

    // ── Ask-agent helpers ─────────────────────────────────────────────────────

    const ASK_AGENTS = (Array.isArray(window.__AIGON_AGENTS__) ? window.__AIGON_AGENTS__ : []).map(agent => ({
      id: agent.id,
      name: agent.displayName || agent.id
    }));

    function getAskAgent() {
      const preferred = localStorage.getItem(lsKey('askAgent'));
      if (preferred && ASK_AGENTS.some(agent => agent.id === preferred)) return preferred;
      return ASK_AGENTS[0] ? ASK_AGENTS[0].id : 'cc';
    }
    function setAskAgent(id) { localStorage.setItem(lsKey('askAgent'), id); }

    function buildAskAgentHtml(repoPath) {
      const agentId = getAskAgent();
      const others = ASK_AGENTS.filter(a => a.id !== agentId);
      const escapedRepo = escHtml(repoPath);
      const otherItems = others.map(a =>
        '<button class="ask-agent-option" data-ask-agent="' + a.id + '" data-ask-repo="' + escapedRepo + '">' +
        escHtml(a.id) + ' · ' + escHtml(a.name) + '</button>'
      ).join('');
      return '<span class="ask-agent-group">' +
        '<button class="btn ask-agent-primary" data-ask-run="' + escHtml(agentId) + '" data-ask-repo="' + escapedRepo + '">Ask ' + escHtml(agentId) + '</button>' +
        '<button class="btn ask-agent-chevron" data-ask-toggle data-ask-repo="' + escapedRepo + '">▾</button>' +
        '<div class="ask-agent-dropdown">' + otherItems + '</div>' +
        '</span>';
    }

    function buildGlobeIconSvg() {
      return '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"></circle>' +
        '<path d="M2 8h12M8 2c1.8 1.7 2.8 3.8 2.8 6S9.8 12.3 8 14M8 2C6.2 3.7 5.2 5.8 5.2 8s1 4.3 2.8 6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"></path>' +
      '</svg>';
    }

    function buildMainDevServerHtml(repo) {
      if (!repo || !repo.mainDevServerEligible) return '';
      const icon = buildGlobeIconSvg();
      const repoPath = escHtml(repo.path || '');
      if (repo.mainDevServerRunning && repo.mainDevServerUrl) {
        const safeUrl = escHtml(repo.mainDevServerUrl);
        return '<a class="monitor-dev-link repo-dev-link repo-dev-link-running" href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" title="' + safeUrl + '" aria-label="Open main dev server">' +
          icon +
        '</a>';
      }
      return '<button class="btn repo-dev-link repo-dev-link-idle" type="button" data-main-dev-start="' + repoPath + '" title="Start dev server" aria-label="Start main dev server">' +
        icon +
      '</button>';
    }

    async function runAskAgent(repoPath, agentId) {
      const res = await fetch('/api/session/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath, agentId })
      }).catch(() => null);
      if (!res || !res.ok) {
        const data = res ? await res.json().catch(() => ({})) : {};
        showToast('Failed to start session: ' + (data.error || 'Unknown'), null, null, { error: true });
      }
    }

    // Event delegation for ask-agent buttons (rendered via innerHTML)
    document.addEventListener('click', (e) => {
      // Close open dropdowns when clicking outside
      const group = e.target.closest('.ask-agent-group');
      if (!group) {
        document.querySelectorAll('.ask-agent-dropdown.open').forEach(d => d.classList.remove('open'));
        return;
      }
      if (e.target.closest('[data-ask-run]')) {
        const btn = e.target.closest('[data-ask-run]');
        runAskAgent(btn.dataset.askRepo, btn.dataset.askRun);
        return;
      }
      if (e.target.closest('[data-ask-toggle]')) {
        const dropdown = group.querySelector('.ask-agent-dropdown');
        document.querySelectorAll('.ask-agent-dropdown.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
        dropdown && dropdown.classList.toggle('open');
        return;
      }
      if (e.target.closest('[data-ask-agent]')) {
        const btn = e.target.closest('[data-ask-agent]');
        setAskAgent(btn.dataset.askAgent);
        runAskAgent(btn.dataset.askRepo, btn.dataset.askAgent);
        document.querySelectorAll('.ask-agent-dropdown.open').forEach(d => d.classList.remove('open'));
      }
    });

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-main-dev-start]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      await requestRepoMainDevServerStart(btn.getAttribute('data-main-dev-start') || '', btn);
    });

    // ── Agent picker ──────────────────────────────────────────────────────────

    let pickerResolve = null;
    let pickerSingleMode = false;
    let pickerCollectTriplet = false;

    function fetchAgentModels(repoPath) {
      const params = new URLSearchParams();
      if (repoPath) params.set('repoPath', repoPath);
      else params.set('globalOnly', '1');
      const query = params.toString();
      return fetch('/api/settings?' + query, { cache: 'no-store' })
        .then(r => r.json())
        .then(data => {
          const agentModelMap = {};
          const settings = (data && data.settings) || [];
          settings.forEach(def => {
            const m = String(def.key || '').match(/^agents\.(\w+)\.(research|implement|evaluate|review)\.model$/);
            if (!m) return;
            const agentId = m[1];
            const taskType = m[2];
            if (!agentModelMap[agentId]) agentModelMap[agentId] = {};
            if (def.effectiveValue) agentModelMap[agentId][taskType] = def.effectiveValue;
          });
          return agentModelMap;
        })
        .catch(() => ({}));
    }

    function pickerTaskType(opts) {
      if (opts.taskType === 'research' || opts.taskType === 'implement' || opts.taskType === 'evaluate' || opts.taskType === 'review') return opts.taskType;
      const action = String(opts.action || opts.sessionTask || '').toLowerCase();
      if (action.includes('review')) return 'review';
      if (action.includes('eval')) return 'evaluate';
      return 'implement';
    }

    function showAgentPicker(featureId, featureName, options) {
      const opts = options || {};
      pickerSingleMode = !!opts.single;
      pickerCollectTriplet = !!opts.collectTriplet;
      const implAgents = opts.implementingAgents || [];
      const taskType = pickerTaskType(opts);
      // Re-render rows to toggle triplet dropdowns on/off for this invocation.
      renderAgentPickerRows({ collectTriplet: pickerCollectTriplet });
      return fetchAgentModels(opts.repoPath).then(models => new Promise((resolve) => {
        pickerResolve = resolve;
        document.getElementById('agent-picker-title').textContent = opts.title || 'Select Agents';
        document.getElementById('agent-picker-desc').textContent = '#' + featureId + ' ' + featureName;
        const rows = document.querySelectorAll('#agent-picker .agent-checks .agent-check-row');
        rows.forEach(row => {
          const cb = row.querySelector('input');
          cb.checked = false;
          cb.type = pickerSingleMode ? 'radio' : 'checkbox';
          cb.name = pickerSingleMode ? 'agent-pick' : '';
          if (opts.preselect && cb.value === opts.preselect) cb.checked = true;
          // Remove any existing badge
          const existing = row.querySelector('.agent-check-badge');
          if (existing) existing.remove();
          // Add implementing badge if applicable
          if (implAgents.includes(cb.value)) {
            const badge = document.createElement('span');
            badge.className = 'agent-check-badge';
            badge.textContent = 'implemented';
            const hint = row.querySelector('.agent-check-hint');
            const label = row.querySelector('.agent-check-label');
            if (hint) hint.before(badge);
            else if (label) label.after(badge);
            else row.querySelector('.agent-check-meta') && row.querySelector('.agent-check-meta').appendChild(badge);
          }
          // Show model name for this task type
          let modelEl = row.querySelector('.agent-check-config-model') || row.querySelector('.agent-check-model');
          const modelName = (models[cb.value] && models[cb.value][taskType]) || '';
          if (modelName) {
            if (!modelEl) {
              modelEl = document.createElement('span');
              modelEl.className = row.classList.contains('agent-check-row-triplet') ? 'agent-check-config-model' : 'agent-check-model';
              const hint = row.querySelector('.agent-check-hint');
              if (hint) hint.after(modelEl); else row.appendChild(modelEl);
            }
            modelEl.textContent = modelName;
          } else if (modelEl) {
            if (modelEl.classList.contains('agent-check-config-model')) modelEl.textContent = '';
            else modelEl.remove();
          }
        });
        document.getElementById('agent-picker-submit').textContent = opts.submitLabel || 'Start';
        document.getElementById('agent-picker').style.display = 'flex';
        document.getElementById('agent-picker-submit').focus();
      }));
    }

    function hideAgentPicker(result) {
      document.getElementById('agent-picker').style.display = 'none';
      if (pickerResolve) { pickerResolve(result); pickerResolve = null; }
    }

    document.getElementById('agent-picker-cancel').onclick = () => hideAgentPicker(null);
    document.getElementById('agent-picker').onclick = (e) => { if (e.target === e.currentTarget) hideAgentPicker(null); };
    document.getElementById('agent-picker-submit').onclick = () => {
      const inputType = pickerSingleMode ? 'radio' : 'checkbox';
      const checkedInputs = [...document.querySelectorAll('#agent-picker input[type=' + inputType + ']:checked')];
      if (checkedInputs.length === 0) { showToast('Select at least one agent'); return; }
      if (pickerCollectTriplet) {
        const triplets = checkedInputs.map(cb => {
          const row = cb.closest('.agent-check-row');
          const modelSel = row ? row.querySelector('.agent-triplet-model') : null;
          const effortSel = row ? row.querySelector('.agent-triplet-effort') : null;
          return {
            id: cb.value,
            model: modelSel && modelSel.value ? modelSel.value : null,
            effort: effortSel && effortSel.value ? effortSel.value : null,
          };
        });
        hideAgentPicker(triplets);
      } else {
        hideAgentPicker(checkedInputs.map(cb => cb.value));
      }
    };

    // ── Repo sidebar ──────────────────────────────────────────────────────────

    function selectRepo(repoPath) {
      state.selectedRepo = repoPath;
      localStorage.setItem(lsKey('selectedRepo'), repoPath);
      // Sync mobile dropdown
      const mobile = document.getElementById('repo-select-mobile');
      if (mobile) mobile.value = repoPath;
      render();
    }

    function getRepoStats(repo) {
      const allItems = [...(repo.features || []), ...(repo.research || []), ...(repo.feedback || [])];
      const activeItems = allItems.filter(f => f.stage !== 'done');
      const totalItems = activeItems.length;
      const hasWaiting = allItems.some(f => (f.agents || []).some(a => a.status === 'waiting'));
      const hasError = allItems.some(f => (f.agents || []).some(a => a.status === 'error'));
      const featureCount = (repo.features || []).filter(f => f.stage !== 'done').length;
      const researchCount = (repo.research || []).filter(f => f.stage !== 'done').length;
      const feedbackCount = (repo.feedback || []).filter(f => f.stage !== 'done').length;
      const waitingCount = allItems.filter(f => (f.agents || []).some(a => a.status === 'waiting')).length;
      const errorCount = allItems.filter(f => (f.agents || []).some(a => a.status === 'error')).length;
      return { totalItems, featureCount, researchCount, feedbackCount, hasWaiting, hasError, waitingCount, errorCount };
    }

    function renderSidebar(repos, options) {
      const opts = options || {};
      const includeAll = opts.includeAll !== false;
      const sidebar = document.getElementById('repo-sidebar');
      const mobile = document.getElementById('repo-select-mobile');
      const hadFocus = sidebar.contains(document.activeElement);
      sidebar.innerHTML = '';
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'sidebar-resize';
      resizeHandle.id = 'sidebar-resize';
      sidebar.appendChild(resizeHandle);
      mobile.innerHTML = '';

      // Sort repos: active agents first, then by most recent activity
      const sorted = [...(repos || [])].sort((a, b) => {
        const aItems = [...(a.features || []), ...(a.research || [])];
        const bItems = [...(b.features || []), ...(b.research || [])];
        const aRunning = aItems.some(f => (f.agents || []).some(ag => ag.status === 'implementing'));
        const bRunning = bItems.some(f => (f.agents || []).some(ag => ag.status === 'implementing'));
        if (aRunning !== bRunning) return aRunning ? -1 : 1;
        const aActive = aItems.filter(f => f.stage === 'in-progress' || f.stage === 'in-evaluation').length;
        const bActive = bItems.filter(f => f.stage === 'in-progress' || f.stage === 'in-evaluation').length;
        if (aActive !== bActive) return bActive - aActive;
        const latestTime = items => Math.max(0, ...items.flatMap(f => (f.agents || []).map(ag => new Date(ag.updatedAt || 0).getTime())));
        return latestTime(bItems) - latestTime(aItems);
      });

      if (includeAll) {
        const allBtn = document.createElement('button');
        allBtn.className = 'sidebar-item' + (state.selectedRepo === 'all' ? ' active' : '');
        allBtn.setAttribute('role', 'option');
        allBtn.setAttribute('aria-selected', state.selectedRepo === 'all' ? 'true' : 'false');
        allBtn.setAttribute('tabindex', state.selectedRepo === 'all' ? '0' : '-1');
        allBtn.innerHTML = '<span class="sidebar-name">All Repos</span>';
        allBtn.onclick = () => selectRepo('all');
        sidebar.appendChild(allBtn);

        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = 'All Repos';
        mobile.appendChild(allOpt);
      }

      // Per-repo items
      sorted.forEach(repo => {
        const hidden = isRepoHidden(repo.path);
        if (hidden) return; // skip hidden repos from sidebar
        const stats = getRepoStats(repo);
        const isActive = state.selectedRepo === repo.path;

        const btn = document.createElement('button');
        btn.className = 'sidebar-item' + (isActive ? ' active' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
        btn.title = repo.displayPath;

        let indicatorsHtml = '';
        if (stats.hasError) indicatorsHtml += '<span class="sidebar-dot error"></span>';
        else if (stats.hasWaiting) indicatorsHtml += '<span class="sidebar-dot waiting"></span>';
        if (stats.totalItems > 0) indicatorsHtml += '<span class="sidebar-badge">' + stats.totalItems + '</span>';

        btn.innerHTML = '<span class="sidebar-name">' + escHtml(repo.name) + '</span>' +
          (indicatorsHtml ? '<span class="sidebar-indicators">' + indicatorsHtml + '</span>' : '');
        btn.onclick = () => selectRepo(repo.path);
        sidebar.appendChild(btn);

        const opt = document.createElement('option');
        opt.value = repo.path;
        opt.textContent = repo.displayPath + (stats.totalItems ? ' (' + stats.totalItems + ')' : '');
        mobile.appendChild(opt);
      });

      // If selected repo was hidden, reset to 'all'
      if (state.selectedRepo !== 'all' && isRepoHidden(state.selectedRepo)) {
        selectRepo('all');
      }

      mobile.value = state.selectedRepo;

      // Validate: if selectedRepo no longer exists, reset to 'all'
      if (state.selectedRepo !== 'all' && !(repos || []).some(r => r.path === state.selectedRepo)) {
        selectRepo(includeAll ? 'all' : (((repos || []).find(r => !isRepoHidden(r.path)) || {}).path || 'all'));
      }

      if (!includeAll && state.selectedRepo === 'all') {
        const firstVisibleRepo = ((repos || []).find(r => !isRepoHidden(r.path)) || {}).path || '';
        if (firstVisibleRepo) selectRepo(firstVisibleRepo);
      }

      // Restore focus if sidebar had focus before re-render
      if (hadFocus) {
        const activeBtn = sidebar.querySelector('.sidebar-item[tabindex="0"]');
        if (activeBtn) activeBtn.focus();
      }
    }

    function renderRepoHeader(repo) {
      const header = document.getElementById('repo-header');
      if (!repo || state.selectedRepo === 'all') {
        header.style.display = 'none';
        return;
      }
      const stats = getRepoStats(repo);
      const parts = [];
      if (stats.featureCount > 0) parts.push(stats.featureCount + ' feature' + (stats.featureCount === 1 ? '' : 's'));
      if (stats.researchCount > 0) parts.push(stats.researchCount + ' research');
      let metaText = parts.join(', ') || 'No items';
      if (stats.waitingCount > 0) metaText += ' · ' + stats.waitingCount + ' waiting';
      if (stats.errorCount > 0) metaText += ' · ' + stats.errorCount + ' error';

      header.style.display = '';
      header.innerHTML = '<h2 class="repo-header-name">' + escHtml(repo.displayPath) + '</h2>' +
        '<span class="repo-header-meta">' + escHtml(metaText) + '</span>' +
        '<span class="repo-header-actions">' + buildMainDevServerHtml(repo) + buildAskAgentHtml(repo.path) + '</span>';
    }

    // Keyboard navigation for sidebar
    document.getElementById('repo-sidebar').addEventListener('keydown', (e) => {
      const items = [...document.querySelectorAll('.sidebar-item')];
      const focusedIdx = items.indexOf(document.activeElement);
      if (focusedIdx === -1) return;

      let nextIdx = -1;
      if (e.key === 'ArrowDown') {
        nextIdx = Math.min(focusedIdx + 1, items.length - 1);
      } else if (e.key === 'ArrowUp') {
        nextIdx = Math.max(focusedIdx - 1, 0);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        items[focusedIdx].click();
        return;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = items.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      if (nextIdx >= 0 && nextIdx < items.length) {
        items.forEach(it => it.setAttribute('tabindex', '-1'));
        items[nextIdx].setAttribute('tabindex', '0');
        items[nextIdx].focus();
      }
    });

    // Mobile dropdown handler
    document.getElementById('repo-select-mobile').addEventListener('change', (e) => {
      selectRepo(e.target.value);
    });
