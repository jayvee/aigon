(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.AIGON_SET_CARDS = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
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
    if (raw === 'paused-on-failure') return 'paused-on-failure';
    return raw;
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
  };
});
