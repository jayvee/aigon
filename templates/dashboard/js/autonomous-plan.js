(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.AIGON_AUTONOMOUS_PLAN = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stageMarker(status) {
    if (status === 'complete') return '✓';
    if (status === 'running') return '●';
    if (status === 'failed') return '!';
    return '○';
  }

  function statusLabel(status) {
    if (status === 'complete') return 'Complete';
    if (status === 'running') return 'Running';
    if (status === 'failed') return 'Failed';
    return 'Waiting';
  }

  function stageAgentSummary(stage, options) {
    const opts = options || {};
    const names = opts.agentDisplayNames || {};
    const agents = Array.isArray(stage && stage.agents) ? stage.agents : [];
    return agents.map(function(agent) {
      const id = agent && agent.id ? String(agent.id) : '';
      const display = names[id] || id;
      const meta = [agent && agent.model ? String(agent.model) : '', agent && agent.effort ? String(agent.effort) : '']
        .filter(Boolean)
        .join(' · ');
      return meta ? display + ' (' + meta + ')' : display;
    }).filter(Boolean).join(', ');
  }

  function buildAutonomousPlanHtml(plan, options) {
    const opts = options || {};
    if (!plan) return '';

    const peekButtonHtml = opts.peekButtonHtml || '';
    if (plan.error) {
      const message = plan.error.message || 'Autonomous plan unavailable.';
      return '<div class="kcard-agent kcard-autonomous-plan">' +
        '<div class="kcard-agent-header"><span class="kcard-agent-name">Autonomous plan</span>' + peekButtonHtml + '</div>' +
        '<div class="kcard-autonomous-plan-error">' + escHtml(message) + '</div>' +
        '</div>';
    }

    const rows = (Array.isArray(plan.stages) ? plan.stages : []).map(function(stage) {
      const status = stage && stage.status ? String(stage.status) : 'waiting';
      const statusText = statusLabel(status);
      const agentText = stageAgentSummary(stage, opts);
      return '<div class="kcard-autonomous-stage is-' + escHtml(status) + '">' +
        '<div class="kcard-autonomous-stage-main">' +
          '<span class="kcard-autonomous-stage-marker">' + escHtml(stageMarker(status)) + '</span>' +
          '<span class="kcard-autonomous-stage-label">' + escHtml(stage && stage.label ? stage.label : stage && stage.type ? stage.type : 'Stage') + '</span>' +
          (agentText ? '<span class="kcard-autonomous-stage-agents">' + escHtml(agentText) + '</span>' : '') +
        '</div>' +
        '<span class="kcard-agent-status status-' + escHtml(status) + '">' + escHtml(statusText) + '</span>' +
      '</div>';
    }).join('');

    return '<div class="kcard-agent kcard-autonomous-plan">' +
      '<div class="kcard-agent-header"><span class="kcard-agent-name">Autonomous plan</span>' + peekButtonHtml + '</div>' +
      '<div class="kcard-autonomous-plan-rows">' + rows + '</div>' +
      '</div>';
  }

  return {
    buildAutonomousPlanHtml: buildAutonomousPlanHtml,
  };
});
