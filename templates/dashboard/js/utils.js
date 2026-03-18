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
    function statusRank(s){ return s === 'waiting' ? 0 : s === 'implementing' ? 1 : s === 'error' ? 2 : 3; }
    function featureRank(feature){ return feature.agents && feature.agents.length > 0 ? Math.min(...feature.agents.map(a => statusRank(a.status))) : 99; }

    function showToast(text, actionLabel, actionFn, opts){
      const wrap = document.getElementById('toasts');
      const n = document.createElement('div');
      const isError = opts && opts.error;
      n.className = 'toast' + (isError ? ' toast-error' : '');
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
      const timeout = isError ? 20000 : 10000;
      setTimeout(() => n.remove(), timeout);
    }

    async function copyText(text){
      try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }

