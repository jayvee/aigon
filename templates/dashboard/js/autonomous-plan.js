/* dashboard-esm-processed */
export const AIGON_AUTONOMOUS_PLAN = (function() {

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
    if (status === 'complete') return 'Implemented';
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

  function stageLabel(stage) {
    if (!stage) return 'Stage';
    if (stage.label) return String(stage.label);
    const type = stage.type ? String(stage.type) : '';
    if (!type) return 'Stage';
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  function buildAutonomousPlanHtml(plan, options) {
    const opts = options || {};
    if (!plan) return '';

    const peekButtonHtml = opts.peekButtonHtml || '';
    if (plan.error) {
      const message = plan.error.message || 'Autonomous plan unavailable.';
      return '<div class="kcard-autonomous-plan kcard-autonomous-plan-error-wrap">' +
        '<span class="kcard-autonomous-plan-error">' + escHtml(message) + '</span>' +
        peekButtonHtml +
        '</div>';
    }

    const stages = Array.isArray(plan.stages) ? plan.stages : [];
    if (stages.length === 0) return '';

    const items = stages.map(function(stage) {
      const status = stage && stage.status ? String(stage.status) : 'waiting';
      const label = stageLabel(stage);
      const titleBits = [label, statusLabel(status)];
      const agentSummary = stageAgentSummary(stage, opts);
      if (agentSummary) titleBits.push(agentSummary);
      // Completed stages inline the agent attribution so the track doubles as
      // an audit trail ("✓ Implement · Claude Code").
      const inlineAgent = (status === 'complete' && agentSummary)
        ? ' <span class="kcard-stage-agent">· ' + escHtml(agentSummary.split(' (')[0]) + '</span>'
        : '';
      return '<div class="kcard-stage is-' + escHtml(status) + '" role="listitem" title="' + escHtml(titleBits.join(' — ')) + '">' +
        '<span class="kcard-stage-marker">' + escHtml(stageMarker(status)) + '</span>' +
        '<span class="kcard-stage-label">' + escHtml(label) + inlineAgent + '</span>' +
        '</div>';
    }).join('');

    const header = peekButtonHtml
      ? '<div class="kcard-stage-track-header"><span class="kcard-stage-track-title">Autonomous plan</span>' + peekButtonHtml + '</div>'
      : '';

    return '<div class="kcard-autonomous-plan kcard-stage-track" role="list" aria-label="Autonomous plan stages">' +
      header +
      items +
      '</div>';
  }

  return {
    buildAutonomousPlanHtml: buildAutonomousPlanHtml,
  };

})();
export const buildAutonomousPlanHtml = AIGON_AUTONOMOUS_PLAN.buildAutonomousPlanHtml;
Object.assign(globalThis, { AIGON_AUTONOMOUS_PLAN, buildAutonomousPlanHtml });
