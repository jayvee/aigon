/* dashboard-esm-processed */
// ── Close-log panel (feature 428) ─────────────────────────────────────────
// Live-streaming log panel for feature-close actions. Opens immediately on
// click, polls /api/action-log/:actionId every 800ms, auto-dismisses on
// success after 3s, stays open on failure with "Close with agent" button.
// Dismissing the panel only hides the drawer; it never cancels the close action.

const CLOSE_LOG_POLL_MS = 800;
let _pollTimer = null;
let _actionId = null;
let _seenLines = 0;
let _panelDone = false;
let _dismissed = false;

function $id(id) { return document.getElementById(id); }

function setState(s) {
  const p = $id('close-log-panel');
  if (p) p.dataset.state = s;
}

function annotateLine(raw) {
  const esc = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  if (/✅/.test(raw)) return '<span class="ll-ok">' + esc + '</span>';
  if (/❌/.test(raw)) return '<span class="ll-err">' + esc + '</span>';
  if (/📦|📤/.test(raw)) return '<span class="ll-pkg">' + esc + '</span>';
  if (/🔒/.test(raw)) return '<span class="ll-lock">' + esc + '</span>';
  if (/^[ \t]/.test(raw)) return '<span class="ll-dim">' + esc + '</span>';
  return esc;
}

function appendLines(lines) {
  const pre = $id('close-log-output');
  if (!pre) return;
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const span = document.createElement('span');
    span.innerHTML = annotateLine(line) + '\n';
    frag.appendChild(span);
  }
  pre.appendChild(frag);
  pre.scrollTop = pre.scrollHeight;
}

function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function pollCloseLog() {
  if (!_actionId) return;
  try {
    const res = await fetch('/api/action-log/' + encodeURIComponent(_actionId), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const newLines = (data.lines || []).slice(_seenLines);
    if (newLines.length) { appendLines(newLines); _seenLines += newLines.length; }
    if (data.done && !_panelDone) {
      _panelDone = true;
      stopPoll();
    }
  } catch (_) {}
}

function drainAndFinalize(actionId, success, result) {
  fetch('/api/action-log/' + encodeURIComponent(actionId), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.lines) {
        const newLines = data.lines.slice(_seenLines);
        if (newLines.length) { appendLines(newLines); _seenLines += newLines.length; }
      }
    })
    .catch(() => {})
    .finally(() => {
      if (!success && _seenLines === 0) {
        dismissCloseLogPanel();
        return;
      }
      setState(success ? 'success' : 'failure');
      const t = $id('close-log-title');
      if (t) t.textContent = success ? 'Closed' : 'Close failed';
      const f = $id('close-log-footer');
      if (f) {
        f.style.display = 'flex';
        if (success) {
          f.innerHTML = '<span class="close-log-done-label">Done ✓</span>';
          if (!_dismissed) {
            setTimeout(() => dismissCloseLogPanel(), 3000);
          }
        } else {
          const featureId = result && result._featureId;
          const agentId = result && result._agentId;
          const repoPath = result && result._repoPath;
          f.innerHTML = '<span class="close-log-fail-label">See log above for details</span>';
          if (featureId && agentId) {
            const agentBtn = document.createElement('button');
            agentBtn.className = 'btn btn-warn';
            agentBtn.textContent = 'Close with agent';
            agentBtn.addEventListener('click', () => {
              if (typeof handleCloseWithAgent === 'function') {
                handleCloseWithAgent(featureId, agentId, repoPath || '');
              }
              dismissCloseLogPanel();
            });
            f.appendChild(agentBtn);
          }
        }
        const x = $id('close-log-x');
        if (x) x.style.display = '';
      }
    });
}

function openCloseLogPanel(actionId, label) {
  _actionId = actionId;
  _seenLines = 0;
  _panelDone = false;
  _dismissed = false;
  stopPoll();

  const pre = $id('close-log-output'); if (pre) pre.innerHTML = '';
  const f = $id('close-log-footer'); if (f) { f.style.display = 'none'; f.innerHTML = ''; }
  const x = $id('close-log-x'); if (x) x.style.display = '';
  const t = $id('close-log-title'); if (t) t.textContent = 'Closing ' + (label || '…');
  setState('running');

  const overlay = $id('close-log-overlay');
  const panel = $id('close-log-panel');
  if (overlay) overlay.classList.add('open');
  if (panel) panel.classList.add('open');

  _pollTimer = setInterval(pollCloseLog, CLOSE_LOG_POLL_MS);
  pollCloseLog();
}

function finalizeCloseLogPanel(actionId, result) {
  if (actionId !== _actionId) return;
  stopPoll();
  _panelDone = true;
  const success = !!(result && result.ok !== false && !result.error);
  drainAndFinalize(actionId, success, result);
}

function dismissCloseLogPanel() {
  _dismissed = true;
  if (_panelDone || !_actionId) {
    stopPoll();
    _actionId = null;
  }
  const overlay = $id('close-log-overlay');
  const panel = $id('close-log-panel');
  if (overlay) overlay.classList.remove('open');
  if (panel) panel.classList.remove('open');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const panel = $id('close-log-panel');
    if (panel && panel.classList.contains('open')) {
      e.preventDefault();
      dismissCloseLogPanel();
    }
  }
}, true);

document.addEventListener('DOMContentLoaded', () => {
  const overlay = $id('close-log-overlay');
  if (overlay) overlay.addEventListener('click', () => dismissCloseLogPanel());
  const x = $id('close-log-x');
  if (x) x.addEventListener('click', () => dismissCloseLogPanel());
});

// ── ESM exports (F623) ──
export { dismissCloseLogPanel, finalizeCloseLogPanel, openCloseLogPanel };
Object.assign(globalThis, { dismissCloseLogPanel, finalizeCloseLogPanel, openCloseLogPanel });
