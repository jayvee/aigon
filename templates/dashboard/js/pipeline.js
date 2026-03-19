    // ── Pipeline / Kanban view ─────────────────────────────────────────────────

    const STAGE_ORDER = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'];
    const STAGE_LABELS = { inbox: 'Inbox', backlog: 'Backlog', 'in-progress': 'In-Progress', 'in-evaluation': 'Evaluation', done: 'Done', paused: 'Paused', triaged: 'Triaged', actionable: 'Actionable', 'wont-fix': "Won't Fix", duplicate: 'Duplicate' };
    const PIPELINE_STAGES = {
      features: ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'done'],
      research: ['inbox', 'backlog', 'in-progress', 'paused', 'done'],
      feedback: ['inbox', 'triaged', 'actionable', 'done', 'wont-fix']
    };
    // ALLOWED_TRANSITIONS removed — transitions are now validated server-side via
    // validActions in the /api/status response. Drag-drop uses validTargetStages
    // computed from validActions on the card's dragstart event.

    let dragState = null;

    function pipelineCommand(pipelineType, action) {
      const prefix = pipelineType === 'research' ? 'research' : pipelineType === 'feedback' ? 'feedback' : 'feature';
      return prefix + '-' + action;
    }

    function buildAgentBadgesHtml(agents) {
      if (!agents || agents.length === 0) return '';
      return agents.map(a => '<span class="agent-badge ' + escHtml(a.status || '') + '">' + escHtml(a.id) + '</span>').join('');
    }

    const AGENT_DISPLAY_NAMES = { cc: 'Claude Code', gg: 'Gemini', cx: 'Codex', cu: 'Cursor', solo: 'Agent' };

    function isSoloDrive(agent) { return agent.id === 'solo' && !agent.tmuxSession; }

    function agentDisplayName(agent) {
      return isSoloDrive(agent) ? 'Drive' : (AGENT_DISPLAY_NAMES[agent.id] || agent.id);
    }

    function buildAgentStatusHtml(agent) {
      const status = agent.status || 'idle';
      const tmuxRunning = agent.tmuxRunning || false;
      const drive = isSoloDrive(agent);
      let icon, label, cls;
      if (status === 'implementing' && (tmuxRunning || drive)) {
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
      return '<span class="kcard-agent-status ' + cls + '">' + icon + ' ' + label + '</span>';
    }

    // Remap state machine action labels to clean, agent-ID-free button text.
    const AGENT_ACTION_LABELS = {
      'feature-attach':  'View',
      'feature-focus':   'View',
      'feature-open':    (va, agent) => (agent.status === 'implementing') ? 'Restart' : 'Start',
      'research-attach': 'View',
      'research-open':   'Start'
    };

    function buildAgentSectionHtml(agent, agentValidActions) {
      const displayName = AGENT_DISPLAY_NAMES[agent.id] || agent.id;
      const statusHtml = buildAgentStatusHtml(agent);
      const primaryActions = agentValidActions.filter(va => va.action !== 'feature-stop' && va.action !== 'research-stop');
      const overflowActions = agentValidActions.filter(va => va.action === 'feature-stop' || va.action === 'research-stop');
      let actionsHtml = '';
      if (primaryActions.length > 0) {
        const va = primaryActions[0];
        const btnCls = (va.priority === 'high') ? 'btn btn-primary' : 'btn btn-secondary';
        const labelOverride = AGENT_ACTION_LABELS[va.action];
        const label = typeof labelOverride === 'function' ? labelOverride(va, agent) : (labelOverride || va.label);
        actionsHtml += '<button class="' + btnCls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '" data-agent="' + escHtml(agent.id) + '">' + escHtml(label) + '</button>';
      }
      if (overflowActions.length > 0) {
        const items = overflowActions.map(va =>
          '<button class="kcard-overflow-item kcard-va-btn" data-va-action="' + escHtml(va.action) + '" data-agent="' + escHtml(agent.id) + '">End Session</button>'
        ).join('');
        actionsHtml += '<div class="kcard-overflow"><button class="btn btn-overflow kcard-overflow-toggle" type="button">⋯</button><div class="kcard-overflow-menu">' + items + '</div></div>';
      }
      return '<div class="kcard-agent agent-' + escHtml(agent.id) + '">' +
        '<div class="kcard-agent-header"><span class="kcard-agent-name">' + escHtml(displayName) + '</span>' + statusHtml + '</div>' +
        (actionsHtml ? '<div class="kcard-agent-actions">' + actionsHtml + '</div>' : '') +
        '</div>';
    }

    // Maps validActions to button CSS classes using priority as the primary signal.
    // priority:'high' → primary (prominent, recommended next step)
    // feature-stop → danger (destructive)
    // everything else → secondary (subdued, available but not competing)
    function validActionBtnClass(action, priority) {
      if (priority === 'high') return 'btn btn-primary';
      if (action === 'feature-stop') return 'btn btn-danger';
      return 'btn btn-secondary';
    }

    // Builds button HTML from server-provided validActions.
    // Returns only action buttons — status badges are handled separately in buildKanbanCard.
    // Transitions are used for drag-drop only (not rendered as buttons) —
    // except specific transitions that should appear as buttons (prioritise, close, triage).
    function buildValidActionsHtml(validActions) {
      if (!validActions || validActions.length === 0) return '';
      // Filter: show in-state actions as buttons, plus specific transitions that need buttons
      const transitionsAsButtons = ['feature-prioritise', 'research-prioritise', 'feature-close', 'research-close', 'feedback-triage'];
      const buttonsToRender = validActions.filter(va => {
        if (va.type === 'action') return true;
        // Only render transition as button if it's in the explicit list
        return va.type === 'transition' && transitionsAsButtons.includes(va.action);
      });
      // Deduplicate: if a transition and an action have the same action name, keep only the action
      const seen = new Set();
      const deduped = [];
      // Actions first (preferred), then transitions
      const sorted = [...buttonsToRender.filter(v => v.type === 'action'), ...buttonsToRender.filter(v => v.type === 'transition')];
      for (const va of sorted) {
        const key = va.action + (va.agentId || '');
        if (!seen.has(key)) { seen.add(key); deduped.push(va); }
      }
      // Sort: high-priority (primary) first, then normal, then stop/danger last
      deduped.sort((a, b) => {
        const rank = v => v.priority === 'high' ? 0 : v.action === 'feature-stop' ? 2 : 1;
        return rank(a) - rank(b);
      });
      return deduped.map(va => {
        const cls = validActionBtnClass(va.action, va.priority);
        const agentAttr = va.agentId ? ' data-agent="' + escHtml(va.agentId) + '"' : '';
        return '<button class="' + cls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '"' + agentAttr + '>' + escHtml(va.label) + '</button>';
      }).join('');
    }

    // Dispatches a validAction click to the appropriate API endpoint
    async function handleValidAction(va, feature, repoPath, btn, pipelineType) {
      const id = feature.id;
      const agentId = va.agentId || null;
      switch (va.action) {
        case 'feature-open':
        case 'feature-attach':
        case 'feature-focus':
        case 'research-open':
        case 'research-attach':
          await requestFeatureOpen(id, agentId, repoPath, btn, pipelineType);
          break;
        case 'feature-setup':
        case 'research-setup': {
          const agents = await showAgentPicker(id, feature.name);
          if (!agents) return;
          await requestAction(pipelineCommand(pipelineType, 'setup'), [id, ...agents], repoPath, btn);
          for (const agent of agents) {
            await requestFeatureOpen(id, agent, repoPath, null, pipelineType);
          }
          break;
        }
        case 'feature-autopilot': {
          const agents = await showAgentPicker(id, feature.name, { title: 'Select Autopilot Agents', submitLabel: 'Autopilot' });
          if (!agents) return;
          if (agents.length < 2) { showToast('Select at least 2 agents for autopilot'); return; }
          await requestAction('feature-autopilot', [id, ...agents], repoPath, btn);
          break;
        }
        case 'feature-eval': {
          // If not already in evaluation, do the state transition first
          if (feature.stage !== 'in-evaluation') {
            await requestAction('feature-eval', [id, '--setup-only'], repoPath, btn);
          }
          // Open a dedicated eval session — runs from main repo with eval prompt
          await requestFeatureOpen(id, 'cc', repoPath, null, pipelineType, 'eval');
          break;
        }
        case 'feature-prioritise':
        case 'research-prioritise':
          await requestAction(pipelineCommand(pipelineType, 'prioritise'), [feature.name], repoPath, btn);
          break;
        case 'feature-close': {
          // For fleet eval cards, show winner picker before closing
          if (feature.stage === 'in-evaluation') {
            const picked = await showAgentPicker(id, feature.name, { single: true, title: 'Pick winner to merge', submitLabel: 'Close & Merge', preselect: feature.winnerAgent });
            if (!picked || picked.length === 0) return;
            await requestAction('feature-close', [id, picked[0]], repoPath, btn);
          } else {
            await requestAction('feature-close', [id, ...(agentId ? [agentId] : [])], repoPath, btn);
          }
          break;
        }
        case 'feature-stop':
          await requestAction('feature-stop', [id, ...(agentId ? [agentId] : [])], repoPath, btn);
          break;
        default:
          await requestAction(va.action, [id, ...(agentId ? [agentId] : [])], repoPath, btn);
      }
    }

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
          if (feature.evalPath) {
            innerHtml += '<button class="btn btn-secondary kcard-eval-btn" data-view-eval>View Eval</button>';
          }
        }
        // Agent sections
        agents.forEach(agent => {
          const agentActions = validActions.filter(va => va.agentId === agent.id);
          innerHtml += buildAgentSectionHtml(agent, agentActions);
        });
        // Card-level actions (non-per-agent: close, eval, review, etc.)
        const cardLevelActions = validActions.filter(va => !va.agentId);
        if (cardLevelActions.length > 0) {
          const cardActionsHtml = cardLevelActions.map(va => {
            const btnCls = (va.priority === 'high') ? 'btn btn-primary' : 'btn btn-secondary';
            return '<button class="' + btnCls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '">' + escHtml(va.label) + '</button>';
          }).join('');
          innerHtml += '<div class="kcard-transitions">' + cardActionsHtml + '</div>';
        }
      } else if (isSoloDriveBranch) {
        // Drive mode (branch): same visual structure as agent sections but labeled "Drive"
        const soloAgent = agents[0];
        const statusHtml = buildAgentStatusHtml(soloAgent);
        innerHtml += '<div class="kcard-agent agent-solo">' +
          '<div class="kcard-agent-header"><span class="kcard-agent-name">Drive</span>' + statusHtml + '</div>' +
          '</div>';
        // Card-level actions (close, review — no session controls)
        const cardLevelActions = validActions.filter(va => !va.agentId || va.agentId === 'solo');
        const nonSessionActions = cardLevelActions.filter(va => va.action !== 'feature-open' && va.action !== 'feature-attach' && va.action !== 'feature-stop');
        if (nonSessionActions.length > 0) {
          const cardActionsHtml = nonSessionActions.map(va => {
            const btnCls = (va.priority === 'high') ? 'btn btn-primary' : 'btn btn-secondary';
            return '<button class="' + btnCls + ' kcard-va-btn" data-va-action="' + escHtml(va.action) + '">' + escHtml(va.label) + '</button>';
          }).join('');
          innerHtml += '<div class="kcard-transitions">' + cardActionsHtml + '</div>';
        }
      } else {
        // Legacy layout for cards without active agents (inbox, backlog, done, research, feedback)
        const agentBadgesHtml = buildAgentBadgesHtml(agents);
        const actionsHtml = buildValidActionsHtml(validActions);
        let evalStatusHtml = '';
        if (feature.evalStatus) {
          let evalStatusRow = '<span class="kcard-status-label">Status</span><span class="eval-badge' + (feature.evalStatus === 'pick winner' ? ' pick-winner' : '') + '">' + escHtml(feature.evalStatus) + '</span>';
          if (feature.evalStatus === 'pick winner' && feature.winnerAgent) {
            evalStatusRow += '<span class="kcard-winner">Winner: ' + escHtml(feature.winnerAgent) + '</span>';
          }
          evalStatusHtml = '<div class="kcard-status">' + evalStatusRow + '</div>';
          if (feature.evalPath) {
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
          if (!isOpen && menu) menu.classList.add('open');
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
          await handleValidAction(va, feature, repoPath, btn, pipelineType);
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
          // Wire up valid-action buttons on revealed cards
          hiddenContainer.querySelectorAll('.kcard-va-btn').forEach(btn => {
            btn.onclick = (e) => {
              e.stopPropagation();
              const action = btn.getAttribute('data-va-action') || '';
              const agentId = btn.getAttribute('data-agent') || null;
              const card = btn.closest('.kcard');
              const featureId = card ? card.dataset.featureId : '';
              const featureName = card ? card.dataset.featureName : '';
              const feature = (repo[pType] || []).find(f => String(f.id) === String(featureId)) || { id: featureId, name: featureName, stage: card ? card.dataset.stage : '' };
              handleValidAction({ action, agentId, label: btn.textContent }, feature, repo.path, btn, pType);
            };
          });
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
      // Wire up valid-action button clicks on newly rendered cards
      colBody.querySelectorAll('.kcard-va-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const action = btn.getAttribute('data-va-action') || '';
          const agentId = btn.getAttribute('data-agent') || null;
          const card = btn.closest('.kcard');
          const featureId = card ? card.dataset.featureId : '';
          const featureName = card ? card.dataset.featureName : '';
          const feature = (repo[pType] || []).find(f => String(f.id) === String(featureId)) || { id: featureId, name: featureName, stage: card ? card.dataset.stage : '' };
          handleValidAction({ action, agentId, label: btn.textContent }, feature, repo.path, btn, pType);
        };
      });
    }

    function pipelineView() {
      return {
        pipelineTypeOpts: [
          { key: 'features', label: 'Features' },
          { key: 'research', label: 'Research' },
          { key: 'feedback', label: 'Feedback' }
        ],
        get currentStages() { return PIPELINE_STAGES[Alpine.store('dashboard').pipelineType || 'features'] || STAGE_ORDER; },
        get visibleRepos() { return getVisibleRepos(Alpine.store('dashboard').data || { repos: [] }); },
        get emptyMessage() {
          return (Alpine.store('dashboard').selectedRepo === 'all')
            ? 'No repos registered. Run: aigon conductor add'
            : 'No data for selected repo.';
        },
        setPipelineType(t) { Alpine.store('dashboard').pipelineType = t; localStorage.setItem(lsKey('pipelineType'), t); },
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
        createNewSpec() { createNewSpec(); },
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
            case 'feature-setup':
            case 'research-setup': {
              const agents = await showAgentPicker(featureId, featureName);
              if (!agents) return;
              await requestAction(pipelineCommand(dragPType, 'setup'), [featureId, ...agents], effectiveRepo);
              for (const agent of agents) {
                await requestFeatureOpen(featureId, agent, effectiveRepo, null, dragPType);
              }
              break;
            }
            case 'feature-eval': {
              const agents = await showAgentPicker(featureId, featureName, { single: true, title: 'Select evaluator agent', submitLabel: 'Evaluate' });
              if (!agents || agents.length === 0) return;
              const evalAgent = agents[0];
              await requestAction(pipelineCommand(dragPType, 'eval'), [featureId], effectiveRepo);
              await requestFeatureOpen(featureId, evalAgent, effectiveRepo, null, dragPType);
              break;
            }
            case 'feature-close': {
              const picked = await showAgentPicker(featureId, featureName, { single: true, title: 'Pick winner to merge', submitLabel: 'Close & Merge', preselect: dragWinnerAgent });
              if (!picked || picked.length === 0) return;
              await requestAction(pipelineCommand(dragPType, 'close'), [featureId, picked[0]], effectiveRepo);
              break;
            }
            default:
              await requestAction(transition.action, [featureId], effectiveRepo);
          }
        }
      };
    }


