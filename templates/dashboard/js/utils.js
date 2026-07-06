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
    /** Numeric feature id for UI; prefers server displayKey (F575/R43). */
    function formatFeatureIdForDisplay(id, displayKey) {
      if (displayKey) return String(displayKey);
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
          '<div class="spec-drift-title">State drift detected</div>' +
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

    /**
     * Replace whole-word agent IDs (cc, cu, gg, cx, etc.) in a string with
     * their display names ('Claude Code', 'Cursor', etc.). Card-headline.js
     * is pure server-side and has no access to AGENT_DISPLAY_NAMES, so the
     * banner detail comes back as e.g. 'recommended: cu' even though the
     * eval section right below uses 'Recommended: Cursor'. Resolve the
     * display name client-side at render time so both stay in sync.
     */
    function _resolveAgentIdsInHeadlineText(text) {
      const map = (typeof AGENT_DISPLAY_NAMES === 'object' && AGENT_DISPLAY_NAMES) || {};
      const ids = Object.keys(map).filter(id => id && id !== 'solo');
      if (ids.length === 0) return text;
      // Match each id as a whole word so 'cc' inside 'cuisine' isn't replaced.
      const pattern = new RegExp('\\b(' + ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'g');
      return text.replace(pattern, m => map[m] || m);
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
      const detailText = h.detail ? _resolveAgentIdsInHeadlineText(h.detail) : null;
      // For 'Needs you' state, the agent's awaitingInput.message is usually
      // a verbose multi-line prompt the user will read in the terminal anyway.
      // Suppress it on the card; show ONLY the action hint pointing them at
      // the terminal. Dashboard signals "agent needs you, go look there" —
      // the actual question lives where the answer goes.
      // For other states, render the detail in full (it's typically a short
      // descriptor like 'needs code review' or 'recommended: cc').
      let detailLine = '';
      const isAwaitingInput = h.verb === 'Needs you';
      if (isAwaitingInput) {
        detailLine = '<div class="kcard-headline-detail"><span class="kcard-headline-detail-action">→ Open eval terminal to respond</span></div>';
      } else if (detailText) {
        detailLine = '<div class="kcard-headline-detail">' + escHtml(detailText) + '</div>';
      }
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

    /** Server sets scheduledRunAt when a pending scheduled kickoff targets this entity. */
    function buildScheduledTitle(entity, label) {
      const runAt = entity && entity.scheduledRunAt;
      if (!runAt) return '';
      let title = String(runAt);
      const titlePrefix = label || 'Scheduled';
      try {
        const d = new Date(runAt);
        if (!Number.isNaN(d.getTime())) {
          title = titlePrefix + ': ' + d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) + ' (' + String(runAt) + ')';
        }
      } catch (_) {}
      return title;
    }

    function buildScheduledGlyphHtml(entity, label) {
      const title = buildScheduledTitle(entity, label);
      if (!title) return '';
      return '<span class="kcard-scheduled-glyph" role="img" aria-label="' + escHtml(title) + '" title="' + escHtml(title) + '">' +
        SCHEDULED_CLOCK_SVG + '</span>';
    }

    function formatLeaseHolderLabel(lease) {
      const user = lease.user ? String(lease.user) : null;
      const machine = lease.holderId || 'unknown';
      const agent = lease.agentId ? String(lease.agentId).toUpperCase() : null;
      if (user) {
        return agent ? (user + ' @ ' + machine + ' (' + agent + ')') : (user + ' @ ' + machine);
      }
      return agent ? (machine + ' · ' + agent) : machine;
    }

    function buildLeaseBadgeHtml(entity, repoStorage) {
      const leases = entity && Array.isArray(entity.activeLeases) ? entity.activeLeases : [];
      if (leases.length === 0) return '';
      const primary = leases[0];
      const label = formatLeaseHolderLabel(primary);
      const localHolderId = repoStorage && repoStorage.localHolderId ? String(repoStorage.localHolderId) : null;
      const heldByMe = localHolderId && primary.holderId === localHolderId;
      const stale = Boolean(entity.leaseDataStale || (repoStorage && repoStorage.leaseDataStale));
      const titleParts = leases.map((lease) => {
        const parts = [lease.role, formatLeaseHolderLabel(lease)];
        if (lease.expiresAt) parts.push('until ' + lease.expiresAt);
        return parts.join(' · ');
      });
      if (stale && repoStorage && repoStorage.lastLeaseRefreshAt) {
        titleParts.push('lease data stale since ' + repoStorage.lastLeaseRefreshAt);
      }
      const title = titleParts.join('\n');
      const extra = leases.length > 1 ? ' +' + (leases.length - 1) : '';
      const cssClass = 'kcard-lease-badge'
        + (stale ? ' kcard-lease-stale' : (heldByMe ? ' kcard-lease-held-by-me' : ' kcard-lease-held-by-other'));
      return '<span class="' + cssClass + '" title="' + escHtml(title) + '">🔒 ' + escHtml(label) + escHtml(extra) + '</span>';
    }

    function buildStorageStatusBadgeHtml(storage) {
      if (!storage || !storage.backend) return '';
      if (storage.backend === 'local') {
        return '<span class="repo-storage-badge repo-storage-local" title="Local spec storage">local</span>';
      }
      const health = storage.health || 'ok';
      const healthLabel = storage.leaseDataStale ? 'stale' : (health === 'ok' ? 'synced' : health);
      const backendLabel = storage.backend === 'git-branch' ? 'git-branch' : (storage.backend === 'git-ref-removed' ? 'git-ref (removed)' : storage.backend);
      const titleParts = [
        backendLabel + ' storage',
        storage.remote ? 'remote ' + storage.remote : null,
        storage.branch ? 'branch ' + storage.branch : null,
        storage.convertHint ? storage.convertHint : null,
        storage.offline ? 'offline' : null,
        storage.lastLeaseRefreshAt ? 'leases refreshed ' + storage.lastLeaseRefreshAt : null,
        storage.lastSyncAt ? 'last sync ' + storage.lastSyncAt : null,
        storage.ahead != null ? 'ahead ' + storage.ahead : null,
        storage.behind != null ? 'behind ' + storage.behind : null,
        storage.lastError ? storage.lastError : null,
      ].filter(Boolean);
      return '<span class="repo-storage-badge repo-storage-git repo-storage-' + escHtml(healthLabel === 'stale' ? 'behind' : health) + '" title="' + escHtml(titleParts.join(' · ')) + '">' + escHtml(backendLabel) + ' · ' + escHtml(healthLabel) + '</span>';
    }
