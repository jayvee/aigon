/* dashboard-esm-processed */
export function createInsightsView() {
  let mounted = false;

  async function renderInsightsBody(opts) {
    const embedded = opts && opts.embedded;
    const c = document.getElementById('insights-view');
    if (!c) return;

    if (!isProActive()) {
      c.innerHTML = '<div class="amp-empty" style="padding:28px 0;text-align:center"><div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Insights is a Pro feature — coming later</div><div style="font-size:11px;color:var(--text-tertiary);margin-bottom:12px">AI-powered observations, coaching, and quality analytics. Pro is in development and not yet available for purchase.</div><div style="font-size:11px;color:var(--text-tertiary)">Free alternative: <code>aigon board</code>, <code>aigon commits</code>, <code>aigon feature-status</code></div></div>';
      return;
    }

    if (!statsState.data) {
      c.innerHTML = '<div class="amp-empty" style="padding:20px"><span class="toast-spinner"></span>Loading insights…</div>';
      await loadAnalytics();
    }

    if (!statsState.insightsData && !statsState.insightsLoading) {
      await loadInsights(false);
    }

    const analytics = statsState.data;
    const filteredFeatures = analytics ? analytics.features || [] : [];

    let ampHtml = '';
    if (typeof buildInsightsMetricsSection === 'function') {
      ampHtml = buildInsightsMetricsSection(filteredFeatures);
    }

    let insightsHtml = '';
    const payload = statsState.insightsData;

    if (statsState.insightsLoading) {
      insightsHtml = '<div class="amp-empty"><span class="toast-spinner"></span>Loading insights…</div>';
    } else if (statsState.insightsError) {
      insightsHtml = '<div class="amp-empty">Failed to load insights: ' + escHtml(statsState.insightsError) + '</div>';
    } else if (!payload || !payload.report) {
      insightsHtml = '<div class="amp-empty">Run <code>aigon insights</code> or click Refresh to generate insights.</div>';
    } else if (payload.report.insufficientData) {
      insightsHtml = '<div class="amp-empty">' + escHtml(payload.report.summary || 'Not enough data for insights yet.') + '</div>';
    } else {
      insightsHtml = (payload.report.observations || []).map(function(obs) {
        const severity = escHtml(String(obs.severity || 'info').toLowerCase());
        const rawObs = obs.observation || '';
        let obsHtml;
        if (rawObs.indexOf(' | ') !== -1) {
          const items = rawObs.split(' | ');
          const rows = items.map(function(item) {
            const isCost = item.indexOf('(cost:') !== -1;
            const isTokens = item.indexOf('(tokens:') !== -1;
            let badgeHtml = '';
            if (isCost) badgeHtml = '<span class="amp-outlier-badge cost">$</span>';
            else if (isTokens) badgeHtml = '<span class="amp-outlier-badge tokens">T</span>';
            return '<div class="amp-outlier-row">' + badgeHtml + '<span class="amp-outlier-text">' + escHtml(item.trim()) + '</span></div>';
          }).join('');
          obsHtml = '<div class="amp-outlier-list">' + rows + '</div>';
        } else {
          obsHtml = '<div class="amp-insight-observation">' + escHtml(rawObs) + '</div>';
        }
        return '<article class="amp-insight-item">' +
          '<div class="amp-insight-title"><span class="amp-insight-sev ' + severity + '">' + severity.toUpperCase() + '</span> ' + escHtml(obs.title || 'Insight') + '</div>' +
          obsHtml +
          '<div class="amp-insight-action">Action: ' + escHtml(obs.action || '—') + '</div>' +
          '</article>';
      }).join('');

      let coachingHtml = '<div class="amp-insights-gated">AI coaching is available for Pro tier with <code>aigon insights --coach</code>.</div>';
      if (payload.coaching && payload.coaching.ok && Array.isArray(payload.coaching.recommendations) && payload.coaching.recommendations.length > 0) {
        coachingHtml = '<div class="amp-insights-coaching-title">AI Coaching (Pro)</div><ol class="amp-insights-coaching-list">' + payload.coaching.recommendations.slice(0, 5).map(function(rec) { return '<li>' + escHtml(rec) + '</li>'; }).join('') + '</ol>';
      } else if (payload.coaching && payload.coaching.error && !payload.coaching.gated) {
        coachingHtml = '<div class="amp-insights-gated">AI coaching unavailable: ' + escHtml(payload.coaching.error) + '</div>';
      }
      insightsHtml += coachingHtml;
    }

    const meta = payload && payload.generatedAt ? 'Updated ' + escHtml(relTime(payload.generatedAt)) : 'No cached insights yet';

    c.innerHTML = '<div style="padding:0 0 28px">' +
      ampHtml +
      '<div class="stats-section-title" style="margin-top:20px">Observations</div>' +
      '<div class="amp-insights-toolbar">' +
        '<span class="amp-insights-meta">' + meta + '</span>' +
        '<button class="btn" id="amp-insights-refresh-btn">Refresh</button>' +
      '</div>' +
      '<div class="amp-insights-body">' + insightsHtml + '</div>' +
      '</div>';

    if (typeof initAmpTokenCharts === 'function') initAmpTokenCharts();

    const refreshBtn = document.getElementById('amp-insights-refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = async function() {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<span class="run-next-spinner"></span>Refreshing…';
        const body = document.querySelector('.amp-insights-body');
        if (body) body.innerHTML = '<div class="amp-empty"><span class="toast-spinner"></span>Generating insights…</div>';
        await loadInsights(true);
        if (mounted) renderInsightsBody();
      };
    }
  }

  return {
    id: 'insights',
    elementId: 'insights-view',
    usesRepoSidebar: false,
    usesRepoHeader: false,
    alpineVisibility: false,
    async mount() {
      mounted = true;
      await renderInsightsBody();
    },
    update(_data, ctx) {
      if (!mounted) return;
      if (ctx && ctx.statusChanged) renderInsightsBody();
    },
    unmount() {
      mounted = false;
    },
  };
}
