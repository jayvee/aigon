/* dashboard-esm-processed */
/**
 * F650: client render helpers for server-owned cardPresentation payloads.
 * HTML only — derivation lives in lib/card-presentation.js.
 */
import { _formatHeadlineAge, escHtml } from './utils.js';

function timelineIcon(status) {
    if (status === 'failed') return '✕';
    if (status === 'complete') return '✓';
    return '○';
}

function timelineItemClass(status) {
    if (status === 'failed') return 'kcard-timeline-item is-failed';
    if (status === 'complete') return 'kcard-timeline-item is-complete';
    return 'kcard-timeline-item';
}

export function buildCardTimelineHtml(item) {
    const pres = item && item.cardPresentation;
    const timeline = pres && Array.isArray(pres.timeline) ? pres.timeline : [];
    if (timeline.length === 0) return '';
    const isQuiet = pres.severity === 'error' || pres.severity === 'warning';
    const rows = timeline.map((entry) => {
        const detail = entry.detail ? ' <span class="kcard-timeline-detail">' + escHtml(entry.detail) + '</span>' : '';
        return '<li class="' + timelineItemClass(entry.status) + '">' +
          '<span class="kcard-timeline-icon" aria-hidden="true">' + timelineIcon(entry.status) + '</span>' +
          '<span class="kcard-timeline-label">' + escHtml(entry.label) + detail + '</span>' +
        '</li>';
    }).join('');
    return '<div class="kcard-timeline' + (isQuiet ? ' is-quiet' : '') + '" aria-label="Progress">' +
      '<div class="kcard-timeline-heading">Progress</div>' +
      '<ul class="kcard-timeline-list">' + rows + '</ul>' +
    '</div>';
}

export function buildCardAgentSummaryHtml(item) {
    const pres = item && item.cardPresentation;
    if (!pres || !pres.agentSummary || !pres.compactAgents) return '';
    return '<div class="kcard-agent-summary" title="Agents">' +
      '<span class="kcard-agent-summary-label">Agents</span> ' +
      escHtml(pres.agentSummary) +
    '</div>';
}

export function buildMonitorStateHtml(item) {
    const h = item && item.cardHeadline;
    if (!h || !h.verb) return '';
    const pres = item.cardPresentation || {};
    const tone = escHtml(h.tone || 'idle');
    const ageStr = _formatHeadlineAge(h.age);
    const verbLine = ageStr && (pres.severity === 'error' || h.tone === 'warn')
        ? escHtml(h.verb) + ' · ' + escHtml(ageStr)
        : escHtml(h.verb);
    const context = pres.contextLine
        ? '<div class="monitor-state-context">' + escHtml(pres.contextLine) + '</div>'
        : '';
    const timeline = buildCardTimelineHtml(item);
    const agents = buildCardAgentSummaryHtml(item);
    return '<div class="monitor-state-block tone-' + tone + '" data-headline-tone="' + tone + '">' +
      '<div class="monitor-state-headline">' + verbLine + '</div>' +
      context +
      timeline +
      agents +
    '</div>';
}
