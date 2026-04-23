    // ── Pipeline / Kanban view ─────────────────────────────────────────────────

    const STAGE_ORDER = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'];
    const STAGE_LABELS = { inbox: 'Inbox', backlog: 'Backlog', 'in-progress': 'In-Progress', 'in-evaluation': 'Evaluation', done: 'Done', paused: 'Paused', triaged: 'Triaged', actionable: 'Actionable', 'wont-fix': "Won't Fix", duplicate: 'Duplicate' };
    const PIPELINE_STAGES_BASE = {
      features: ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'],
      research: ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'],
      feedback: ['inbox', 'triaged', 'actionable', 'done', 'wont-fix']
    };
    // Paused column is hidden by default for features, toggled via UI
    const PIPELINE_STAGES = {
      get features() {
        const base = PIPELINE_STAGES_BASE.features;
        const show = localStorage.getItem(lsKey('showPaused')) === '1';
        return show ? [...base.slice(0, -1), 'paused', base[base.length - 1]] : base;
      },
      get research() { return PIPELINE_STAGES_BASE.research; },
      get feedback() { return PIPELINE_STAGES_BASE.feedback; }
    };
    // ALLOWED_TRANSITIONS removed — transitions are now validated server-side via
    // validActions in the /api/status response. Drag-drop uses validTargetStages
    // computed from validActions on the card's dragstart event.

    let dragState = null;

    /** Close every overflow "⋯" menu (fixed-position; must not be per-card). */
    function closeAllKcardOverflowMenus() {
      document.querySelectorAll('.kcard-overflow-menu.open').forEach(m => m.classList.remove('open'));
    }

    function pipelineCommand(pipelineType, action) {
      const prefix = pipelineType === 'research' ? 'research' : pipelineType === 'feedback' ? 'feedback' : 'feature';
      return prefix + '-' + action;
    }

    function pipelineColumnKey(repoPath, pipelineType, stage) {
      return [repoPath || '', pipelineType || 'features', stage || ''].join('::');
    }

    function getDoneFolderPath(repoPath, pipelineType) {
      const specsRoot = (repoPath || '') + '/docs/specs';
      if (pipelineType === 'research') return specsRoot + '/research-topics/05-done';
      if (pipelineType === 'feedback') return specsRoot + '/feedback/04-done';
      return specsRoot + '/features/05-done';
    }

    function slugifyFeatureName(value) {
      const text = String(value || '').trim().toLowerCase();
      const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return slug || 'untitled';
    }

    function getCreateModalElements() {
      return {
        modal: document.getElementById('create-modal'),
        repoPicker: document.getElementById('create-modal-repo-picker'),
        repoSelect: document.getElementById('create-modal-repo'),
        nameInput: document.getElementById('create-modal-name'),
        descriptionInput: document.getElementById('create-modal-description'),
        error: document.getElementById('create-modal-error'),
        submit: document.getElementById('create-modal-submit'),
        cancel: document.getElementById('create-modal-cancel')
      };
    }

    function setCreateModalError(message) {
      const els = getCreateModalElements();
      if (!els.error) return;
      const msg = String(message || '').trim();
      els.error.textContent = msg;
      els.error.style.display = msg ? '' : 'none';
    }

    function setCreateModalBusy(busy) {
      const els = getCreateModalElements();
      if (els.submit) {
        els.submit.disabled = !!busy;
        els.submit.textContent = busy ? 'Creating...' : 'Create';
      }
      if (els.cancel) els.cancel.disabled = !!busy;
    }

    function hideCreateModal() {
      const els = getCreateModalElements();
      if (!els.modal) return;
      els.modal.style.display = 'none';
      setCreateModalError('');
      setCreateModalBusy(false);
      if (els.nameInput) els.nameInput.value = '';
      if (els.descriptionInput) els.descriptionInput.value = '';
    }

    function getAgentPromptPrefix(agentId) {
      const agents = Array.isArray(window.__AIGON_AGENTS__) ? window.__AIGON_AGENTS__ : [];
      const agent = agents.find(entry => entry && entry.id === agentId);
      return (agent && agent.cmdPrefix) || '/aigon:';
    }

    async function submitCreateModal() {
      const els = getCreateModalElements();
      if (!els.modal || !els.nameInput || !els.descriptionInput || !els.submit) return;
      const name = els.nameInput.value.trim();
      const description = els.descriptionInput.value.trim();
      const pickedRepo = els.repoPicker && els.repoPicker.style.display !== 'none'
        ? (els.repoSelect ? String(els.repoSelect.value || '').trim() : '')
        : String(els.modal.getAttribute('data-repo-path') || '').trim();

      if (!name) {
        setCreateModalError('Feature name is required.');
        els.nameInput.focus();
        return;
      }
      if (name.length > 80) {
        setCreateModalError('Feature name must be 80 characters or fewer.');
        els.nameInput.focus();
        return;
      }
      if (!pickedRepo) {
        setCreateModalError('Select a repository first.');
        return;
      }

      setCreateModalError('');
      setCreateModalBusy(true);

      try {
        // Use agent picked in modal, fall back to sidebar agent
        const agentRadio = document.querySelector('#create-modal-agent input[name="create-agent"]:checked');
        const agentId = (agentRadio && agentRadio.value) || (typeof getAskAgent === 'function' && getAskAgent()) || window.__AIGON_DEFAULT_AGENT__ || 'cc';

        if (!agentId) {
          // "None" selected — create the file via CLI, no agent session
          const createArgs = [name];
          if (description) createArgs.push('--description', description);

          const actionRes = await fetch('/api/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'feature-create',
              args: createArgs,
              repoPath: pickedRepo
            })
          });
          const actionPayload = await actionRes.json().catch(() => ({}));
          if (!actionRes.ok) {
            const details = actionPayload && actionPayload.details ? actionPayload.details : {};
            const detailedError = String(details.stderr || details.error || '').trim();
            const topLevelError = String(actionPayload.error || '').trim();
            throw new Error(detailedError || topLevelError || ('HTTP ' + actionRes.status));
          }
          await requestRefresh();
          hideCreateModal();
          showToast('Created feature: ' + name);
        } else {
          // Agent selected — use that agent's native Aigon command syntax.
          const descContext = description ? `\n\nUser description: "${description}"` : '';
          const prompt = `${getAgentPromptPrefix(agentId)}feature-create ${name}${descContext}`;

          hideCreateModal();
          showToast('Opening agent to create feature: ' + name);

          const askRes = await fetch('/api/session/ask', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ repoPath: pickedRepo, agentId, message: prompt })
          }).catch(() => null);
          if (!askRes || !askRes.ok) {
            const askPayload = askRes ? await askRes.json().catch(() => ({})) : {};
            showToast('Failed to open agent session: ' + (askPayload.error || 'Unknown error'), null, null, { error: true });
          }
        }
      } catch (e) {
        setCreateModalError(e.message || 'Failed to create feature.');
      } finally {
        setCreateModalBusy(false);
      }
    }

    function createNewSpec(preselectedRepoPath) {
      const els = getCreateModalElements();
      if (!els.modal || !els.nameInput || !els.repoPicker || !els.repoSelect) return;

      const s = Alpine.store('dashboard');
      const visibleRepos = getVisibleRepos(s.data || { repos: [] });
      const explicitRepo = String(preselectedRepoPath || '').trim();
      const selectedRepo = s.selectedRepo && s.selectedRepo !== 'all' ? s.selectedRepo : '';
      const defaultRepo = explicitRepo || selectedRepo || (visibleRepos.length === 1 ? visibleRepos[0].path : '');

      els.repoSelect.innerHTML = '';
      if (visibleRepos.length > 1 && !defaultRepo) {
        els.repoPicker.style.display = '';
        visibleRepos.forEach(repo => {
          const option = document.createElement('option');
          option.value = repo.path;
          option.textContent = repo.displayPath || repo.name || repo.path;
          els.repoSelect.appendChild(option);
        });
        els.modal.setAttribute('data-repo-path', '');
      } else {
        els.repoPicker.style.display = 'none';
        if (defaultRepo) {
          els.modal.setAttribute('data-repo-path', defaultRepo);
        } else if (visibleRepos[0] && visibleRepos[0].path) {
          els.modal.setAttribute('data-repo-path', visibleRepos[0].path);
        } else {
          els.modal.setAttribute('data-repo-path', '');
        }
      }

      setCreateModalError('');
      setCreateModalBusy(false);
      els.nameInput.value = '';
      if (els.descriptionInput) els.descriptionInput.value = '';
      const preferredAgent = window.__AIGON_DEFAULT_AGENT__ || (typeof getAskAgent === 'function' && getAskAgent()) || 'cc';
      const agentInputs = document.querySelectorAll('#create-modal-agent input[name="create-agent"]');
      agentInputs.forEach(input => {
        input.checked = input.value === preferredAgent;
      });
      if (![...agentInputs].some(input => input.checked) && agentInputs[0]) {
        agentInputs[0].checked = true;
      }
      els.modal.style.display = 'flex';
      els.nameInput.focus();
    }

    (function wireCreateModal() {
      const els = getCreateModalElements();
      if (!els.modal || !els.submit || !els.cancel || !els.nameInput) return;
      els.cancel.onclick = () => hideCreateModal();
      els.modal.onclick = (e) => { if (e.target === e.currentTarget) hideCreateModal(); };
      els.submit.onclick = () => submitCreateModal();
      els.nameInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitCreateModal();
        }
      };
    })();

    function buildAgentBadgesHtml(agents) {
      if (!agents || agents.length === 0) return '';
      return agents.map(a => '<span class="agent-badge ' + escHtml(a.status || '') + '">' + escHtml(a.id) + '</span>').join('');
    }

    // AGENT_DISPLAY_NAMES moved to actions.js (shared between monitor + pipeline)

    function isSoloDrive(agent) { return agent.id === 'solo' && !agent.tmuxSession; }

    function agentDisplayName(agent) {
      return isSoloDrive(agent) ? 'Drive' : (AGENT_DISPLAY_NAMES[agent.id] || agent.id);
    }

    function buildDevServerLinkHtml(devServerUrl) {
      if (!devServerUrl) return '';
      const safeUrl = escHtml(devServerUrl);
      return '<a class="monitor-dev-link" href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" title="Open dev server: ' + safeUrl + '" aria-label="Open dev server">' +
        '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"></circle>' +
        '<path d="M2 8h12M8 2c1.8 1.7 2.8 3.8 2.8 6S9.8 12.3 8 14M8 2C6.2 3.7 5.2 5.8 5.2 8s1 4.3 2.8 6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"></path>' +
        '</svg>' +
      '</a>';
    }

    function buildAgentStatusHtml(agent, options) {
      const opts = options || {};
      const status = agent.status || 'idle';
      const tmuxRunning = agent.tmuxRunning || false;
      const drive = isSoloDrive(agent);
      const endedFlag = !!(agent.flags && agent.flags.sessionEnded);
      let icon, label, cls;
      if (status === 'addressing-review') {
        icon = '●'; label = 'Addressing review'; cls = 'status-reviewing';
      } else if (status === 'feedback-addressed') {
        icon = '✓'; label = 'Feedback addressed'; cls = 'status-review-done';
      // tmux alive is the ground truth unless the workflow has a more specific review-loop state
      } else if (tmuxRunning && status !== 'submitted' && status !== 'waiting') {
        icon = '●'; label = drive ? 'Implementing' : 'Running'; cls = 'status-running';
      } else if (drive && status === 'implementing') {
        // Solo Drive mode runs in the current branch without a tmux session.
        // Treat the workflow status as the source of truth instead of
        // interpreting the missing tmux session as a crashed/ended session.
        icon = '●'; label = 'Implementing'; cls = 'status-running';
      } else if (status === 'implementing' && endedFlag) {
        icon = '◐'; label = 'Finished (unconfirmed)'; cls = 'status-flagged';
      } else if (status === 'implementing' && !tmuxRunning) {
        icon = '○'; label = 'Session ended'; cls = 'status-ended';
      } else if (status === 'waiting') {
        icon = '⏳'; label = 'Needs input'; cls = 'status-waiting';
      } else if (status === 'submitted') {
        icon = '✓'; label = 'Submitted'; cls = 'status-submitted';
      } else {
        icon = '○'; label = 'Not started'; cls = 'status-idle';
      }
      return { icon, label, cls, devServerUrl: agent.devServerUrl };
    }

    function buildLivenessIndicator(agent) {
      // Liveness is now determined by tmux session check (tmuxRunning field).
      // The heartbeat-based liveness dots were redundant and often wrong.
      // The card status (Running/Not started) already reflects tmux state.
      return '';
    }

    function buildAgentStatusSpan(agent, options) {
      const s = buildAgentStatusHtml(agent, options);
      const opts = options || {};
      const devServerLink = opts.showDevLink ? buildDevServerLinkHtml(s.devServerUrl) : '';
      const devSlot = opts.showDevLink ? '<span class="kcard-dev-slot">' + devServerLink + '</span>' : '';
      const livenessDot = buildLivenessIndicator(agent);
      return livenessDot + '<span class="kcard-agent-status ' + s.cls + '">' + s.icon + ' ' + s.label + '</span>' + devSlot;
    }

    // Agent-specific action label overrides (keyed by action name)
    const AGENT_ACTION_LABELS = {};
    const prStatusByFeature = new Map();
    const prStatusLoading = new Set();
    const PR_STATUS_STORAGE_KEY = 'aigon_pr_status_cache';

    // Restore from sessionStorage on load
    try {
      const stored = sessionStorage.getItem(PR_STATUS_STORAGE_KEY);
      if (stored) {
        const entries = JSON.parse(stored);
        for (const [k, v] of entries) prStatusByFeature.set(k, v);
      }
    } catch (_) {}

    function persistPrStatusCache() {
      try {
        sessionStorage.setItem(PR_STATUS_STORAGE_KEY, JSON.stringify(Array.from(prStatusByFeature.entries())));
      } catch (_) {}
    }

    function prStatusFingerprint(featureOrId, maybeFeature) {
      const feature = (featureOrId && typeof featureOrId === 'object') ? featureOrId : (maybeFeature || null);
      const featureId = feature && feature.id != null ? feature.id : featureOrId;
      const featureName = feature && feature.name ? feature.name : '';
      const createdAt = feature && feature.createdAt ? feature.createdAt : '';
      const specPath = feature && feature.specPath ? feature.specPath : '';
      return [
        String(featureId || ''),
        String(featureName || ''),
        String(createdAt || ''),
        String(specPath || '')
      ].join('::');
    }

    function prStatusKey(repoPath, featureOrId, maybeFeature) {
      return String(repoPath || '') + '::' + prStatusFingerprint(featureOrId, maybeFeature);
    }

    function getCachedPrStatus(repoPath, featureOrId, maybeFeature) {
      return prStatusByFeature.get(prStatusKey(repoPath, featureOrId, maybeFeature)) || null;
    }

    function setCachedPrStatus(repoPath, featureOrId, payload, maybeFeature) {
      const key = prStatusKey(repoPath, featureOrId, maybeFeature);
      const normalized = {
        provider: payload && payload.provider ? String(payload.provider) : '',
        status: payload && payload.status ? String(payload.status) : 'unavailable',
        prNumber: payload && payload.prNumber != null ? payload.prNumber : null,
        url: payload && payload.url ? String(payload.url) : '',
        message: payload && payload.message ? String(payload.message) : ''
      };
      prStatusByFeature.set(key, normalized);
      persistPrStatusCache();
      return normalized;
    }

    function shouldWarnCloseByPrStatus(repoPath, feature) {
      const cached = getCachedPrStatus(repoPath, feature);
      if (!cached) return false; // no warning before first refresh
      return cached.status === 'none' || cached.status === 'open' || cached.status === 'draft' || cached.status === 'unavailable';
    }

    function buildPrStatusContent(repoPath, feature) {
      const cached = getCachedPrStatus(repoPath, feature);
      if (!cached) {
        return '<button class="kcard-gh-check-btn" data-gh-refresh="1" data-repo-path="' + escHtml(repoPath || '') + '" data-feature-id="' + escHtml(feature.id) + '">Check PR status</button>';
      }

      if (cached.status === 'none') {
        return '<span class="kcard-agent-status kcard-gh-status status-none">No PR</span>';
      }

      if (cached.status === 'open' || cached.status === 'draft') {
        const isDraft = cached.status === 'draft';
        const statusCls = isDraft ? 'status-draft' : 'status-open';
        const label = (isDraft ? 'Draft' : 'Open') + (cached.prNumber ? ' #' + escHtml(cached.prNumber) : '');
        const linkHtml = cached.url
          ? ' <a class="kcard-gh-link" href="' + escHtml(cached.url) + '" target="_blank" rel="noopener noreferrer" aria-label="Open pull request">↗</a>'
          : '';
        return '<span class="kcard-agent-status kcard-gh-status ' + statusCls + '">● ' + label + linkHtml + '</span>';
      }

      if (cached.status === 'merged') {
        const mergedLabel = 'Merged' + (cached.prNumber ? ' #' + escHtml(cached.prNumber) : '');
        const linkHtml = cached.url
          ? ' <a class="kcard-gh-link" href="' + escHtml(cached.url) + '" target="_blank" rel="noopener noreferrer" aria-label="Open pull request">↗</a>'
          : '';
        return '<span class="kcard-agent-status kcard-gh-status status-merged">✓ ' + mergedLabel + linkHtml + '</span>' +
          '<div class="kcard-gh-helper">Ready to close</div>';
      }

      return '<span class="kcard-agent-status kcard-gh-status status-unavailable">Unavailable</span>';
    }

    function buildGitHubSectionHtml(feature, repoPath, repoMeta, pipelineType) {
      if (pipelineType !== 'features') return '';
      if (!repoMeta || !repoMeta.githubRemote) return '';
      if (!feature || !feature.stage || feature.stage === 'done' || feature.stage === 'inbox' || feature.stage === 'backlog') return '';
      // Only show after an agent has submitted/is ready (branch likely pushed)
      const agents = feature.agents || [];
      if (!agents.some(function(a) { return a.status === 'submitted' || a.status === 'ready'; })) return '';

      const key = prStatusKey(repoPath, feature);
      const loading = prStatusLoading.has(key);
      const cached = getCachedPrStatus(repoPath, feature);
      const refreshLabel = loading ? '↻ …' : '↻';

      // Only show header refresh button after first fetch; before that the content area has the "Check PR status" button
      const refreshBtnHtml = cached
        ? '<button class="kcard-gh-refresh' + (loading ? ' is-loading' : '') + '"' +
            ' data-gh-refresh="1"' +
            ' data-repo-path="' + escHtml(repoPath || '') + '"' +
            ' data-feature-id="' + escHtml(feature.id) + '"' +
            (loading ? ' disabled' : '') + '>' + refreshLabel + '</button>'
        : '';

      return '<div class="kcard-agent agent-github">' +
        '<div class="kcard-agent-header">' +
          '<span class="kcard-agent-name"><svg class="kcard-gh-logo" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> GitHub</span>' +
          refreshBtnHtml +
        '</div>' +
        '<div class="kcard-agent-status-row">' + buildPrStatusContent(repoPath, feature) + '</div>' +
      '</div>';
    }

    // Render the {model, effort} badge the user chose for this agent on
    // feature-start. Empty when the agent inherits the config default — we
    // only show the badge when an override was explicitly captured on
    // `feature.started`, so the card stays quiet for default runs.
    function buildAgentTripletBadge(agent) {
      const model = agent && agent.modelOverride ? String(agent.modelOverride) : '';
      const effort = agent && agent.effortOverride ? String(agent.effortOverride) : '';
      if (!model && !effort) return '';
      const parts = [];
      if (model) parts.push(model);
      if (effort) parts.push(effort);
      const text = parts.join(' · ');
      return '<span class="kcard-agent-triplet" title="Per-feature override captured at start">' + escHtml(text) + '</span>';
    }

    // Actions rendered from API — do not add action eligibility logic here.
    // All actions (workflow + infra) are derived server-side via the action registry.
    function buildAgentSectionHtml(agent, agentValidActions, feature, repoPath, pipelineType) {
      const displayName = AGENT_DISPLAY_NAMES[agent.id] || agent.id;
      const s = buildAgentStatusHtml(agent, { showDevLink: true });
      const devServerLink = buildDevServerLinkHtml(s.devServerUrl);
      const devSlot = devServerLink ? '<span class="kcard-dev-slot">' + devServerLink + '</span>' : '';
      const entityType = pipelineType === 'research' ? 'research' : 'feature';

      // Partition actions: infra actions first, then workflow primary, then overflow (stop)
      const infraActions = agentValidActions.filter(va => va.category === 'infra' || va.category === 'view');
      const workflowActions = agentValidActions.filter(va => va.category !== 'infra' && va.category !== 'view');
      const primaryActions = workflowActions.filter(va => va.action !== 'feature-stop' && va.action !== 'research-stop');
      const overflowActions = workflowActions.filter(va => va.action === 'feature-stop' || va.action === 'research-stop');
      let actionsHtml = '';

      // Render infra actions from validActions (server-driven eligibility)
      const pokeStateKey = `${repoPath || ''}:${feature.id}:${agent.id}`;
      const pokePending = state.pendingDevServerPokes && state.pendingDevServerPokes.has(pokeStateKey);
      infraActions.forEach(va => {
        if (va.action === 'dev-server-poke') {
          const pendingLabel = '<span class="run-next-spinner"></span>Starting preview…';
          const attrs = ' data-dev-poke="1"' +
            ' data-repo-path="' + escHtml(repoPath || '') + '"' +
            ' data-feature-id="' + escHtml(feature.id) + '"' +
            ' data-agent-id="' + escHtml(agent.id) + '"';
          actionsHtml += '<button class="btn btn-secondary kcard-dev-poke-btn' + (pokePending ? ' is-pending' : '') + '"' + attrs + (pokePending ? ' disabled' : '') + '>' +
            (pokePending ? pendingLabel : escHtml(va.label)) +
            '</button>';
        } else if (va.action === 'mark-submitted' || va.action === 'reopen-agent' || va.action === 'view-work') {
          const flagAction = (va.metadata && va.metadata.flagAction) || va.action;
          const attrs = ' data-flag-entity="' + escHtml(entityType) + '"' +
            ' data-flag-id="' + escHtml(feature.id) + '"' +
            ' data-flag-agent="' + escHtml(agent.id) + '"' +
            ' data-flag-repo="' + escHtml(repoPath || '') + '"';
          const btnCls = va.action === 'mark-submitted' ? 'btn btn-primary kcard-flag-btn' : 'btn btn-secondary kcard-flag-btn';
          actionsHtml += '<button class="' + btnCls + '" data-flag-action="' + escHtml(flagAction) + '"' + attrs + '>' + escHtml(va.label) + '</button>';
        } else if (va.action === 'view-findings') {
          actionsHtml += '<button class="btn btn-secondary kcard-view-findings-btn" data-findings-path="' + escHtml(agent.findingsPath || '') + '" data-findings-agent="' + escHtml(agent.id) + '" data-findings-id="' + escHtml(feature.id) + '">' + escHtml(va.label) + '</button>';
        }
      });

      // Render workflow actions
      if (primaryActions.length > 0) {
        const va = primaryActions[0];
        const btnCls = (va.priority === 'high') ? 'btn btn-primary' : 'btn btn-secondary';
        const labelOverride = AGENT_ACTION_LABELS[va.action];
        const label = typeof labelOverride === 'function' ? labelOverride(va, { agents: [agent] }) : (labelOverride || va.label);
        actionsHtml += '<button class="' + btnCls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '" data-agent="' + escHtml(agent.id) + '">' + escHtml(label) + '</button>';
      }
      if (overflowActions.length > 0) {
        const items = overflowActions.map(va =>
          '<button class="kcard-overflow-item kcard-va-btn" data-va-action="' + escHtml(va.action) + '" data-agent="' + escHtml(agent.id) + '">End Session</button>'
        ).join('');
        actionsHtml += '<div class="kcard-overflow"><button class="btn btn-overflow kcard-overflow-toggle" type="button">⋯</button><div class="kcard-overflow-menu">' + items + '</div></div>';
      }
      // Peek button — only shown when agent has a tmux session
      const peekBtn = agent.tmuxSession
        ? '<button class="kcard-peek-btn" data-peek-session="' + escHtml(agent.tmuxSession) + '" title="Peek at session output"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg></button>'
        : '';
      const tripletBadge = buildAgentTripletBadge(agent);
      return '<div class="kcard-agent agent-' + escHtml(agent.id) + '">' +
        '<div class="kcard-agent-header">' +
          '<span class="kcard-agent-name" title="' + escHtml(displayName) + '">' + escHtml(displayName) + '</span>' +
          tripletBadge +
          peekBtn +
          devSlot +
        '</div>' +
        '<div class="kcard-agent-status-row">' + buildLivenessIndicator(agent) + '<span class="kcard-agent-status ' + s.cls + '">' + s.icon + ' ' + s.label + '</span></div>' +
        (actionsHtml ? '<div class="kcard-agent-actions">' + actionsHtml + '</div>' : '') +
        '</div>';
    }

    // validActionBtnClass, buildValidActionsHtml, handleValidAction moved to actions.js

    function buildReadyToCloseHtml(agents, reviews) {
      const reviewDone = reviews.length > 0 && reviews.every(r => !r.running);
      const implementerReady = agents.some(a => a.status === 'submitted' || a.status === 'ready');
      if (!reviewDone || !implementerReady) return '';
      return '<div class="kcard-ready-indicator">✓ Ready to close</div>';
    }

    function buildRebaseWarningHtml(feature) {
      if (!feature || feature.rebaseNeeded !== true || feature.stage !== 'in-progress') return '';
      const closeReady = Array.isArray(feature.validActions) &&
        feature.validActions.some(a => a.action === 'feature-close' || a.action === 'feature-rebase');
      if (!closeReady) return '';
      return '<div class="kcard-rebase-warning">⚠ Rebase needed before close</div>';
    }

    function buildAutonomousPlanSectionHtml(feature, autonomousPeekBtn) {
      const planRenderer = window.AIGON_AUTONOMOUS_PLAN;
      if (!planRenderer || typeof planRenderer.buildAutonomousPlanHtml !== 'function') return '';
      return planRenderer.buildAutonomousPlanHtml(feature.autonomousPlan, {
        agentDisplayNames: AGENT_DISPLAY_NAMES,
        peekButtonHtml: autonomousPeekBtn || ''
      });
    }

    function buildReviewerSectionHtml(title, reviewer, options) {
      const mode = options && options.mode ? options.mode : 'implementation';
      const reviewerName = AGENT_DISPLAY_NAMES[reviewer.agent] || reviewer.agent;
      const isRunning = reviewer.running === true;
      const statusIcon = isRunning ? '●' : '✓';
      const statusLabel = isRunning
        ? (mode === 'spec-check' ? 'Checking' : 'Reviewing')
        : (mode === 'spec' ? 'Review submitted' : mode === 'spec-check' ? 'Review check complete' : 'Review complete');
      const statusCls = isRunning ? 'status-reviewing' : 'status-review-done';
      const peekBtn = reviewer.session
        ? '<button class="kcard-peek-btn" data-peek-session="' + escHtml(reviewer.session) + '" title="Peek at session output"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg></button>'
        : '';
      return '<div class="kcard-agent agent-review">' +
        '<div class="kcard-agent-header"><span class="kcard-agent-name">' + escHtml(title) + '</span>' + peekBtn + '</div>' +
        '<div class="kcard-agent-status-row"><span class="kcard-agent-status ' + statusCls + '">' + statusIcon + ' ' + escHtml(reviewerName) + ' — ' + statusLabel + '</span></div>' +
        (isRunning && reviewer.session ? '<div class="kcard-agent-actions"><button class="btn btn-secondary kcard-review-open" data-review-session="' + escHtml(reviewer.session) + '">Open</button></div>' : '') +
        '</div>';
    }

    function buildKanbanCard(feature, repoPath, pipelineType, repoMeta) {
      const card = document.createElement('div');
      card.className = 'kcard';
      card.draggable = true;
      card.dataset.featureId = feature.id;
      card.dataset.featureName = feature.name;
      card.dataset.stage = feature.stage;
      card.dataset.repoPath = repoPath || '';

      const agents = feature.agents || [];
      const validActions = feature.validActions || [];
      const autonomousPeekBtn = feature.autonomousSession && feature.autonomousSession.sessionName
        ? '<button class="kcard-peek-btn" data-peek-session="' + escHtml(feature.autonomousSession.sessionName) + '" title="Peek at autonomous controller output"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg></button>'
        : '';
      const autonomousPlanHtml = buildAutonomousPlanSectionHtml(feature, autonomousPeekBtn);
      // Done cards are clean — just ID and name, no agent sections, no actions
      const isDone = feature.stage === 'done';
      // Drive mode (branch): solo agent with no tmux session — skip agent sections
      const isSoloDriveBranch = agents.length === 1 && agents[0].id === 'solo' && !agents[0].tmuxSession;
      const hasAgentSections = !isDone && agents.length > 0 && !isSoloDriveBranch;

      const reviews = feature.reviewSessions || [];
      const specReviews = feature.specReviewSessions || [];
      const specChecks = feature.specCheckSessions || [];

      const hasNumericId = /^\d+$/.test(String(feature.id || ''));

      const nudgeChipsHtml = Array.isArray(feature.nudges) && feature.nudges.length > 0
        ? '<div class="kcard-nudges">' + feature.nudges.slice(-3).map(nudge => {
          const label = (nudge.agentId || 'agent') + ': ' + String(nudge.text || '').replace(/\s+/g, ' ').trim();
          const trimmed = label.length > 42 ? label.slice(0, 39) + '…' : label;
          const title = (nudge.atISO ? new Date(nudge.atISO).toLocaleString() + ' — ' : '') + label;
          return '<button class="kcard-nudge-chip" type="button" data-open-nudge-modal title="' + escHtml(title) + '">' + escHtml(trimmed) + '</button>';
        }).join('') + '</div>'
        : '';
      const blockedByHtml = (feature.stage === 'backlog' && feature.blockedBy && feature.blockedBy.length > 0)
        ? '<div class="kcard-blocked">' + feature.blockedBy.map(d => '<span class="kcard-blocked-label">Blocked by #' + escHtml(String(parseInt(d.id, 10))) + '</span>').join('') + '</div>'
        : '';
      let innerHtml =
        (hasNumericId ? '<div class="kcard-id">#' + escHtml(feature.id) + '</div>' : '') +
        '<div class="kcard-name">' + escHtml(feature.name.replace(/-/g, ' ')) + buildSpecDriftBadgeHtml(feature) + buildSpecReviewBadgeHtml(feature) + buildSpecCheckBadgeHtml(feature) + '</div>' +
        blockedByHtml +
        autonomousPlanHtml +
        nudgeChipsHtml;

      if (hasAgentSections) {
        // --- Evaluation verdict layout (pick-winner state) ---
        // Agent sections — same layout as in-progress (filter out select-winner from per-agent actions)
        agents.forEach(agent => {
          const agentActions = validActions.filter(va => va.agentId === agent.id && va.action !== 'select-winner');
          innerHtml += buildAgentSectionHtml(agent, agentActions, feature, repoPath, pipelineType);
        });

        // Evaluation section — consolidated eval status, session, and close action
        if (feature.evalStatus || (feature.evalSession && feature.evalSession.running)) {
          const recommended = feature.winnerAgent;
          const recommendedDisplay = recommended ? (AGENT_DISPLAY_NAMES[recommended] || recommended) : null;
          const viewEvalAction = validActions.find(va => va.action === 'view-eval' && !va.agentId);
          const openEvalAction = validActions.find(va => va.action === 'open-eval-session' && !va.agentId);
          const evalSess = feature.evalSession;
          const evalRunning = evalSess && evalSess.running;

          innerHtml += '<div class="kcard-eval-section">';
          innerHtml += '<div class="kcard-eval-section-header">';
          innerHtml += '<span class="kcard-eval-section-title">Evaluation</span>';
          if (evalRunning && evalSess.session) {
            innerHtml += '<button class="kcard-peek-btn" data-peek-session="' + escHtml(evalSess.session) + '" title="Peek at live eval output"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg></button>';
          }
          innerHtml += '</div>';
          // Action buttons on their own row so they always have full width
          const hasEvalActions = (evalRunning && evalSess.session && openEvalAction) || viewEvalAction;
          if (hasEvalActions) {
            innerHtml += '<div class="kcard-eval-actions">';
            if (evalRunning && evalSess.session && openEvalAction) {
              innerHtml += '<button class="btn btn-secondary btn-xs kcard-eval-view" data-eval-session="' + escHtml(evalSess.session) + '">Open eval</button>';
            }
            if (viewEvalAction) {
              innerHtml += '<button class="btn btn-secondary btn-xs kcard-verdict-btn" data-view-eval>View report</button>';
            }
            innerHtml += '</div>';
          }

          // Status + winner recommendation
          if (feature.evalStatus === 'pick winner') {
            innerHtml += '<div class="kcard-eval-detail">' +
              (recommendedDisplay
                ? 'Winner: <strong>' + escHtml(recommendedDisplay) + '</strong>'
                : 'Ready to pick winner') +
              '</div>';
          } else if (feature.evalStatus) {
            innerHtml += '<div class="kcard-eval-detail">' +
              '<span class="eval-badge">' + escHtml(feature.evalStatus) + '</span>' +
              '</div>';
          }

          innerHtml += '</div>';
        }

        // Review section — dedicated block between agents and actions
        if (reviews.length > 0) {
          reviews.forEach(r => {
            innerHtml += buildReviewerSectionHtml('Review', r);
          });
        }
        innerHtml += buildReadyToCloseHtml(agents, reviews);
        innerHtml += buildGitHubSectionHtml(feature, repoPath, repoMeta, pipelineType);
        // Card-level actions (non-per-agent: close, eval, review, etc.)
        const cardActionsHtml = renderActionButtons(feature, repoPath, pipelineType);
        if (cardActionsHtml) {
          innerHtml += '<div class="kcard-transitions">' + cardActionsHtml + '</div>';
        }
      } else if (isSoloDriveBranch) {
        // Drive mode (branch): same visual structure as agent sections but labeled "Drive"
        const soloAgent = agents[0];
        const soloStatus = buildAgentStatusHtml(soloAgent, { showDevLink: true });
        const soloDevLink = buildDevServerLinkHtml(soloStatus.devServerUrl);
        const soloDevSlot = soloDevLink ? '<span class="kcard-dev-slot">' + soloDevLink + '</span>' : '';
        innerHtml += '<div class="kcard-agent agent-solo">' +
          '<div class="kcard-agent-header"><span class="kcard-agent-name">Drive</span>' + soloDevSlot + '</div>' +
          '<div class="kcard-agent-status-row"><span class="kcard-agent-status ' + soloStatus.cls + '">' + soloStatus.icon + ' ' + soloStatus.label + '</span></div>' +
          '</div>';
        // Review section for solo mode
        if (reviews.length > 0) {
          reviews.forEach(r => {
            innerHtml += buildReviewerSectionHtml('Review', r);
          });
        }
        innerHtml += buildReadyToCloseHtml(agents, reviews);
        innerHtml += buildGitHubSectionHtml(feature, repoPath, repoMeta, pipelineType);
        // Card-level actions (close, review — no session controls)
        const soloCardActionsHtml = renderActionButtons(feature, repoPath, pipelineType);
        if (soloCardActionsHtml) {
          innerHtml += '<div class="kcard-transitions">' + soloCardActionsHtml + '</div>';
        }
      } else {
        // Legacy layout for cards without active agents (inbox, backlog, done, research, feedback)
        if (!isDone) {
          const agentBadgesHtml = buildAgentBadgesHtml(agents);
          const actionsHtml = renderActionButtons(feature, repoPath, pipelineType);
          let evalStatusHtml = '';
          if (feature.evalStatus) {
            let evalStatusRow = '<span class="kcard-status-label">Status</span><span class="eval-badge' + (feature.evalStatus === 'pick winner' ? ' pick-winner' : '') + '">' + escHtml(feature.evalStatus) + '</span>';
            if (feature.evalStatus === 'pick winner' && feature.winnerAgent) {
              evalStatusRow += '<span class="kcard-winner">Winner: ' + escHtml(feature.winnerAgent) + '</span>';
            }
            evalStatusHtml = '<div class="kcard-status">' + evalStatusRow + '</div>';
            const legacyViewEval = validActions.find(va => va.action === 'view-eval' && !va.agentId);
            if (legacyViewEval) {
              evalStatusHtml += '<button class="btn btn-secondary kcard-eval-btn" data-view-eval>View Eval</button>';
            }
          }
          innerHtml +=
            (agentBadgesHtml ? '<div class="kcard-agents">' + agentBadgesHtml + '</div>' : '') +
            (specChecks.length > 0 ? specChecks.map(r => buildReviewerSectionHtml('Spec review check', r, { mode: 'spec-check' })).join('') : '') +
            (specReviews.length > 0 ? specReviews.map(r => buildReviewerSectionHtml('Spec review', r, { mode: 'spec' })).join('') : '') +
            evalStatusHtml +
            buildGitHubSectionHtml(feature, repoPath, repoMeta, pipelineType) +
            (actionsHtml ? '<div class="kcard-actions">' + actionsHtml + '</div>' : '');
        }
      }

      card.innerHTML = innerHtml;

      // Advisory-only warning style on Close button when last PR check is non-merged.
      if (shouldWarnCloseByPrStatus(repoPath, feature)) {
        card.querySelectorAll('.kcard-va-btn[data-va-action="feature-close"]').forEach(btn => {
          btn.classList.add('kcard-va-btn--pr-warning');
        });
      }

      // Wire overflow menu toggles
      card.querySelectorAll('.kcard-overflow-toggle').forEach(toggle => {
        toggle.onclick = (e) => {
          e.stopPropagation();
          const menu = toggle.parentElement.querySelector('.kcard-overflow-menu');
          const isOpen = menu && menu.classList.contains('open');
          closeAllKcardOverflowMenus();
          if (!isOpen && menu) {
            // Position fixed menu relative to toggle button
            const rect = toggle.getBoundingClientRect();
            menu.style.right = (window.innerWidth - rect.right) + 'px';
            menu.style.bottom = (window.innerHeight - rect.top + 3) + 'px';
            menu.classList.add('open');
          }
        };
      });

      // Wire "View Eval" button
      const evalBtn = card.querySelector('[data-view-eval]');
      if (evalBtn && feature.evalPath) {
        evalBtn.onclick = (e) => {
          e.stopPropagation();
          const displayName = feature.name.replace(/-/g, ' ');
          openDrawer(feature.evalPath, displayName + ' — Eval', feature.stage, repoPath);
        };
      }

      card.querySelectorAll('.spec-drift-toggle').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const wrap = btn.closest('.spec-drift-wrap');
          const isOpen = wrap && wrap.classList.contains('open');
          document.querySelectorAll('.spec-drift-wrap.open').forEach(el => el.classList.remove('open'));
          if (!isOpen && wrap) wrap.classList.add('open');
        };
      });

      card.querySelectorAll('.spec-drift-reconcile-btn').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const entityType = pipelineType === 'research' ? 'research' : 'feature';
          await requestSpecReconcile(repoPath, entityType, feature.id, btn);
        };
      });

      card.querySelectorAll('[data-open-nudge-modal]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          showNudgeModal(feature, repoPath, btn);
        };
      });

      // Wire "View Review" buttons
      card.querySelectorAll('[data-view-review]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          closeAllKcardOverflowMenus();
          openPeekPanel(btn.getAttribute('data-view-review'));
        };
      });

      let wasDragged = false;
      card.addEventListener('dragstart', (e) => {
        wasDragged = true;
        card.classList.add('dragging');
        // Valid transitions come from state machine validActions — no hardcoded stage pairs
        const validTransitions = (feature.validActions || []).filter(a => a.type === 'transition');
        const validTargetStages = validTransitions.map(a => a.to);
        dragState = { featureId: feature.id, featureName: feature.name, fromStage: feature.stage, repoPath, pipelineType, validTargetStages, validTransitions, winnerAgent: feature.winnerAgent || null };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', feature.id);
        // Create tilted drag image
        const ghost = card.cloneNode(true);
        ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;width:' + card.offsetWidth + 'px;transform:rotate(6deg);opacity:0.85;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none;z-index:9999';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, card.offsetWidth / 2, card.offsetHeight / 2);
        requestAnimationFrame(() => requestAnimationFrame(() => ghost.remove()));
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        dragState = null;
        document.querySelectorAll('.kanban-col').forEach(col => col.classList.remove('drag-over', 'drag-blocked'));
      });

      // Click to open spec drawer — skip if drag occurred or button clicked
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if (wasDragged) { wasDragged = false; return; }
        // Close overflow menus when clicking outside them
        if (!e.target.closest('.kcard-overflow-toggle') && !e.target.closest('.kcard-overflow-menu')) {
          closeAllKcardOverflowMenus();
        }
        if (!e.target.closest('.spec-drift-wrap')) {
          card.querySelectorAll('.spec-drift-wrap.open').forEach(el => el.classList.remove('open'));
        }
        if (e.target.closest('button') || e.target.closest('.btn')) return;
        if (feature.specPath) {
          const displayName = feature.name.replace(/-/g, ' ');
          openDrawer(feature.specPath, displayName, feature.stage, repoPath);
        }
      });

      // Wire validActions buttons (state machine-driven)
      card.querySelectorAll('.kcard-va-btn').forEach(btn => {
        const vaAction = btn.getAttribute('data-va-action');
        const vaAgentId = btn.getAttribute('data-agent') || null;
        const va = (feature.validActions || []).find(a => a.action === vaAction && (a.agentId || null) === vaAgentId)
          || (vaAction === 'feature-close' ? { action: 'feature-close', label: 'Close' } : null);
        if (!va) return;
        btn._origText = btn.textContent;
        btn.onclick = async (e) => {
          e.stopPropagation();
          await handleFeatureAction(va, feature, repoPath, btn, pipelineType);
        };
      });

      card.querySelectorAll('.kcard-close-resolve-btn').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const info = state.closeFailedFeatures && state.closeFailedFeatures.get(String(feature.id));
          if (!info) return;
          state.closeFailedFeatures.delete(String(feature.id));
          await requestFeatureOpen(feature.id, info.agentId, info.repoPath, btn, pipelineType, 'close-resolve');
        };
      });

      card.querySelectorAll('.kcard-flag-btn').forEach(btn => {
        btn._origText = btn.textContent;
        btn.onclick = async (e) => {
          e.stopPropagation();
          const action = btn.getAttribute('data-flag-action');
          const entityType = btn.getAttribute('data-flag-entity');
          const id = btn.getAttribute('data-flag-id');
          const agentId = btn.getAttribute('data-flag-agent');
          const targetRepoPath = btn.getAttribute('data-flag-repo') || repoPath;
          await requestAgentFlagAction(action, { entityType, id, agentId, repoPath: targetRepoPath }, btn);
        };
      });

      card.querySelectorAll('[data-dev-poke="1"]').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const targetRepoPath = btn.getAttribute('data-repo-path') || repoPath || '';
          const targetFeatureId = btn.getAttribute('data-feature-id') || feature.id;
          const targetAgentId = btn.getAttribute('data-agent-id') || '';
          await requestAgentDevServerPoke(targetRepoPath, targetFeatureId, targetAgentId, btn);
        };
      });

      card.querySelectorAll('[data-gh-refresh="1"]').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const targetRepoPath = btn.getAttribute('data-repo-path') || repoPath || '';
          const targetFeatureId = btn.getAttribute('data-feature-id') || feature.id;
          const targetFeature = feature && String(feature.id) === String(targetFeatureId) ? feature : { id: targetFeatureId };
          const key = prStatusKey(targetRepoPath, targetFeature);
          if (prStatusLoading.has(key)) return;

          // Immediate visual feedback on the clicked button before full re-render
          btn.disabled = true;
          btn.classList.add('is-loading');
          btn.textContent = btn.classList.contains('kcard-gh-check-btn') ? 'Checking…' : '↻ …';

          prStatusLoading.add(key);
          try {
            const payload = await fetchPrStatus(targetRepoPath, targetFeatureId);
            setCachedPrStatus(targetRepoPath, targetFeatureId, payload || {}, targetFeature);
          } catch (err) {
            setCachedPrStatus(targetRepoPath, targetFeatureId, {
              provider: 'github',
              status: 'unavailable',
              message: String(err && err.message ? err.message : 'Failed to fetch PR status')
            }, targetFeature);
          } finally {
            prStatusLoading.delete(key);
            render();
          }
        };
      });

      // Eval session view button (research)
      card.querySelectorAll('.kcard-eval-view').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const sessionName = btn.getAttribute('data-eval-session');
          // Parse agent from session name: {repo}-r{id}-eval-{agent}
          const evalMatch = sessionName.match(/eval-(\w+)$/);
          const evalAgentId = evalMatch ? evalMatch[1] : (window.__AIGON_DEFAULT_AGENT__ || 'cc');
          await requestFeatureOpen(feature.id, evalAgentId, repoPath, btn, pipelineType, 'eval');
        };
      });

      // Wire research findings buttons into the peek panel
      card.querySelectorAll('.kcard-view-findings-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const findingsPath = btn.getAttribute('data-findings-path');
          const agentId = btn.getAttribute('data-findings-agent');
          const featureId = btn.getAttribute('data-findings-id');
          const agentName = AGENT_DISPLAY_NAMES[agentId] || agentId;
          openResearchFindingsPeek(findingsPath, 'R#' + featureId + ' ' + agentName + ' Findings');
        };
      });

      // Wire peek buttons — open the peek panel (same as Sessions tab peek)
      card.querySelectorAll('.kcard-peek-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const sessionName = btn.getAttribute('data-peek-session');
          if (sessionName && typeof openPeekPanel === 'function') {
            openPeekPanel(sessionName);
          }
        };
      });

      card.querySelectorAll('.kcard-review-open').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const sessionName = btn.getAttribute('data-review-session');
          if (sessionName && typeof openPeekPanel === 'function') {
            openPeekPanel(sessionName);
          }
        };
      });

      return card;
    }

    // ── Pipeline view — Alpine component ─────────────────────────────────────

    // Renders kanban cards into a col-body element (called via x-effect for reactivity)
    function renderKanbanColCards(colBody, repo, stage) {
      const s = Alpine.store('dashboard');
      const pType = s.pipelineType || 'features';
      const items = repo[pType] || [];
      const byStage = {};
      items.forEach(f => { if (!byStage[f.stage]) byStage[f.stage] = []; byStage[f.stage].push(f); });
      const unsorted = byStage[stage] || [];
      // Sort: done = most recently updated first; all others = by ID ascending
      const cards = stage === 'done'
        ? unsorted.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        : unsorted.slice().sort((a, b) => {
            const aHasNumericId = /^\d+$/.test(String(a.id || ''));
            const bHasNumericId = /^\d+$/.test(String(b.id || ''));
            const aNum = aHasNumericId ? parseInt(a.id, 10) : null;
            const bNum = bHasNumericId ? parseInt(b.id, 10) : null;

            if (aHasNumericId && bHasNumericId) {
              return aNum - bNum || (a.name || '').localeCompare(b.name || '');
            }

            if (!aHasNumericId && !bHasNumericId) {
              return (b.createdAt || b.updatedAt || '').localeCompare(a.createdAt || a.updatedAt || '')
                || (a.name || '').localeCompare(b.name || '');
            }

            return aHasNumericId ? -1 : 1;
          });

      colBody.innerHTML = '';
      if (cards.length === 0) {
        const emp = document.createElement('div');
        emp.className = 'col-empty';
        emp.textContent = 'Empty';
        colBody.appendChild(emp);
        return;
      }

      const DONE_CAP = 6;
      const OVERFLOW_CAP = 8;
      const expandedColumns = state.expandedPipelineColumns || {};
      const columnKey = pipelineColumnKey(repo.path, pType, stage);
      const isExpanded = !!expandedColumns[columnKey];
      const shouldCapOverflow = (stage === 'backlog' || stage === 'inbox') && cards.length > OVERFLOW_CAP;
      const displayCards = (stage === 'done' && cards.length > DONE_CAP) ? cards.slice(0, DONE_CAP)
        : (shouldCapOverflow && !isExpanded) ? cards.slice(0, OVERFLOW_CAP) : cards;

      const setsRollup = Array.isArray(repo.sets) ? repo.sets : [];

      // Group-by-set: partition the *visible* cards (same caps as ungrouped) so
      // done/overflow limits still apply when grouping is enabled.
      if (pType === 'features' && s.pipelineGroupBySet) {
        const orderedSetSlugs = [];
        const bySet = new Map();
        const ungrouped = [];
        for (const card of displayCards) {
          if (card.set) {
            if (!bySet.has(card.set)) {
              bySet.set(card.set, []);
              orderedSetSlugs.push(card.set);
            }
            bySet.get(card.set).push(card);
          } else {
            ungrouped.push(card);
          }
        }
        if (bySet.size > 0) {
          const headerBaseStyle = 'font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:6px 8px;margin:6px 0 2px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--bg-subtle,rgba(0,0,0,0.03))';
          for (const setSlug of orderedSetSlugs) {
            const members = bySet.get(setSlug);
            const header = document.createElement('div');
            header.className = 'kanban-set-header';
            header.style.cssText = headerBaseStyle + ';color:var(--text-secondary);display:block';

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px';
            const title = document.createElement('span');
            const roll = setsRollup.find(x => x.slug === setSlug);
            const isPausedOnFailure = roll && roll.autonomous && roll.autonomous.status === 'paused-on-failure';
            const titlePrefix = isPausedOnFailure ? '⚠ ' : '◉ ';
            title.textContent = titlePrefix + setSlug;
            if (isPausedOnFailure) {
              title.style.color = '#e57c2a';
              header.style.borderTop = '1px solid #e57c2a44';
              header.style.borderBottom = '1px solid #e57c2a44';
              header.style.background = 'rgba(229,124,42,0.07)';
              const failedId = roll.autonomous.failedFeature || (Array.isArray(roll.autonomous.failed) && roll.autonomous.failed[0]);
              const failLabel = failedId ? `feature #${parseInt(failedId, 10) || failedId} failed` : 'review failed';
              const badge = document.createElement('span');
              badge.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:#e57c2a22;color:#e57c2a;border:1px solid #e57c2a55;border-radius:3px;padding:1px 5px;cursor:default;white-space:nowrap';
              badge.textContent = 'PAUSED';
              badge.title = `Set paused on failure — ${failLabel}. Run: aigon set-autonomous-resume ${setSlug}`;
              row.appendChild(title);
              row.appendChild(badge);
            } else {
              row.appendChild(title);
            }
            const countEl = document.createElement('span');
            countEl.style.opacity = '0.7';
            const doneN = roll ? (Number(roll.completed) || 0) : 0;
            const totalN = roll ? (Number(roll.memberCount) || members.length) : members.length;
            countEl.textContent = totalN ? (doneN + '/' + totalN) : String(members.length);
            row.appendChild(countEl);
            header.appendChild(row);

            if (totalN > 0) {
              const barWrap = document.createElement('div');
              barWrap.style.cssText = 'width:100%;height:4px;border-radius:2px;background:rgba(128,128,128,0.22);margin-top:6px;overflow:hidden';
              const bar = document.createElement('div');
              const pct = Math.min(100, Math.round((100 * doneN) / totalN));
              bar.style.cssText = 'height:100%;width:' + pct + '%;background:var(--accent,#3b82f6);border-radius:2px;transition:width .2s ease';
              barWrap.appendChild(bar);
              header.appendChild(barWrap);
            }

            colBody.appendChild(header);
            members.forEach(feature => colBody.appendChild(buildKanbanCard(feature, repo.path, pType, repo)));
          }
          if (ungrouped.length > 0) {
            const header = document.createElement('div');
            header.className = 'kanban-set-header kanban-set-header-ungrouped';
            header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-tertiary);padding:6px 8px;margin:8px 0 2px';
            const uTitle = document.createElement('span');
            uTitle.textContent = 'Ungrouped';
            const uCount = document.createElement('span');
            uCount.style.opacity = '0.7';
            uCount.textContent = String(ungrouped.length);
            header.appendChild(uTitle);
            header.appendChild(uCount);
            colBody.appendChild(header);
            ungrouped.forEach(feature => colBody.appendChild(buildKanbanCard(feature, repo.path, pType, repo)));
          }
          if (shouldCapOverflow && !isExpanded) {
            const hiddenCards = cards.slice(OVERFLOW_CAP);
            const hiddenContainer = document.createElement('div');
            hiddenContainer.style.display = 'none';
            hiddenCards.forEach(feature => hiddenContainer.appendChild(buildKanbanCard(feature, repo.path, pType, repo)));
            colBody.appendChild(hiddenContainer);
            const moreBtn = document.createElement('button');
            moreBtn.className = 'btn';
            moreBtn.style.cssText = 'width:100%;margin-top:4px;font-size:11px;padding:6px';
            moreBtn.textContent = (cards.length - OVERFLOW_CAP) + ' more …';
            moreBtn.onclick = () => {
              const next = { ...(state.expandedPipelineColumns || {}) };
              next[columnKey] = true;
              state.expandedPipelineColumns = next;
              localStorage.setItem(lsKey('expandedPipelineColumns'), JSON.stringify(next));
              render();
            };
            colBody.appendChild(moreBtn);
          }
          if (stage === 'done' && cards.length > DONE_CAP) {
            const doneTotalKey = pType === 'research' ? 'researchDoneTotal' : pType === 'feedback' ? 'feedbackDoneTotal' : 'doneTotal';
            const totalDone = repo[doneTotalKey] || cards.length;
            const moreBtn = document.createElement('button');
            moreBtn.className = 'btn';
            moreBtn.style.cssText = 'width:100%;margin-top:4px;font-size:11px;padding:6px';
            moreBtn.textContent = (totalDone - DONE_CAP) + ' more — open in Finder';
            moreBtn.onclick = async () => {
              const donePath = getDoneFolderPath(repo.path, pType);
              try {
                const res = await fetch('/api/open-folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: donePath }) });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const msg = payload && payload.error && payload.error.message
                    ? payload.error.message
                    : (payload && payload.error) || ('HTTP ' + res.status);
                  throw new Error(String(msg));
                }
              } catch (e) {
                showToast('Could not open folder: ' + e.message, null, null, { error: true });
              }
            };
            colBody.appendChild(moreBtn);
          }
          return;
        }
      }

      displayCards.forEach(feature => colBody.appendChild(buildKanbanCard(feature, repo.path, pType, repo)));
      if (shouldCapOverflow && !isExpanded) {
        const hiddenCards = cards.slice(OVERFLOW_CAP);
        const hiddenContainer = document.createElement('div');
        hiddenContainer.style.display = 'none';
        hiddenCards.forEach(feature => hiddenContainer.appendChild(buildKanbanCard(feature, repo.path, pType, repo)));
        colBody.appendChild(hiddenContainer);
        const moreBtn = document.createElement('button');
        moreBtn.className = 'btn';
        moreBtn.style.cssText = 'width:100%;margin-top:4px;font-size:11px;padding:6px';
        moreBtn.textContent = (cards.length - OVERFLOW_CAP) + ' more …';
        moreBtn.onclick = () => {
          const next = { ...(state.expandedPipelineColumns || {}) };
          next[columnKey] = true;
          state.expandedPipelineColumns = next;
          localStorage.setItem(lsKey('expandedPipelineColumns'), JSON.stringify(next));
          render();
        };
        colBody.appendChild(moreBtn);
      }
      if (stage === 'done' && cards.length > DONE_CAP) {
        const doneTotalKey = pType === 'research' ? 'researchDoneTotal' : pType === 'feedback' ? 'feedbackDoneTotal' : 'doneTotal';
        const totalDone = repo[doneTotalKey] || cards.length;
        const moreBtn = document.createElement('button');
        moreBtn.className = 'btn';
        moreBtn.style.cssText = 'width:100%;margin-top:4px;font-size:11px;padding:6px';
        moreBtn.textContent = (totalDone - DONE_CAP) + ' more — open in Finder';
        moreBtn.onclick = async () => {
          const donePath = getDoneFolderPath(repo.path, pType);
          try {
            const res = await fetch('/api/open-folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: donePath }) });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
              const msg = payload && payload.error && payload.error.message
                ? payload.error.message
                : (payload && payload.error) || ('HTTP ' + res.status);
              throw new Error(String(msg));
            }
          } catch (e) {
            showToast('Could not open folder: ' + e.message, null, null, { error: true });
          }
        };
        colBody.appendChild(moreBtn);
      }
      // Note: valid-action button clicks are wired per-card inside buildKanbanCard()
      // via closure over the correct feature object. Do NOT re-wire here — that
      // overwrites the closure and breaks items without IDs (e.g. inbox cards).
    }

    function pipelineView() {
      return {
        pipelineTypeOpts: [
          { key: 'features', label: 'Features' },
          { key: 'research', label: 'Research' },
          { key: 'feedback', label: 'Feedback' }
        ],
        get currentStages() {
          const pType = Alpine.store('dashboard').pipelineType || 'features';
          const base = PIPELINE_STAGES_BASE[pType] || STAGE_ORDER;
          // Read reactive showPaused flag (triggers Alpine re-render when toggled)
          if (pType === 'features' && Alpine.store('dashboard')._showPaused) {
            return [...base.slice(0, -1), 'paused', base[base.length - 1]];
          }
          return base;
        },
        get visibleRepos() { return getVisibleRepos(Alpine.store('dashboard').data || { repos: [] }); },
        get emptyMessage() {
          return (Alpine.store('dashboard').selectedRepo === 'all')
            ? 'No repos registered. Run: aigon server add'
            : 'No data for selected repo.';
        },
        setPipelineType(t) { Alpine.store('dashboard').pipelineType = t; localStorage.setItem(lsKey('pipelineType'), t); },
        get showPaused() { return !!Alpine.store('dashboard')._showPaused; },
        togglePaused() {
          const next = !this.showPaused;
          Alpine.store('dashboard')._showPaused = next;
          localStorage.setItem(lsKey('showPaused'), next ? '1' : '0');
        },
        get groupBySet() { return !!Alpine.store('dashboard').pipelineGroupBySet; },
        toggleGroupBySet() {
          const next = !this.groupBySet;
          Alpine.store('dashboard').pipelineGroupBySet = next;
          localStorage.setItem(lsKey('pipelineGroupBySet'), next ? '1' : '0');
        },
        getStageDisplayCount(repo, stage) {
          const s = Alpine.store('dashboard');
          const pType = s.pipelineType || 'features';
          const items = repo[pType] || [];
          const stageItems = items.filter(f => f.stage === stage);
          if (stage === 'done') {
            const doneTotalKey = pType === 'research' ? 'researchDoneTotal' : pType === 'feedback' ? 'feedbackDoneTotal' : 'doneTotal';
            return repo[doneTotalKey] || stageItems.length;
          }
          return stageItems.length;
        },
        renderKanbanColCards(colBody, repo, stage) { renderKanbanColCards(colBody, repo, stage); },
        createNewSpec(repoPath) { createNewSpec(repoPath); },
        onDragOver(e, stage) {
          if (!dragState) return;
          const allowed = dragState.validTargetStages ? dragState.validTargetStages.includes(stage) : false;
          e.dataTransfer.dropEffect = allowed ? 'move' : 'none';
          const col = e.currentTarget;
          document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over', 'drag-blocked'));
          col.classList.add(allowed ? 'drag-over' : 'drag-blocked');
        },
        onDragLeave(e) {
          const col = e.currentTarget;
          if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over', 'drag-blocked');
        },
        async onDrop(e, stage, repoPath) {
          const col = e.currentTarget;
          col.classList.remove('drag-over', 'drag-blocked');
          if (!dragState) return;
          const { featureId, featureName, repoPath: dragRepo, pipelineType: dragPType, validTargetStages, validTransitions, winnerAgent: dragWinnerAgent } = dragState;
          dragState = null;
          if (!(validTargetStages && validTargetStages.includes(stage))) return;
          const effectiveRepo = dragRepo || repoPath;
          // Dispatch based on the state machine transition action — no hardcoded stage pairs
          const transition = (validTransitions || []).find(t => t.to === stage);
          if (!transition) return;
          switch (transition.action) {
            case 'feature-prioritise':
            case 'research-prioritise':
              await requestAction(pipelineCommand(dragPType, 'prioritise'), [featureName], effectiveRepo);
              break;
            case 'feature-start':
            case 'research-start': {
              const recEntity = transition.action === 'research-start' ? 'research' : 'feature';
              const recommendation = typeof fetchSpecRecommendation === 'function'
                ? await fetchSpecRecommendation(recEntity, featureId, effectiveRepo)
                : null;
              const triplets = await showAgentPicker(featureId, featureName, { repoPath: effectiveRepo, taskType: 'implement', action: transition.action, collectTriplet: true, recommendation });
              if (!triplets) return;
              const extraArgs = tripletsToCliArgs(triplets);
              const agentIds = triplets.map(t => t.id);
              await requestAction(pipelineCommand(dragPType, 'start'), [featureId, ...agentIds, ...extraArgs], effectiveRepo);
              break;
            }
            case 'feature-eval': {
              const triplets = await showAgentPicker(featureId, featureName, { single: true, collectTriplet: true, title: 'Select evaluator agent', submitLabel: 'Evaluate', repoPath: effectiveRepo, taskType: 'evaluate', action: transition.action });
              if (!triplets || triplets.length === 0) return;
              const t = triplets[0];
              const launchOpts = {};
              if (t.model) launchOpts.model = t.model;
              if (t.effort) launchOpts.effort = t.effort;
              await requestAction(pipelineCommand(dragPType, 'eval'), [featureId], effectiveRepo);
              await requestFeatureOpen(featureId, t.id, effectiveRepo, null, dragPType, 'eval', launchOpts);
              break;
            }
            case 'feature-close': {
              const picked = await showAgentPicker(featureId, featureName, { single: true, title: 'Pick winner to merge', submitLabel: 'Close & Merge', preselect: dragWinnerAgent, repoPath: effectiveRepo, taskType: 'evaluate', action: transition.action });
              if (!picked || picked.length === 0) return;
              await requestAction(pipelineCommand(dragPType, 'close'), [featureId, picked[0]], effectiveRepo);
              break;
            }
            default:
              await requestAction(transition.action, [featureId || featureName], effectiveRepo);
          }
        }
      };
    }
