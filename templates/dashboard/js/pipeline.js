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

    function pipelineCommand(pipelineType, action) {
      const prefix = pipelineType === 'research' ? 'research' : pipelineType === 'feedback' ? 'feedback' : 'feature';
      return prefix + '-' + action;
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
        const agentId = (agentRadio && agentRadio.value) || (typeof getAskAgent === 'function' && getAskAgent()) || 'cc';

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
          // Agent selected — use the slash command which creates + explores + fleshes out
          const descContext = description ? `\n\nUser description: "${description}"` : '';
          const prompt = `/aigon:feature-create ${name}${descContext}`;

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
      if (status === 'implementing' && endedFlag) {
        icon = '◐'; label = 'Finished (unconfirmed)'; cls = 'status-flagged';
      } else if (status === 'implementing' && (tmuxRunning || drive)) {
        icon = '●'; label = drive ? 'Implementing' : 'Running'; cls = 'status-running';
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
      const liveness = agent.liveness;
      if (!liveness) return '';
      const lastSeenAt = agent.lastSeenAt;
      let dot, tip;
      if (liveness === 'alive') {
        dot = 'liveness-alive'; tip = 'Heartbeat: active';
      } else if (liveness === 'stale') {
        const ago = agent.heartbeatAgeMs ? Math.round(agent.heartbeatAgeMs / 1000) + 's ago' : 'stale';
        dot = 'liveness-stale'; tip = 'Heartbeat: ' + ago;
      } else if (liveness === 'dead') {
        const ago = agent.heartbeatAgeMs ? Math.round(agent.heartbeatAgeMs / 1000) + 's ago' : 'no signal';
        dot = 'liveness-dead'; tip = 'Heartbeat: ' + ago;
      } else {
        return '';
      }
      return '<span class="liveness-dot ' + dot + '" title="' + tip + '"></span>';
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
      return '<div class="kcard-agent agent-' + escHtml(agent.id) + '">' +
        '<div class="kcard-agent-header">' +
          '<span class="kcard-agent-name" title="' + escHtml(displayName) + '">' + escHtml(displayName) + '</span>' +
          devSlot +
        '</div>' +
        '<div class="kcard-agent-status-row">' + buildLivenessIndicator(agent) + '<span class="kcard-agent-status ' + s.cls + '">' + s.icon + ' ' + s.label + '</span></div>' +
        (actionsHtml ? '<div class="kcard-agent-actions">' + actionsHtml + '</div>' : '') +
        '</div>';
    }

    // validActionBtnClass, buildValidActionsHtml, handleValidAction moved to actions.js

    function buildKanbanCard(feature, repoPath, pipelineType) {
      const card = document.createElement('div');
      card.className = 'kcard';
      card.draggable = true;
      card.dataset.featureId = feature.id;
      card.dataset.featureName = feature.name;
      card.dataset.stage = feature.stage;
      card.dataset.repoPath = repoPath || '';

      const agents = feature.agents || [];
      const validActions = feature.validActions || [];
      // Drive mode (branch): solo agent with no tmux session — skip agent sections
      const isSoloDriveBranch = agents.length === 1 && agents[0].id === 'solo' && !agents[0].tmuxSession;
      const hasAgentSections = agents.length > 0 && !isSoloDriveBranch;

      const reviews = feature.reviewSessions || [];

      let innerHtml =
        (feature.id ? '<div class="kcard-id">#' + escHtml(feature.id) + '</div>' : '') +
        '<div class="kcard-name">' + escHtml(feature.name.replace(/-/g, ' ')) + '</div>';

      if (hasAgentSections) {
        // New agent section layout: one visual block per agent
        // Eval status badge (for in-evaluation cards)
        if (feature.evalStatus) {
          let evalStatusRow = '<span class="kcard-status-label">Status</span><span class="eval-badge' + (feature.evalStatus === 'pick winner' ? ' pick-winner' : '') + '">' + escHtml(feature.evalStatus) + '</span>';
          if (feature.evalStatus === 'pick winner' && feature.winnerAgent) {
            evalStatusRow += '<span class="kcard-winner">Winner: ' + escHtml(feature.winnerAgent) + '</span>';
          }
          innerHtml += '<div class="kcard-status">' + evalStatusRow + '</div>';
          // View Eval button — rendered from validActions (view-eval action)
          const viewEvalAction = validActions.find(va => va.action === 'view-eval' && !va.agentId);
          if (viewEvalAction) {
            innerHtml += '<button class="btn btn-secondary kcard-eval-btn" data-view-eval>View Eval</button>';
          }
        }
        // Agent sections — actions rendered from API (no hardcoded eligibility logic)
        agents.forEach(agent => {
          const agentActions = validActions.filter(va => va.agentId === agent.id);
          innerHtml += buildAgentSectionHtml(agent, agentActions, feature, repoPath, pipelineType);
        });
        // Eval session row — rendered from validActions (open-eval-session action)
        const openEvalAction = validActions.find(va => va.action === 'open-eval-session' && !va.agentId);
        if (openEvalAction && feature.evalSession && feature.evalSession.running) {
          const evalSess = feature.evalSession;
          const evalAgent = AGENT_DISPLAY_NAMES[evalSess.agent] || evalSess.agent;
          innerHtml += '<div class="kcard-agent agent-eval">' +
            '<div class="kcard-agent-header"><span class="kcard-agent-name">Eval</span></div>' +
            '<div class="kcard-agent-status-row"><span class="kcard-agent-status status-implementing">● ' + escHtml(evalAgent) + '</span></div>' +
            '<div class="kcard-agent-actions">' +
            '<button class="btn btn-secondary kcard-eval-view" data-eval-session="' + escHtml(evalSess.session) + '">Open</button>' +
            '</div></div>';
        }
        // Review section — dedicated block between agents and actions
        if (reviews.length > 0) {
          reviews.forEach(r => {
            const reviewerName = AGENT_DISPLAY_NAMES[r.agent] || r.agent;
            const statusIcon = r.running ? '●' : '✓';
            const statusLabel = r.running ? 'Reviewing' : 'Review complete';
            const statusCls = r.running ? 'status-reviewing' : 'status-review-done';
            innerHtml += '<div class="kcard-agent agent-review">' +
              '<div class="kcard-agent-header"><span class="kcard-agent-name">Review</span></div>' +
              '<div class="kcard-agent-status-row"><span class="kcard-agent-status ' + statusCls + '">' + statusIcon + ' ' + escHtml(reviewerName) + ' — ' + statusLabel + '</span></div>' +
              (r.running ? '<div class="kcard-agent-actions"><button class="btn btn-secondary kcard-review-open" data-review-session="' + escHtml(r.session) + '">Open</button></div>' : '') +
              '</div>';
          });
        }
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
            const reviewerName = AGENT_DISPLAY_NAMES[r.agent] || r.agent;
            const statusIcon = r.running ? '●' : '✓';
            const statusLabel = r.running ? 'Reviewing' : 'Review complete';
            const statusCls = r.running ? 'status-reviewing' : 'status-review-done';
            innerHtml += '<div class="kcard-agent agent-review">' +
              '<div class="kcard-agent-header"><span class="kcard-agent-name">Review</span></div>' +
              '<div class="kcard-agent-status-row"><span class="kcard-agent-status ' + statusCls + '">' + statusIcon + ' ' + escHtml(reviewerName) + ' — ' + statusLabel + '</span></div>' +
              (r.running ? '<div class="kcard-agent-actions"><button class="btn btn-secondary kcard-review-open" data-review-session="' + escHtml(r.session) + '">Open</button></div>' : '') +
              '</div>';
          });
        }
        // Card-level actions (close, review — no session controls)
        const soloCardActionsHtml = renderActionButtons(feature, repoPath, pipelineType);
        if (soloCardActionsHtml) {
          innerHtml += '<div class="kcard-transitions">' + soloCardActionsHtml + '</div>';
        }
      } else {
        // Legacy layout for cards without active agents (inbox, backlog, done, research, feedback)
        const agentBadgesHtml = buildAgentBadgesHtml(agents);
        const actionsHtml = renderActionButtons(feature, repoPath, pipelineType);
        let evalStatusHtml = '';
        if (feature.evalStatus) {
          let evalStatusRow = '<span class="kcard-status-label">Status</span><span class="eval-badge' + (feature.evalStatus === 'pick winner' ? ' pick-winner' : '') + '">' + escHtml(feature.evalStatus) + '</span>';
          if (feature.evalStatus === 'pick winner' && feature.winnerAgent) {
            evalStatusRow += '<span class="kcard-winner">Winner: ' + escHtml(feature.winnerAgent) + '</span>';
          }
          evalStatusHtml = '<div class="kcard-status">' + evalStatusRow + '</div>';
          // View Eval button — rendered from validActions
          const legacyViewEval = validActions.find(va => va.action === 'view-eval' && !va.agentId);
          if (legacyViewEval) {
            evalStatusHtml += '<button class="btn btn-secondary kcard-eval-btn" data-view-eval>View Eval</button>';
          }
        }
        innerHtml +=
          (agentBadgesHtml ? '<div class="kcard-agents">' + agentBadgesHtml + '</div>' : '') +
          evalStatusHtml +
          (actionsHtml ? '<div class="kcard-actions">' + actionsHtml + '</div>' : '');
      }

      card.innerHTML = innerHtml;

      // Wire overflow menu toggles
      card.querySelectorAll('.kcard-overflow-toggle').forEach(toggle => {
        toggle.onclick = (e) => {
          e.stopPropagation();
          const menu = toggle.parentElement.querySelector('.kcard-overflow-menu');
          const isOpen = menu && menu.classList.contains('open');
          card.querySelectorAll('.kcard-overflow-menu').forEach(m => m.classList.remove('open'));
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
          const displayName = (feature.id ? '#' + feature.id + ' ' : '') + feature.name.replace(/-/g, ' ');
          openDrawer(feature.evalPath, displayName + ' — Eval', feature.stage, repoPath);
        };
      }

      // Wire "View Review" buttons
      card.querySelectorAll('[data-view-review]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          card.querySelectorAll('.kcard-overflow-menu.open').forEach(m => m.classList.remove('open'));
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
          card.querySelectorAll('.kcard-overflow-menu.open').forEach(m => m.classList.remove('open'));
        }
        if (e.target.closest('button') || e.target.closest('.btn')) return;
        if (feature.specPath) {
          const displayName = (feature.id ? '#' + feature.id + ' ' : '') + feature.name.replace(/-/g, ' ');
          openDrawer(feature.specPath, displayName, feature.stage, repoPath);
        }
      });

      // Wire validActions buttons (state machine-driven)
      card.querySelectorAll('.kcard-va-btn').forEach(btn => {
        const vaAction = btn.getAttribute('data-va-action');
        const vaAgentId = btn.getAttribute('data-agent') || null;
        const va = (feature.validActions || []).find(a => a.action === vaAction && (a.agentId || null) === vaAgentId);
        if (!va) return;
        btn._origText = btn.textContent;
        btn.onclick = async (e) => {
          e.stopPropagation();
          await handleFeatureAction(va, feature, repoPath, btn, pipelineType);
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

      // Eval session view button (research)
      card.querySelectorAll('.kcard-eval-view').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const sessionName = btn.getAttribute('data-eval-session');
          // Parse agent from session name: {repo}-r{id}-eval-{agent}
          const evalMatch = sessionName.match(/eval-(\w+)$/);
          const evalAgentId = evalMatch ? evalMatch[1] : 'cc';
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
      const cards = byStage[stage] || [];

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
      const shouldCapOverflow = (stage === 'backlog' || stage === 'inbox') && cards.length > OVERFLOW_CAP;
      const displayCards = (stage === 'done' && cards.length > DONE_CAP) ? cards.slice(0, DONE_CAP)
        : shouldCapOverflow ? cards.slice(0, OVERFLOW_CAP) : cards;
      displayCards.forEach(feature => colBody.appendChild(buildKanbanCard(feature, repo.path, pType)));
      if (shouldCapOverflow) {
        const hiddenCards = cards.slice(OVERFLOW_CAP);
        const hiddenContainer = document.createElement('div');
        hiddenContainer.style.display = 'none';
        hiddenCards.forEach(feature => hiddenContainer.appendChild(buildKanbanCard(feature, repo.path, pType)));
        colBody.appendChild(hiddenContainer);
        const moreBtn = document.createElement('button');
        moreBtn.className = 'btn';
        moreBtn.style.cssText = 'width:100%;margin-top:4px;font-size:11px;padding:6px';
        moreBtn.textContent = (cards.length - OVERFLOW_CAP) + ' more …';
        moreBtn.onclick = () => {
          hiddenContainer.style.display = '';
          moreBtn.remove();
          // Buttons are already wired per-card inside buildKanbanCard() via closure
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
          const donePath = (repo.path || '') + '/docs/specs/features/05-done';
          try {
            const res = await fetch('/api/open-path', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: donePath }) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
          } catch (e) { showToast('Could not open Finder: ' + e.message, null, null, { error: true }); }
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
            ? 'No repos registered. Run: aigon dashboard add'
            : 'No data for selected repo.';
        },
        setPipelineType(t) { Alpine.store('dashboard').pipelineType = t; localStorage.setItem(lsKey('pipelineType'), t); },
        get showPaused() { return !!Alpine.store('dashboard')._showPaused; },
        togglePaused() {
          const next = !this.showPaused;
          Alpine.store('dashboard')._showPaused = next;
          localStorage.setItem(lsKey('showPaused'), next ? '1' : '0');
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
              const agents = await showAgentPicker(featureId, featureName, { repoPath: effectiveRepo, taskType: 'implement', action: transition.action });
              if (!agents) return;
              await requestAction(pipelineCommand(dragPType, 'start'), [featureId, ...agents], effectiveRepo);
              break;
            }
            case 'feature-eval': {
              const agents = await showAgentPicker(featureId, featureName, { single: true, title: 'Select evaluator agent', submitLabel: 'Evaluate', repoPath: effectiveRepo, taskType: 'evaluate', action: transition.action });
              if (!agents || agents.length === 0) return;
              const evalAgent = agents[0];
              await requestAction(pipelineCommand(dragPType, 'eval'), [featureId], effectiveRepo);
              await requestFeatureOpen(featureId, evalAgent, effectiveRepo, null, dragPType);
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
