/* dashboard-esm-processed */

// F679 contract card renderer — shared HTML primitives.
//
// Every module in contract-cards/ is a pure contract → HTML string transform
// with no imports from dashboard singletons, so the same code renders in the
// production pipeline and in the design gallery. Event wiring stays with the
// caller: action buttons carry `kcard-va-btn` + `data-va-action`, Peek buttons
// carry `kcard-peek-btn` + `data-peek-session`, so the existing pipeline
// dispatch (handleFeatureAction / handleSetAction / openTerminalPanel) applies
// unchanged — the preview renderer introduces no alternate command path.

export function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const PEEK_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg>';

export function agentDisplay(agentId) {
  return agentId ? String(agentId).toUpperCase() : 'Aigon';
}

// Plain, sentence-case status language. No machine underscores, no shouting.
const AGENT_STATUS_LABELS = {
  running: 'working',
  researching: 'researching',
  'quota-paused': 'quota paused',
  ready: 'complete',
  complete: 'complete',
  completed: 'complete',
  failed: 'failed',
  lost: 'session lost',
  stopped: 'stopped',
  waiting: 'waiting',
  idle: 'working',
};

export function statusLabel(status) {
  const raw = String(status || '');
  return AGENT_STATUS_LABELS[raw] || raw.replace(/_/g, ' ').replace(/-/g, ' ');
}

export function statusDotClass(status) {
  const raw = String(status || '');
  if (raw === 'ready' || raw === 'complete' || raw === 'completed') return 'is-ready';
  if (raw === 'running' || raw === 'idle' || raw === 'waiting' || raw === 'researching') return 'is-running';
  if (raw === 'failed' || raw === 'lost' || raw === 'needs_attention') return 'is-failed';
  if (raw === 'quota-paused' || raw === 'stopped') return 'is-paused';
  return 'is-neutral';
}

/**
 * Peek control for one contract session. Dispatch hook: the caller wires
 * `.kcard-peek-btn[data-peek-session]` to the shared session boundary
 * (dashboard: openTerminalPanel; gallery: deterministic session drawer).
 */
export function peekButtonHtml(session, options = {}) {
  if (!session || !session.inspectable || !session.sessionId) return '';
  if (typeof options.canPeekSession === 'function' && !options.canPeekSession(session)) return '';
  const mode = session.inspection && session.inspection.mode === 'snapshot' ? 'snapshot' : 'live';
  const what = session.label || session.role || 'session';
  const title = mode === 'snapshot'
    ? 'Peek at saved output from ' + what
    : 'Peek at live ' + what + ' output';
  return '<button type="button" class="ccard-peek kcard-peek-btn" data-peek-session="' + escHtml(session.sessionId) + '"'
    + ' data-peek-mode="' + mode + '" aria-label="' + escHtml(title) + '" title="' + escHtml(title) + '">'
    + PEEK_ICON_SVG + '<span class="ccard-peek-text">Peek</span></button>';
}
