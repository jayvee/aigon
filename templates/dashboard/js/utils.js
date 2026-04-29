    // ── Utilities ─────────────────────────────────────────────────────────────

    function relTime(iso) {
      const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
      if (diff < 10) return 'just now';
      if (diff < 60) return diff + 's ago';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      return Math.floor(diff / 3600) + 'h ago';
    }

    function logsDateFmt(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      const diff = Math.max(0, Date.now() - d.getTime());
      if (diff < 86400000) return relTime(iso); // < 1 day → "2h ago"
      if (diff < 604800000) { // < 7 days → "Mon 14, 2:30pm"
        const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return day + ', ' + time;
      }
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); // "Mar 8, 2025"
    }

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    /** Numeric feature id for UI (matches kcard-id: #02 not #2). */
    function formatFeatureIdForDisplay(id) {
      const raw = String(id == null ? '' : id).trim();
      if (!/^\d+$/.test(raw)) return raw;
      return raw.padStart(2, '0');
    }
    function statusRank(s){ return s === 'waiting' ? 0 : s === 'implementing' ? 1 : s === 'error' ? 2 : 3; }
    function featureRank(feature){ return feature.agents && feature.agents.length > 0 ? Math.min(...feature.agents.map(a => statusRank(a.status))) : 99; }

    function showToast(text, actionLabel, actionFn, opts){
      const wrap = document.getElementById('toasts');
      const n = document.createElement('div');
      const isError = opts && opts.error;
      const isProcessing = opts && opts.processing;
      n.className = 'toast' + (isError ? ' toast-error' : '') + (isProcessing ? ' toast-processing' : '');
      if (isProcessing) {
        const spinner = document.createElement('span');
        spinner.className = 'toast-spinner';
        n.appendChild(spinner);
      }
      const span = document.createElement('span');
      span.textContent = text;
      n.appendChild(span);
      if (actionLabel && actionFn) {
        const b = document.createElement('button');
        b.textContent = actionLabel;
        b.onclick = actionFn;
        n.appendChild(b);
      }
      const dismiss = document.createElement('button');
      dismiss.className = 'toast-dismiss';
      dismiss.innerHTML = '&times;';
      dismiss.onclick = () => n.remove();
      n.appendChild(dismiss);
      wrap.prepend(n);
      while (wrap.children.length > 5) wrap.removeChild(wrap.lastChild);
      const isPersistent = opts && opts.persistent;
      if (!isProcessing && !isPersistent) {
        const timeout = isError ? 20000 : 10000;
        setTimeout(() => n.remove(), timeout);
      }
      return n;
    }

    async function copyText(text){
      try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }

    function buildSpecDriftBadgeHtml(item) {
      const drift = item && item.specDrift;
      if (!drift) return '';
      return '<span class="spec-drift-wrap">' +
        '<button class="spec-drift-badge spec-drift-toggle" type="button" title="Spec folder drift detected">⚠ drift</button>' +
        '<div class="spec-drift-popover">' +
          '<div class="spec-drift-title">Spec drift detected</div>' +
          '<div class="spec-drift-meta">Lifecycle: <strong>' + escHtml(drift.lifecycle || 'unknown') + '</strong></div>' +
          '<div class="spec-drift-label">Current</div>' +
          '<code class="spec-drift-path">' + escHtml(drift.currentPath || 'unknown') + '</code>' +
          '<div class="spec-drift-label">Expected</div>' +
          '<code class="spec-drift-path">' + escHtml(drift.expectedPath || 'unknown') + '</code>' +
          '<div class="spec-drift-actions"><button class="btn btn-secondary btn-xs spec-drift-reconcile-btn" type="button">Reconcile</button></div>' +
        '</div>' +
      '</span>';
    }

    function buildStateRenderBadgeHtml(item) {
      const meta = item && item.stateRenderMeta;
      if (!meta || !meta.badge) return '';
      return '<span class="kcard-spec-status kcard-state-badge ' + escHtml(meta.cls) + '" title="' + escHtml(meta.label) + '">' + escHtml(meta.badge) + '</span>';
    }

    function _formatHeadlineAge(sec) {
      if (sec == null || !Number.isFinite(sec)) return '';
      if (sec < 60) return sec + 's';
      if (sec < 3600) return Math.floor(sec / 60) + 'm';
      if (sec < 86400) return Math.floor(sec / 3600) + 'h';
      return Math.floor(sec / 86400) + 'd';
    }

    function buildCardHeadlineHtml(item) {
      const h = item && item.cardHeadline;
      if (!h || !h.verb) return '';
      const tone = escHtml(h.tone || 'idle');
      const glyph = escHtml(h.glyph || '');
      const verb = escHtml(h.verb);
      const meta = [];
      if (h.subject) meta.push(escHtml(h.subject));
      if (h.owner) meta.push(escHtml(String(h.owner).toUpperCase()));
      const ageStr = _formatHeadlineAge(h.age);
      if (ageStr) meta.push(escHtml(ageStr));
      const metaLine = meta.length ? '<div class="kcard-headline-meta">' + meta.join(' · ') + '</div>' : '';
      const detailLine = h.detail ? '<div class="kcard-headline-detail">' + escHtml(h.detail) + '</div>' : '';
      return '<div class="kcard-headline tone-' + tone + '" data-headline-tone="' + tone + '">' +
        '<div class="kcard-headline-top">' +
          '<span class="kcard-headline-glyph" aria-hidden="true">' + glyph + '</span>' +
          '<span class="kcard-headline-verb">' + verb + '</span>' +
        '</div>' +
        metaLine +
        detailLine +
      '</div>';
    }

    const SCHEDULED_CLOCK_SVG = '<svg class="kcard-scheduled-glyph-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5"/></svg>';

    /** Server sets scheduledRunAt on features/research when a pending scheduled kickoff targets that id. */
    function buildScheduledGlyphHtml(entity) {
      const runAt = entity && entity.scheduledRunAt;
      if (!runAt) return '';
      let title = String(runAt);
      try {
        const d = new Date(runAt);
        if (!Number.isNaN(d.getTime())) {
          title = 'Scheduled: ' + d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) + ' (' + String(runAt) + ')';
        }
      } catch (_) {}
      return '<span class="kcard-scheduled-glyph" role="img" aria-label="' + escHtml(title) + '" title="' + escHtml(title) + '">' +
        SCHEDULED_CLOCK_SVG + '</span>';
    }
