/* dashboard-esm-processed */
// F519: agent matrix peek panel (extracted from actions.js)
// ── Matrix peek panel ──────────────────────────────────────────────────────────
(function () {
  const backdrop = document.getElementById('matrix-peek-backdrop');
  const panel    = document.getElementById('matrix-peek-panel');
  const content  = document.getElementById('matrix-peek-content');
  const btn      = document.getElementById('agent-picker-matrix-btn');
  if (!backdrop || !btn) return;

  let loaded = false;

  function closePeek() {
    backdrop.setAttribute('data-hidden', '');
  }

  async function openPeek() {
    backdrop.removeAttribute('data-hidden');
    if (loaded) return;
    content.textContent = 'Loading matrix…';
    try {
      const res = await fetch('/api/agent-matrix');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      renderMatrixPeek(data);
      loaded = true;
    } catch (e) {
      content.textContent = 'Failed to load: ' + e.message;
    }
  }

  function renderMatrixPeek(data) {
    const rows = data.rows || [];
    const ops  = data.operations || ['research', 'spec', 'spec_review', 'implement', 'review'];
    const opLabels = data.operationLabels || { research: 'Research', spec: 'Spec', spec_review: 'Spec Review', implement: 'Implement', review: 'Code Review' };

    const SCORE_COLORS = ['','#ef4444','#f97316','#eab308','#3b82f6','#22c55e'];

    function scoreCell(score) {
      const td = document.createElement('td');
      td.style.cssText = 'text-align:center;padding:5px 8px;font-size:12px';
      if (score == null) { td.style.color = 'var(--text-tertiary)'; td.textContent = '—'; return td; }
      const s = Math.max(1, Math.min(5, Math.round(score)));
      const span = document.createElement('span');
      const hasDecimal = !Number.isInteger(score);
      span.style.cssText = 'display:inline-block;min-width:20px;height:20px;line-height:20px;padding:0 3px;border-radius:4px;font-weight:700;font-size:11px;background:' + SCORE_COLORS[s] + '22;color:' + SCORE_COLORS[s] + ';border:1px solid ' + SCORE_COLORS[s] + '55';
      span.textContent = hasDecimal ? score.toFixed(1) : String(score);
      td.appendChild(span);
      return td;
    }

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';

    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    hrow.style.cssText = 'border-bottom:1px solid var(--border-subtle)';
    ['Agent','Model'].concat(ops.map(op => opLabels[op] || op), ['Pricing']).forEach((h, i) => {
      const th = document.createElement('th');
      th.textContent = h;
      th.style.cssText = 'padding:6px 8px;text-align:' + (i < 2 ? 'left' : 'center') + ';color:var(--text-secondary);font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap';
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    let lastAgent = null;
    rows.forEach(row => {
      if (row.agentId !== lastAgent) {
        const gr = document.createElement('tr');
        gr.style.cssText = 'background:var(--bg-subtle,#111)';
        const gtd = document.createElement('td');
        gtd.colSpan = 2 + ops.length + 1;
        gtd.style.cssText = 'padding:6px 8px;font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-secondary)';
        gtd.textContent = (row.agentDisplayName || row.agentId).toUpperCase();
        gr.appendChild(gtd);
        tbody.appendChild(gr);
        lastAgent = row.agentId;
      }
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.06))' + (row.quarantined ? ';opacity:.4' : '');

      const agentTd = document.createElement('td');
      agentTd.style.cssText = 'padding:5px 8px;width:24px';
      tr.appendChild(agentTd);

      const modelTd = document.createElement('td');
      modelTd.style.cssText = 'padding:5px 8px;color:' + (row.modelValue === null ? 'var(--text-tertiary)' : 'var(--text-primary)') + ';white-space:nowrap';
      modelTd.textContent = row.modelLabel || (row.modelValue === null ? 'Default' : row.modelValue);
      tr.appendChild(modelTd);

      ops.forEach(op => tr.appendChild(scoreCell(row.score && row.score[op] != null ? row.score[op] : null)));

      const priceTd = document.createElement('td');
      priceTd.style.cssText = 'padding:5px 8px;text-align:center;color:var(--text-secondary);font-size:11px;white-space:nowrap';
      if (row.pricing && row.pricing.inputPerM != null && row.pricing.outputPerM != null) {
        priceTd.textContent = row.pricing.inputPerM === 0 && row.pricing.outputPerM === 0 ? 'free' : '$' + row.pricing.inputPerM.toFixed(2) + ' / $' + row.pricing.outputPerM.toFixed(2);
        if (priceTd.textContent === 'free') priceTd.style.color = '#22c55e';
      } else {
        priceTd.textContent = '—';
      }
      tr.appendChild(priceTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    content.innerHTML = '';

    const legendWrap = document.createElement('div');
    legendWrap.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.08))';

    const legendTitle = document.createElement('span');
    legendTitle.style.cssText = 'font-size:11px;color:var(--text-tertiary,#666);font-weight:600;letter-spacing:.06em;text-transform:uppercase;flex-shrink:0';
    legendTitle.textContent = 'Score scale';
    legendWrap.appendChild(legendTitle);

    const SCORE_META = [
      { s: 1, color: '#ef4444', label: 'Poor' },
      { s: 2, color: '#f97316', label: 'Below avg' },
      { s: 3, color: '#eab308', label: 'Average' },
      { s: 4, color: '#3b82f6', label: 'Strong' },
      { s: 5, color: '#22c55e', label: 'Best' },
    ];
    SCORE_META.forEach(m => {
      const item = document.createElement('span');
      item.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary)';
      const badge = document.createElement('span');
      badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;font-weight:700;font-size:11px;background:' + m.color + '22;color:' + m.color + ';border:1px solid ' + m.color + '55';
      badge.textContent = String(m.s);
      const desc = document.createElement('span');
      desc.textContent = m.label;
      item.appendChild(badge);
      item.appendChild(desc);
      legendWrap.appendChild(item);
    });

    const dashItem = document.createElement('span');
    dashItem.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary)';
    dashItem.innerHTML = '<span class="matrix-no-data">—</span><span>No data</span>';
    legendWrap.appendChild(dashItem);

    const pricingNote = document.createElement('span');
    pricingNote.style.cssText = 'font-size:11px;color:var(--text-tertiary,#555);margin-left:auto;flex-shrink:0';
    pricingNote.textContent = 'Pricing: API list price ($/M tokens)';
    legendWrap.appendChild(pricingNote);

    content.appendChild(legendWrap);
    content.appendChild(table);
  }

  btn.addEventListener('click', openPeek);

  const closeBtn = document.getElementById('matrix-peek-close');
  if (closeBtn) closeBtn.addEventListener('click', closePeek);

  backdrop.addEventListener('click', e => { if (e.target === backdrop) closePeek(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !backdrop.hasAttribute('data-hidden')) {
      e.stopPropagation();
      closePeek();
    }
  }, true);

  if (panel) panel.addEventListener('click', e => e.stopPropagation());
}());


