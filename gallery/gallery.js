// F679: the Cards and Pipeline views render through the production contract
// card renderer (templates/dashboard/js/contract-cards). The gallery is a
// deliberate adapter around it: production markup and styles, with action and
// Peek clicks routed into the gallery's deterministic drawers instead of the
// live dashboard dispatch.
import { renderContractCardBody, renderSetContractCardBody } from '/js/contract-cards/card.js';

const state = {
  data: null,
  view: 'cards',
  entity: 'all',
  query: '',
  activeScenario: null,
  monitorKey: 'feature-autonomous-review-failed',
};

const laneLabels = {
  inbox: 'Inbox',
  backlog: 'Backlog',
  'in-progress': 'In progress',
  'in-evaluation': 'Evaluation and close',
  paused: 'Paused',
  done: 'Done',
};
const laneOrder = ['inbox', 'backlog', 'in-progress', 'in-evaluation', 'paused', 'done'];
const monitorProfiles = {
  'feature-autonomous-review-failed': { displayKey: 'F675', name: 'Unify dashboard interaction contract' },
  'feature-agent-needs-attention': { displayKey: 'F702', name: 'Repair agent failover' },
  'feature-autonomous-fleet-running': { displayKey: 'F713', name: 'Build status cache' },
  'set-running': { displayKey: 'autonomous-recovery', name: 'Autonomous recovery' },
  'research-fleet-in-progress': { displayKey: 'R204', name: 'Evaluate retrieval strategies' },
  'feature-session-ended': { displayKey: 'F608', name: 'Persist run checkpoints' },
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dedupeActions(actions) {
  const seen = new Set();
  return (actions || []).filter(action => {
    const key = `${action.actionId}:${action.agentId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function statusLabel(status) {
  const labels = {
    running: 'working',
    researching: 'researching',
    'quota-paused': 'quota paused',
    ready: 'complete',
    failed: 'failed',
    lost: 'session lost',
  };
  return labels[status] || String(status || '').replace(/_/g, ' ').replace(/-/g, ' ');
}

function actionDisplayLabel(action, scenario) {
  const autonomousLabels = {
    'feature-autonomous-stop': 'Stop autonomous run',
    'feature-autonomous-resume': 'Resume autonomous run',
    'autonomous-recover': 'Recover autonomous run',
    'set-autonomous-stop': 'Stop autonomous run',
    'set-autonomous-resume': 'Resume with same agents',
    'set-autonomous-reset': 'Reset autonomous run',
    'mark-submitted': 'Mark complete',
  };
  if (action.actionId === 'set-autonomous-start') {
    return /^Resume/i.test(action.label || '') ? 'Resume with different agents' : 'Start autonomous run';
  }
  if (autonomousLabels[action.actionId]) return autonomousLabels[action.actionId];
  return action.label || action.actionId;
}

function actionLabel(action, scenario) {
  const suffix = action.agentId ? ` · ${String(action.agentId).toUpperCase()}` : '';
  return `${actionDisplayLabel(action, scenario)}${suffix}`;
}

function cardBadgeLabel(scenario) {
  if (scenario.entityType !== 'set') return scenario.modeLabel;
  const members = scenario.contract.plan && scenario.contract.plan.members || [];
  return `${members.length} feature${members.length === 1 ? '' : 's'}`;
}

function inventoryActionHtml(action, primaryId, className = '', scenario = null) {
  const classes = ['inventory-action', className];
  if (action.actionId === primaryId) classes.push('primary');
  if (action.group === 'tool') classes.push('tool');
  if (action.intent === 'danger' || (action.interaction && action.interaction.destructive)) classes.push('danger');
  return `<span class="${classes.filter(Boolean).join(' ')}">${escapeHtml(actionLabel(action, scenario))}</span>`;
}

function activityHtml(scenario) {
  const contract = scenario.contract;
  const sessions = contract.sessions || [];
  const owned = new Set(contract.plan && contract.plan.ownedSessionIds || []);
  if (contract.plan && contract.plan.controllerSessionId) owned.add(contract.plan.controllerSessionId);
  const renderedSessions = new Set();
  const rows = (contract.agents || []).map(agent => {
    const inspectable = sessions.find(item => item.inspectable && item.agentId === agent.id && !owned.has(item.sessionId));
    if (contract.plan && sessions.some(item => owned.has(item.sessionId) && item.agentId === agent.id)) return '';
    if (inspectable) renderedSessions.add(inspectable.sessionId);
    return `<div class="activity-row">
      <span class="agent-status-dot ${escapeHtml(agent.status)}"></span>
      <b>${escapeHtml(String(agent.id).toUpperCase())}</b>
      <span>${escapeHtml(statusLabel(agent.status))}</span>
      ${inspectable ? `<button type="button" class="peek-button" data-open-scenario="${escapeHtml(scenario.key)}" data-peek-session="${escapeHtml(inspectable.sessionId)}">Peek</button>` : ''}
    </div>`;
  }).filter(Boolean);
  sessions.filter(item => item.inspectable && !owned.has(item.sessionId) && !renderedSessions.has(item.sessionId)).forEach(item => {
    rows.push(`<div class="activity-row">
      <span class="agent-status-dot ${escapeHtml(item.status || 'running')}"></span>
      <b>${escapeHtml(item.agentId ? String(item.agentId).toUpperCase() : 'Aigon')}</b>
      <span>${escapeHtml(item.label || statusLabel(item.role))}</span>
      <button type="button" class="peek-button" data-open-scenario="${escapeHtml(scenario.key)}" data-peek-session="${escapeHtml(item.sessionId)}">Peek</button>
    </div>`);
  });
  return rows.length ? `<div class="activity-list">${rows.join('')}</div>` : '';
}

function stageMarker(status) {
  if (status === 'complete') return '✓';
  if (status === 'running') return '●';
  if (status === 'failed') return '!';
  return '○';
}

function autonomousPlanHtml(scenario) {
  return autonomousPlanForContractHtml(scenario.contract, scenario);
}

function peekForSession(contract, sessionId, scenario) {
  const found = (contract.sessions || []).find(session => session.sessionId === sessionId && session.inspectable);
  return found ? `<button type="button" class="peek-button" data-open-scenario="${escapeHtml(scenario.key)}" data-peek-session="${escapeHtml(found.sessionId)}">Peek</button>` : '';
}

function autonomousPlanForContractHtml(contract, scenario) {
  const plan = contract && contract.plan;
  if (!plan || !Array.isArray(plan.stages)) return '';
  const controller = plan.controller || scenario.autonomousController || {};
  const controllerStatus = controller.status === 'stopped' ? 'Stopped' : controller.status === 'failed' ? 'Failed' : 'Running';
  return `<div class="run-plan">
    <div class="run-plan-header"><strong>Autonomous run</strong><span class="run-plan-controller"><span class="run-status ${escapeHtml(controller.status || 'running')}">${escapeHtml(controllerStatus)}</span>${peekForSession(contract, plan.controllerSessionId, scenario)}</span></div>
    <div class="run-stages">${plan.stages.map(stage => {
      const agents = (stage.agents || []).map(agent => String(agent.id).toUpperCase()).join(' + ');
      const sessionId = stage.sessionIds && stage.sessionIds[0];
      return `<div class="run-stage ${escapeHtml(stage.status)}">
        <span class="run-stage-marker">${stageMarker(stage.status)}</span>
        <b class="run-stage-label">${escapeHtml(stage.label)}</b>
        <small class="run-stage-agent">${escapeHtml(agents)}</small>
        <span class="run-stage-action">${peekForSession(contract, sessionId, scenario)}</span>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function setPlanHtml(scenario) {
  if (scenario.entityType !== 'set') return '';
  const plan = scenario.contract.plan || scenario.setPlan;
  if (!plan) return '';
  const percent = plan.progress.total ? Math.round((plan.progress.complete / plan.progress.total) * 100) : 0;
  return `<div class="set-plan">
    <div class="set-progress"><span>${plan.progress.complete} of ${plan.progress.total} complete</span><span>${escapeHtml(scenario.stateLabel)}</span></div>
    <div class="set-progress-track"><span style="width:${percent}%"></span></div>
    <div class="set-members">${plan.members.map(member => `<div class="set-member ${escapeHtml(member.status)}">
      <span class="run-stage-marker">${stageMarker(member.status === 'inbox' || member.status === 'backlog' ? 'waiting' : member.status)}</span>
      <span><b>${member.id === 'new' ? '' : `F${escapeHtml(member.id)} `}${escapeHtml(member.label || member.name)}</b><small>${escapeHtml(statusLabel(member.status))}</small></span>
    </div>`).join('')}</div>
    ${plan.currentFeatureContract ? `<div class="set-current-run">
      <div class="set-current-heading"><span>Current feature</span><strong>${escapeHtml(plan.currentFeatureContract.entity.displayKey)} ${escapeHtml(plan.currentFeatureContract.entity.name)}</strong></div>
      ${activityHtml({ ...scenario, contract: plan.currentFeatureContract })}
      ${autonomousPlanForContractHtml(plan.currentFeatureContract, scenario)}
    </div>` : ''}
  </div>`;
}

// Production card body for one gallery scenario — the same modules the
// Production pipeline imports the same contract-card modules as the gallery.
function productionCardHtml(scenario, options = {}) {
  const contract = scenario.contract;
  const body = scenario.entityType === 'set'
    ? renderSetContractCardBody(contract, {})
    : renderContractCardBody(contract, {
      badgeLabel: scenario.modeLabel,
      density: options.density || 'expanded',
    });
  const frameKind = scenario.entityType === 'research' ? ' is-research' : (scenario.entityType === 'set' ? ' is-set' : '');
  const memberStack = scenario.entityType === 'set' && scenario.showExpandedMembers
    ? `<div class="gallery-set-stack" aria-label="Expanded feature set members">${(scenario.memberContracts || []).map(member => (
      `<div class="gallery-set-member">${renderContractCardBody(member, { density: 'compact', setStackIdle: true })}</div>`
    )).join('')}</div>`
    : '';
  return `<div class="ccard-frame${frameKind}">${body}${memberStack}</div>`;
}

function cardHtml(scenario) {
  const contract = scenario.contract;
  const decisions = dedupeActions(contract.decisions.actions);
  const tools = dedupeActions(contract.tools);
  const allInventory = [...decisions, ...tools];
  const unmapped = scenario.unmappedEngineActions || [];
  const duplicateCount = (scenario.duplicateActions || []).reduce((sum, item) => sum + item.count - 1, 0);

  const inventoryHtml = `<div class="action-inventory">
    <div class="inventory-heading">
      <span>${allInventory.length} dashboard action${allInventory.length === 1 ? '' : 's'}</span>
      <button type="button" data-open-scenario="${escapeHtml(scenario.key)}">Inspect</button>
    </div>
    <div class="inventory-list">
      ${allInventory.map(action => inventoryActionHtml(action, contract.decisions.primaryActionId, '', scenario)).join('')}
      ${unmapped.map(action => inventoryActionHtml({ ...action, group: 'unmapped' }, null, 'unmapped', scenario)).join('')}
    </div>
    ${unmapped.length ? `<div class="inventory-warning">${unmapped.length} engine action${unmapped.length === 1 ? '' : 's'} lack a dashboard mapping.</div>` : ''}
    ${duplicateCount ? `<div class="inventory-warning">${duplicateCount} duplicate dashboard action ${duplicateCount === 1 ? 'entry' : 'entries'} collapsed in this mockup.</div>` : ''}
  </div>`;

  return `<article class="scenario" data-scenario-key="${escapeHtml(scenario.key)}">
    <div class="scenario-caption">
      <strong>${escapeHtml(scenario.scenario)}</strong>
      <span>${escapeHtml(scenario.entityType)} · ${escapeHtml(scenario.state)}</span>
    </div>
    ${productionCardHtml(scenario)}
    ${inventoryHtml}
  </article>`;
}

function scenarioByKey(key) {
  return state.data && state.data.scenarios.find(item => item.key === key);
}

function monitorScenario(key) {
  const scenario = scenarioByKey(key);
  const profile = monitorProfiles[key];
  if (!scenario || !profile) return scenario;
  return {
    ...scenario,
    contract: {
      ...scenario.contract,
      entity: { ...scenario.contract.entity, ...profile },
    },
  };
}

function cardButtonsHtml(scenario, limit = 2) {
  const contract = scenario.contract;
  const decisions = dedupeActions(contract.decisions.actions).filter(action => !action.agentId);
  const primary = decisions.find(action => action.actionId === contract.decisions.primaryActionId) || decisions[0] || null;
  const visible = [primary, ...decisions.filter(action => action !== primary)].filter(Boolean).slice(0, limit);
  const hidden = Math.max(0, decisions.length + contract.tools.length - visible.length);
  const buttons = visible.map(action => `<button type="button" class="card-action ${action === primary ? 'primary' : ''}" data-open-scenario="${escapeHtml(scenario.key)}">${escapeHtml(actionDisplayLabel(action, scenario))}</button>`).join('');
  return `${buttons}${hidden ? `<button type="button" class="card-action icon-only" data-open-scenario="${escapeHtml(scenario.key)}" aria-label="Show ${hidden} more actions" title="More actions">…</button>` : ''}`;
}

function pipelineCardHtml(key, options = {}) {
  const scenario = scenarioByKey(key);
  if (!scenario) return '';
  return `<article class="pipeline-card ${options.compact ? 'compact' : ''} ${options.muted ? 'muted' : ''}" data-pipeline-scenario="${escapeHtml(key)}">
    <div class="pipeline-card-main">${productionCardHtml(scenario, { density: options.compact ? 'compact' : 'expanded' })}</div>
  </article>`;
}

function renderPipeline() {
  const columns = [
    { label: 'Inbox', cards: [['feature-inbox-solo_worktree', true], ['research-inbox-solo_worktree', true]] },
    { label: 'Backlog', cards: [['feature-backlog-blocked', true], ['feature-backlog-review-feedback', true], ['set-ready', true]] },
    { label: 'In progress', cards: [['feature-autonomous-running', false], ['set-running', false]] },
    { label: 'Review and close', cards: [['feature-autonomous-reviewing', false], ['feature-close-merge-conflict', false]] },
    { label: 'Paused', cards: [['feature-quota-paused', true], ['set-paused-failure', true]] },
    { label: 'Done', cards: [['feature-done-solo_worktree', true, true], ['research-done-solo_worktree', true, true]] },
  ];
  document.getElementById('pipeline-view').innerHTML = `<div class="dashboard-preview" data-dashboard-preview="pipeline">
    <div class="dashboard-preview-bar">
      <div class="preview-repo"><span></span><b>brewboard</b></div>
      <div class="segmented" aria-label="Entity type"><button class="segment active" type="button">Features</button><button class="segment" type="button">Research</button><button class="segment" type="button">Sets</button></div>
      <div class="preview-counts"><span class="preview-count">4 active</span><span class="preview-count">2 need attention</span></div>
    </div>
    <div class="pipeline-board">${columns.map(column => `<section class="pipeline-column" data-pipeline-column="${escapeHtml(column.label.toLowerCase().replace(/ /g, '-'))}">
      <header class="pipeline-column-header">${escapeHtml(column.label)}<span>${column.cards.length}</span></header>
      <div class="pipeline-stack">${column.cards.map(([key, compact, muted]) => pipelineCardHtml(key, { compact, muted })).join('')}</div>
    </section>`).join('')}</div>
  </div>`;
}

function monitorItemHtml(key, options = {}) {
  const scenario = monitorScenario(key);
  if (!scenario) return '';
  const active = state.monitorKey === key;
  const headline = scenario.contract.presentation.headline && scenario.contract.presentation.headline.verb || scenario.contract.state.label;
  const identity = scenario.entityType === 'set'
    ? scenario.contract.entity.name
    : `${scenario.contract.entity.displayKey} ${scenario.contract.entity.name}`;
  return `<button type="button" class="monitor-item ${options.attention ? 'attention' : ''} ${active ? 'active' : ''}" data-monitor-key="${escapeHtml(key)}">
    <span class="monitor-item-dot"></span>
    <span class="monitor-item-copy"><strong>${escapeHtml(identity)}</strong><span>${escapeHtml(headline)}</span></span>
    <span class="monitor-item-time">${escapeHtml(options.time || 'now')}</span>
  </button>`;
}

function monitorFocusHtml() {
  const scenario = monitorScenario(state.monitorKey) || monitorScenario('feature-autonomous-review-failed');
  const contract = scenario.contract;
  const headline = contract.presentation.headline && contract.presentation.headline.verb || contract.state.label;
  const ownedSessions = new Set(contract.plan && contract.plan.ownedSessionIds || []);
  if (contract.plan && contract.plan.controllerSessionId) ownedSessions.add(contract.plan.controllerSessionId);
  const extraSessions = (contract.sessions || []).filter(session => session.inspectable && !ownedSessions.has(session.sessionId));
  return `<section class="monitor-focus">
    <header class="monitor-panel-header"><h2>Run detail</h2><span>Updated just now</span></header>
    <div class="monitor-focus-body">
      <div class="monitor-focus-title">
        <div><span class="card-key">${escapeHtml(scenario.entityType === 'set' ? cardBadgeLabel(scenario) : `${contract.entity.displayKey} · ${scenario.modeLabel}`)}</span><h2>${escapeHtml(contract.entity.name)}</h2></div>
        <div class="monitor-focus-actions">${cardButtonsHtml(scenario, 2)}</div>
      </div>
      <p class="monitor-focus-copy"><strong>${escapeHtml(headline)}</strong><br>${escapeHtml(contract.presentation.contextLine || scenario.detail || '')}</p>
      <div class="monitor-detail-grid">
        <section class="monitor-detail-section"><h3>Run progress</h3>${autonomousPlanHtml(scenario) || activityHtml(scenario) || '<span class="no-actions">No active run plan</span>'}</section>
        <section class="monitor-detail-section">
          ${extraSessions.length ? `<h3>Other sessions</h3>${extraSessions.map(session => `<div class="monitor-session"><span class="agent-status-dot ${escapeHtml(session.status || (session.running ? 'running' : 'ready'))}"></span><span><strong>${escapeHtml(session.agentId ? String(session.agentId).toUpperCase() : 'Aigon')}</strong><small>${escapeHtml(statusLabel(session.role || session.status))}</small></span><button type="button" class="peek-button" data-open-scenario="${escapeHtml(scenario.key)}" data-peek-session="${escapeHtml(session.sessionId)}">Peek</button></div>`).join('')}` : ''}
          <h3>Recent events</h3>
          <div class="monitor-event"><time>12:48</time><span>Review session stopped before completion</span></div>
          <div class="monitor-event"><time>12:44</time><span>Implementation completed by CC</span></div>
          <div class="monitor-event"><time>12:31</time><span>Autonomous run started</span></div>
        </section>
      </div>
    </div>
  </section>`;
}

function renderMonitor() {
  document.getElementById('monitor-view').innerHTML = `<div class="dashboard-preview" data-dashboard-preview="monitor">
    <div class="monitor-summary">
      <div class="monitor-stat"><strong>2</strong><span>Need attention</span></div>
      <div class="monitor-stat"><strong>4</strong><span>Runs active</span></div>
      <div class="monitor-stat"><strong>7</strong><span>Sessions available</span></div>
      <div class="monitor-stat"><strong>3</strong><span>Completed recently</span></div>
    </div>
    <div class="monitor-layout">
      <aside class="monitor-queue">
        <header class="monitor-panel-header"><h2>Live work</h2><span>All repositories</span></header>
        <div class="monitor-section-label">NEEDS ATTENTION</div>
        ${monitorItemHtml('feature-autonomous-review-failed', { attention: true, time: '2m' })}
        ${monitorItemHtml('feature-agent-needs-attention', { attention: true, time: '8m' })}
        <div class="monitor-section-label">RUNNING</div>
        ${monitorItemHtml('feature-autonomous-fleet-running', { time: 'now' })}
        ${monitorItemHtml('set-running', { time: '3m' })}
        ${monitorItemHtml('research-fleet-in-progress', { time: '5m' })}
        <div class="monitor-section-label">RECENTLY COMPLETED</div>
        ${monitorItemHtml('feature-session-ended', { time: '14m' })}
      </aside>
      ${monitorFocusHtml()}
    </div>
  </div>`;
}

function scenarioSearchText(scenario) {
  const contract = scenario.contract;
  return [
    scenario.entityType,
    scenario.state,
    scenario.stateLabel,
    scenario.scenario,
    scenario.detail,
    contract.entity.displayKey,
    contract.entity.name,
    ...contract.decisions.actions.flatMap(action => [action.actionId, action.label]),
    ...contract.tools.flatMap(action => [action.actionId, action.label]),
    ...scenario.unmappedEngineActions.flatMap(action => [action.actionId, action.label]),
    ...(scenario.autonomousPlan ? scenario.autonomousPlan.stages.flatMap(stage => [stage.label, stage.status]) : []),
    ...(scenario.setPlan ? scenario.setPlan.members.flatMap(member => [member.id, member.name, member.status]) : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function visibleScenarios() {
  if (!state.data) return [];
  return state.data.scenarios.filter(scenario => {
    if (state.entity !== 'all' && scenario.entityType !== state.entity) return false;
    if (state.query && !scenarioSearchText(scenario).includes(state.query)) return false;
    return true;
  });
}

function renderGallery() {
  const scenarios = visibleScenarios();
  const groups = document.getElementById('gallery-groups');
  document.getElementById('result-count').textContent = `${scenarios.length} of ${state.data.scenarios.length} scenarios`;
  document.getElementById('gallery-status').hidden = true;
  if (!scenarios.length) {
    groups.innerHTML = '<div class="empty-results">No card states match these filters.</div>';
    return;
  }
  groups.innerHTML = laneOrder.map(lane => {
    const laneScenarios = scenarios.filter(scenario => scenario.lane === lane);
    if (!laneScenarios.length) return '';
    return `<section class="state-group">
      <div class="group-heading"><h2>${escapeHtml(laneLabels[lane])}</h2><span>${laneScenarios.length} scenarios</span></div>
      <div class="scenario-grid">${laneScenarios.map(cardHtml).join('')}</div>
    </section>`;
  }).join('');
}

function renderView() {
  const copy = {
    cards: {
      title: 'Feature, research, and feature set cards',
      note: state.data.note,
    },
    pipeline: {
      title: 'Pipeline',
      note: 'Full-width lifecycle planning with card density matched to each stage.',
    },
    monitor: {
      title: 'Monitor',
      note: 'Live work, attention, run progress, sessions, and recent events across repositories.',
    },
  }[state.view];
  document.getElementById('gallery-title').textContent = copy.title;
  document.getElementById('gallery-note').textContent = copy.note;
  document.getElementById('cards-toolbar').hidden = state.view !== 'cards';
  document.getElementById('cards-view').hidden = state.view !== 'cards';
  document.getElementById('pipeline-view').hidden = state.view !== 'pipeline';
  document.getElementById('monitor-view').hidden = state.view !== 'monitor';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  if (state.view === 'cards') renderGallery();
  if (state.view === 'pipeline') renderPipeline();
  if (state.view === 'monitor') renderMonitor();
}

function actionDetailHtml(action, unmapped = false, scenario = null) {
  const scope = action.agentId ? `Agent ${String(action.agentId).toUpperCase()}` : (action.scope || 'Entity');
  const notes = [];
  if (unmapped) notes.push('Engine action has no dashboard mapping.');
  if (action.disabled && action.unavailableReason) notes.push(action.unavailableReason);
  if (action.interaction && action.interaction.requiredInput) notes.push(`Requires ${action.interaction.requiredInput}.`);
  if (action.interaction && action.interaction.confirmation) notes.push('Requires confirmation.');
  return `<div class="action-detail">
    <div class="action-detail-title"><strong>${escapeHtml(actionLabel(action, scenario))}</strong><span class="action-id">${escapeHtml(action.actionId)}</span></div>
    <p>${escapeHtml(`${scope}${notes.length ? ` · ${notes.join(' ')}` : ''}`)}</p>
  </div>`;
}

function drawerSection(title, actions, description, unmapped = false, scenario = null) {
  if (!actions.length) return '';
  return `<section class="drawer-section">
    <h3>${escapeHtml(title)}</h3>
    ${description ? `<p>${escapeHtml(description)}</p>` : ''}
    ${actions.map(action => actionDetailHtml(action, unmapped, scenario)).join('')}
  </section>`;
}

function openScenarioDrawer(key) {
  const scenario = state.view === 'monitor' ? monitorScenario(key) : scenarioByKey(key);
  if (!scenario) return;
  state.activeScenario = scenario;
  const contract = scenario.contract;
  document.getElementById('drawer-key').textContent = `${contract.entity.displayKey} · ${scenario.modeLabel} · ${scenario.state}`;
  document.getElementById('drawer-title').textContent = scenario.scenario;
  document.getElementById('drawer-body').innerHTML = `
    ${drawerSection('Available decisions', dedupeActions(contract.decisions.actions), 'Workflow choices that can change the entity state.', false, scenario)}
    ${drawerSection('Tools', dedupeActions(contract.tools), 'Session, inspection, and recovery controls that do not define the next workflow state.', false, scenario)}
    ${drawerSection('Contract gaps', scenario.unmappedEngineActions, 'These actions are valid in the engine but cannot currently be rendered from dashboard actions.', true, scenario)}
    ${scenario.duplicateActions.length ? `<section class="drawer-section"><h3>Duplicate identities</h3><div class="diagnostic-box">${escapeHtml(scenario.duplicateActions.map(item => `${item.id} appears ${item.count} times`).join(' · '))}</div></section>` : ''}
  `;
  document.getElementById('drawer-scrim').hidden = false;
  document.getElementById('action-drawer').hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('drawer-close-icon').focus();
}

function coverageEntityHtml(label, coverage) {
  const missing = coverage.unmappedActionKinds || [];
  return `<section class="drawer-section">
    <h3>${escapeHtml(label)}</h3>
    <div class="coverage-row"><span>Resting states</span><strong>${coverage.coveredStates.length} / ${coverage.restingStates.length}</strong></div>
    <div class="coverage-row"><span>Defined action kinds</span><strong>${coverage.actionCatalog.length}</strong></div>
    <div class="coverage-row"><span>Dashboard mapping gaps</span><strong>${missing.length}</strong></div>
    ${missing.length ? `<div class="diagnostic-box">${escapeHtml(missing.map(action => action.actionId).join(' · '))}</div>` : ''}
    <div class="action-detail">
      <div class="action-detail-title"><strong>Automatic states not rendered</strong></div>
      <p>${escapeHtml(coverage.internalStates.map(item => item.state).join(' · '))}</p>
    </div>
  </section>`;
}

function openCoverageDrawer() {
  const coverage = state.data.coverage;
  state.activeScenario = null;
  document.getElementById('drawer-key').textContent = 'Workflow definition coverage';
  document.getElementById('drawer-title').textContent = 'Contract coverage';
  document.getElementById('drawer-body').innerHTML = `
    <section class="drawer-section"><p>Every resting engine state has at least one card. Hydration and transient states are listed here because they automatically route and should never render as stable UI.</p></section>
    <section class="drawer-section">
      <h3>Structural contract gaps</h3>
      ${(state.data.contractGaps || []).map(gap => `<div class="diagnostic-box">${escapeHtml(gap.label)}</div>`).join('')}
    </section>
    ${coverageEntityHtml('Features', coverage.feature)}
    ${coverageEntityHtml('Research', coverage.research)}
    ${coverageEntityHtml('Feature sets', coverage.set)}
  `;
  document.getElementById('drawer-scrim').hidden = false;
  document.getElementById('action-drawer').hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('drawer-close-icon').focus();
}

function findScenarioSession(contract, sessionId) {
  if (!contract) return null;
  const direct = (contract.sessions || []).find(item => item.sessionId === sessionId);
  if (direct) return direct;
  // Embedded current-member contracts own their stage sessions.
  const embedded = contract.plan && contract.plan.currentFeatureContract;
  return embedded ? findScenarioSession(embedded, sessionId) : null;
}

function openSessionDrawer(scenarioKey, sessionId) {
  const scenario = state.view === 'monitor' ? monitorScenario(scenarioKey) : scenarioByKey(scenarioKey);
  const session = scenario && findScenarioSession(scenario.contract, sessionId);
  if (!scenario || !session) return;
  const status = session.status || (session.running ? 'running' : 'complete');
  const mode = session.running ? 'Live session' : 'Saved session output';
  document.getElementById('drawer-key').textContent = `${scenario.contract.entity.displayKey} · ${session.role || 'session'}`;
  document.getElementById('drawer-title').textContent = 'Session output';
  document.getElementById('drawer-body').innerHTML = `
    <section class="drawer-section">
      <div class="session-console-meta"><span>${escapeHtml(mode)}</span><strong>${escapeHtml(statusLabel(status))}</strong></div>
      <pre class="session-console">$ aigon session ${escapeHtml(session.sessionId)}
[${escapeHtml(status)}] ${escapeHtml(session.label || session.role || 'Agent session')}
Contract gallery output is deterministic and read-only.</pre>
    </section>`;
  document.getElementById('drawer-scrim').hidden = false;
  document.getElementById('action-drawer').hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('drawer-close-icon').focus();
}

function closeDrawer() {
  document.getElementById('drawer-scrim').hidden = true;
  document.getElementById('action-drawer').hidden = true;
  document.body.style.overflow = '';
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderView();
    });
  });
  document.querySelectorAll('[data-entity]').forEach(button => {
    button.addEventListener('click', () => {
      state.entity = button.dataset.entity;
      document.querySelectorAll('[data-entity]').forEach(item => item.classList.toggle('active', item === button));
      renderGallery();
    });
  });
  document.getElementById('gallery-search').addEventListener('input', event => {
    state.query = event.target.value.trim().toLowerCase();
    renderGallery();
  });
  document.getElementById('inventory-toggle').addEventListener('change', event => {
    document.body.classList.toggle('inventory-hidden', !event.target.checked);
  });
  document.querySelector('main').addEventListener('click', event => {
    const monitorItem = event.target.closest('[data-monitor-key]');
    if (monitorItem) {
      state.monitorKey = monitorItem.dataset.monitorKey;
      renderMonitor();
      return;
    }
    // Production-renderer hooks (Cards + Pipeline views): route the shared
    // dispatch classes into the gallery's deterministic drawers.
    const scenarioKeyFor = (el) => {
      const host = el.closest('[data-scenario-key], [data-pipeline-scenario]');
      return host ? (host.dataset.scenarioKey || host.dataset.pipelineScenario) : null;
    };
    const peekBtn = event.target.closest('.kcard-peek-btn[data-peek-session]');
    if (peekBtn) {
      const key = scenarioKeyFor(peekBtn);
      if (key) openSessionDrawer(key, peekBtn.dataset.peekSession);
      return;
    }
    const overflowToggle = event.target.closest('.kcard-overflow-toggle');
    if (overflowToggle) {
      const menu = overflowToggle.parentElement.querySelector('.kcard-overflow-menu');
      const isOpen = menu && menu.classList.contains('open');
      document.querySelectorAll('.kcard-overflow-menu.open').forEach(m => m.classList.remove('open'));
      if (menu && !isOpen) {
        menu.classList.add('open');
        const rect = overflowToggle.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${Math.max(8, rect.right - menu.getBoundingClientRect().width)}px`;
      }
      return;
    }
    if (!event.target.closest('.kcard-overflow-menu')) {
      document.querySelectorAll('.kcard-overflow-menu.open').forEach(m => m.classList.remove('open'));
    }
    const vaBtn = event.target.closest('.kcard-va-btn');
    if (vaBtn) {
      const key = scenarioKeyFor(vaBtn);
      if (key) openScenarioDrawer(key);
      return;
    }
    const target = event.target.closest('[data-open-scenario]');
    if (!target) return;
    if (target.dataset.peekSession) {
      openSessionDrawer(target.dataset.openScenario, target.dataset.peekSession);
      return;
    }
    openScenarioDrawer(target.dataset.openScenario);
  });
  document.getElementById('diagnostics-button').addEventListener('click', openCoverageDrawer);
  document.getElementById('drawer-close-icon').addEventListener('click', closeDrawer);
  document.getElementById('drawer-close-button').addEventListener('click', closeDrawer);
  document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('action-drawer').hidden) closeDrawer();
  });
}

async function init() {
  bindEvents();
  try {
    const response = await fetch('/api/card-gallery', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    state.data = await response.json();
    const actionGaps = Object.values(state.data.coverage).reduce((sum, coverage) => sum + coverage.unmappedActionKinds.length, 0);
    const gaps = actionGaps + (state.data.contractGaps || []).length;
    document.getElementById('diagnostics-count').textContent = gaps ? `${gaps} gaps` : 'Complete';
    renderView();
  } catch (error) {
    document.getElementById('gallery-status').textContent = `Could not build the gallery: ${error.message}`;
  }
}

init();
