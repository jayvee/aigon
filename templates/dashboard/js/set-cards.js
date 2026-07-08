/* dashboard-esm-processed */
export const AIGON_SET_CARDS = (function() {

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTimestamp(value) {
    if (!value) return 'No conductor event yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function statusLabel(status) {
    const raw = String(status || 'idle');
    if (raw === 'paused-on-failure' || raw === 'paused-on-quota') return raw;
    return raw;
  }

  function conductorActivityLabel(autonomous) {
    if (!autonomous) return 'Conductor: inactive';
    const st = String(autonomous.status || '');
    if (autonomous.running || st === 'running') return 'Conductor: running';
    if (st === 'paused-on-failure' || st === 'paused-on-quota') return 'Conductor: paused';
    return 'Conductor: inactive';
  }

  function specReviewActivityLabel(specReview) {
    if (specReview && specReview.running) {
      return specReview.label || 'Spec review: running';
    }
    return 'Spec review: inactive';
  }

  function buildSetSessionActivityHtml(setCard, options) {
    const set = setCard || {};
    const specReview = set.specReview;
    const autonomous = set.autonomous;
    const specRunning = Boolean(specReview && specReview.running);
    const conductorRunning = Boolean(autonomous && (autonomous.running || autonomous.status === 'running'));
    const conductorPaused = Boolean(autonomous && (autonomous.status === 'paused-on-failure' || autonomous.status === 'paused-on-quota'));
    const peekHandler = options && typeof options.onPeek === 'function' ? options.onPeek : null;
    const specPeek = specRunning && specReview.sessionName && peekHandler
      ? '<button type="button" class="kcard-peek-btn set-session-peek" data-set-spec-review-session="' + escHtml(specReview.sessionName) + '" title="View set spec review session" aria-label="Peek set spec review session"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg></button>'
      : '';
    const conductorPeek = autonomous && autonomous.sessionName && peekHandler
      ? '<button type="button" class="kcard-peek-btn set-session-peek" data-set-conductor-session="' + escHtml(autonomous.sessionName) + '" title="View set autonomous conductor output" aria-label="Peek set conductor session"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg></button>'
      : '';

    return '<div class="set-session-activity">' +
      '<span class="set-session-pill' + (specRunning ? ' is-active' : ' is-inactive') + '">' +
        escHtml(specReviewActivityLabel(specReview)) +
        (specRunning && specReview.agent ? ' · ' + escHtml(specReview.agent) : '') +
        specPeek +
      '</span>' +
      '<span class="set-session-pill' + (conductorRunning ? ' is-active' : (conductorPaused ? ' is-paused' : ' is-inactive')) + '">' +
        escHtml(conductorActivityLabel(autonomous)) +
        conductorPeek +
      '</span>' +
    '</div>';
  }

  function buildSetDepGraphSvg(depGraph) {
    const graph = depGraph || {};
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    if (nodes.length === 0) {
      return '<div class="set-graph-empty">No set members</div>';
    }

    const slotWidth = 108;
    const width = Math.max(220, nodes.length * slotWidth);
    const height = 82;
    const radius = 11;
    const positions = new Map();
    nodes.forEach(function(node, index) {
      positions.set(String(node.featureId || node.id), {
        x: 28 + index * slotWidth,
        y: 28 + (index % 2 === 0 ? 0 : 14),
      });
    });

    const edgeMarkup = edges.map(function(edge) {
      const from = positions.get(String(edge.to));
      const to = positions.get(String(edge.from));
      if (!from || !to) return '';
      const dx = Math.max(18, (to.x - from.x) / 2);
      return '<path class="set-graph-edge" d="M ' + from.x + ' ' + from.y
        + ' C ' + (from.x + dx) + ' ' + from.y + ', ' + (to.x - dx) + ' ' + to.y + ', ' + to.x + ' ' + to.y + '" />';
    }).join('');

    const nodeMarkup = nodes.map(function(node) {
      const key = String(node.featureId || node.id);
      const pos = positions.get(key);
      const label = node.featureId ? ('#' + node.featureId) : node.label;
      const title = (node.featureId ? ('#' + node.featureId + ' ') : '') + (node.label || '');
      const classes = [
        'set-graph-node',
        'state-' + escHtml(node.state || 'backlog'),
        node.isCurrent ? 'is-current' : '',
      ].filter(Boolean).join(' ');
      return '<g class="' + classes + '" data-node-id="' + escHtml(key) + '" data-state="' + escHtml(node.state || 'backlog') + '">' +
        '<title>' + escHtml(title) + '</title>' +
        '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + radius + '"></circle>' +
        '<text x="' + pos.x + '" y="' + (pos.y + 30) + '" text-anchor="middle">' + escHtml(label) + '</text>' +
      '</g>';
    }).join('');

    return '<svg class="set-graph-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Set dependency graph">'
      + edgeMarkup + nodeMarkup + '</svg>';
  }

  function buildSetCardBodyHtml(setCard) {
    const set = setCard || {};
    const progress = set.progress || {};
    const current = set.currentFeature;
    const lastEvent = set.lastEvent;
    const currentLabel = current
      ? '<span class="set-card-current"><span class="set-card-label">Current</span><span>#' + escHtml(current.id) + ' ' + escHtml(current.label) + '</span></span>'
      : '<span class="set-card-current"><span class="set-card-label">Current</span><span>Idle</span></span>';
    const lastEventLabel = lastEvent && lastEvent.label ? lastEvent.label : 'No conductor event yet';
    const lastEventAt = lastEvent && lastEvent.at ? formatTimestamp(lastEvent.at) : '';

    return '<div class="set-card-stack">' +
      (set.goal ? '<p class="set-card-goal">' + escHtml(set.goal) + '</p>' : '') +
      buildSetSessionActivityHtml(set) +
      '<div class="set-card-status-row">' +
        '<span class="set-card-status is-' + escHtml(set.status || 'idle') + '">' + escHtml(statusLabel(set.status)) + '</span>' +
        '<span class="set-card-progress-text">' + escHtml(progress.merged || 0) + ' of ' + escHtml(progress.total || 0) + ' merged</span>' +
      '</div>' +
      '<div class="set-card-progress-track"><span style="width:' + escHtml(progress.percent || 0) + '%"></span></div>' +
      '<div class="set-card-meta-grid">' +
        currentLabel +
        '<span class="set-card-last-event"><span class="set-card-label">Last event</span><span>' + escHtml(lastEventLabel) + (lastEventAt ? ' · ' + escHtml(lastEventAt) : '') + '</span></span>' +
      '</div>' +
      '<div class="set-card-graph">' + buildSetDepGraphSvg(set.depGraph) + '</div>' +
    '</div>';
  }

  return {
    buildSetDepGraphSvg: buildSetDepGraphSvg,
    buildSetCardBodyHtml: buildSetCardBodyHtml,
    buildSetSessionActivityHtml: buildSetSessionActivityHtml,
    conductorActivityLabel: conductorActivityLabel,
    specReviewActivityLabel: specReviewActivityLabel,
  };

})();
