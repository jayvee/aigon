// ── Close-log panel (feature 428) ─────────────────────────────────────────
// Live-streaming log panel for feature-close actions. Opens immediately on
// click, polls /api/action-log/:actionId every 800ms, auto-dismisses on
// success after 3s, stays open on failure with "Close with agent" button.
(function () {
  'use strict';

  const POLL_MS = 800;
  let _pollTimer = null;
  let _actionId = null;
  let _seenLines = 0;
  let _panelDone = false;

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

  async function poll() {
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
          // No logs to show — empty panel obscures the card; toast + card handle failure UX
          window.dismissCloseLogPanel && window.dismissCloseLogPanel();
          return;
        }
        setState(success ? 'success' : 'failure');
        const t = $id('close-log-title');
        if (t) t.textContent = success ? 'Done' : 'Close failed';
        const f = $id('close-log-footer');
        if (f) {
          f.style.display = 'flex';
          if (success) {
            f.innerHTML = '<span class="close-log-done-label">Done ✓</span>';
            setTimeout(() => window.dismissCloseLogPanel && window.dismissCloseLogPanel(), 3000);
          } else {
            const featureId = result && result._featureId;
            const agentId   = result && result._agentId;
            const repoPath  = result && result._repoPath;
            let agentBtn = '';
            if (featureId && agentId) {
              agentBtn = '<button class="btn btn-warn" onclick="'
                + 'window.handleCloseWithAgent && window.handleCloseWithAgent('
                + JSON.stringify(featureId) + ','
                + JSON.stringify(agentId) + ','
                + JSON.stringify(repoPath || '') + ');'
                + 'window.dismissCloseLogPanel && window.dismissCloseLogPanel()'
                + '">Close with agent</button>';
            }
            f.innerHTML = '<span class="close-log-fail-label">See log above for details</span>' + agentBtn;
          }
          const x = $id('close-log-x');
          if (x) x.style.display = '';
        }
      });
  }

  window.openCloseLogPanel = function (actionId, label) {
    _actionId = actionId;
    _seenLines = 0;
    _panelDone = false;
    stopPoll();

    const pre = $id('close-log-output'); if (pre) pre.innerHTML = '';
    const f = $id('close-log-footer'); if (f) { f.style.display = 'none'; f.innerHTML = ''; }
    const x = $id('close-log-x'); if (x) x.style.display = 'none';
    const t = $id('close-log-title'); if (t) t.textContent = 'Closing ' + (label || '…');
    setState('running');

    const overlay = $id('close-log-overlay'), panel = $id('close-log-panel');
    if (overlay) overlay.classList.add('open');
    if (panel)   panel.classList.add('open');

    _pollTimer = setInterval(poll, POLL_MS);
    poll();
  };

  window.finalizeCloseLogPanel = function (actionId, result) {
    if (actionId !== _actionId) return;
    stopPoll();
    _panelDone = true;
    const success = !!(result && result.ok !== false && !result.error);
    drainAndFinalize(actionId, success, result);
  };

  window.dismissCloseLogPanel = function () {
    if (!_panelDone && _actionId) return;
    stopPoll();
    _actionId = null;
    const overlay = $id('close-log-overlay'), panel = $id('close-log-panel');
    if (overlay) overlay.classList.remove('open');
    if (panel)   panel.classList.remove('open');
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const panel = $id('close-log-panel');
      if (panel && panel.classList.contains('open') && _panelDone) {
        window.dismissCloseLogPanel();
      }
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    const overlay = $id('close-log-overlay');
    if (overlay) overlay.addEventListener('click', function () {
      if (_panelDone) window.dismissCloseLogPanel();
    });
    const x = $id('close-log-x');
    if (x) x.addEventListener('click', function () {
      window.dismissCloseLogPanel();
    });
  });
}());
