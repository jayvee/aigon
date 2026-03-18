    // ── Statistics view ────────────────────────────────────────────────────────

    const VOLUME_WINDOW = { daily: 30, weekly: 12, monthly: 6 };
    const LS_KEYS = { period: 'aigon.stats.period', repo: 'aigon.stats.repo', gran: 'aigon.stats.gran' };

    function saveStatsPrefs() {
      try {
        localStorage.setItem(LS_KEYS.period, statsState.period);
        localStorage.setItem(LS_KEYS.repo, statsState.repoFilter);
        localStorage.setItem(LS_KEYS.gran, statsState.volumeGranularity);
      } catch (_) {}
    }

    function loadStatsPrefs() {
      try {
        return {
          period: localStorage.getItem(LS_KEYS.period) || '30d',
          repoFilter: localStorage.getItem(LS_KEYS.repo) || 'all',
          volumeGranularity: localStorage.getItem(LS_KEYS.gran) || 'weekly'
        };
      } catch (_) {
        return { period: '30d', repoFilter: 'all', volumeGranularity: 'weekly' };
      }
    }

    const _savedPrefs = loadStatsPrefs();
    const statsState = {
      period: _savedPrefs.period,
      repoFilter: _savedPrefs.repoFilter,
      volumeGranularity: _savedPrefs.volumeGranularity,
      volumeWindowEnd: null,
      cycleTimeWindowEnd: null,
      data: null,
      loading: false,
      error: null,
      volumeChart: null,
      volumeSeries: [],
      cycleTimeChart: null,
      cycleTimeSeries: [],
      filteredFeatures: [],
      featureListPage: 0
    };

    async function loadAnalytics() {
      if (statsState.loading) return;
      statsState.loading = true;
      try {
        const res = await fetch('/api/analytics', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        statsState.data = await res.json();
        statsState.error = null;
      } catch (e) {
        statsState.error = e.message;
      } finally {
        statsState.loading = false;
      }
    }

    function fmtNum(v, decimals) {
      if (v === null || v === undefined) return '—';
      return decimals !== undefined ? v.toFixed(decimals) : String(v);
    }
    function fmtPct(v) {
      if (v === null || v === undefined) return '—';
      return Math.round(v * 100) + '%';
    }
    function fmtHours(v) {
      if (v === null || v === undefined) return '—';
      if (v < 1) return Math.round(v * 60) + 'm';
      return v.toFixed(1) + 'h';
    }

    function trendIcon(pct, lowerIsBetter) {
      if (pct === null || pct === undefined) return '';
      const positive = lowerIsBetter ? pct < 0 : pct > 0;
      const arrow = pct > 0 ? '↑' : '↓';
      const cls = positive ? 'trend-up' : 'trend-down';
      return `<span class="${cls}">${arrow} ${Math.abs(pct)}%</span>`;
    }

    function buildSparklineSvg(points, color) {
      if (!points || points.length < 2) return '';
      const vals = points.map(p => (p.count !== undefined ? p.count : p.score) || 0);
      const maxVal = Math.max(...vals, 1);
      const w = 400, h = 40, pad = 2;
      const xs = vals.map((_, i) => pad + (i / (vals.length - 1)) * (w - pad * 2));
      const ys = vals.map(v => h - pad - ((v / maxVal) * (h - pad * 2)));
      const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
      const fillPts = `${xs[0]},${h} ${pts} ${xs[xs.length - 1]},${h}`;
      return `<svg class="sparkline-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polygon points="${fillPts}" fill="${color}" opacity="0.15"/>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>
      </svg>`;
    }

    function buildStatCard(label, value, trendHtml, extra) {
      return `<div class="stat-card">
        <div class="stat-card-label">${escHtml(label)}</div>
        <div class="stat-card-value">${value}</div>
        ${trendHtml ? `<div class="stat-card-trend">${trendHtml}</div>` : ''}
        ${extra ? `<div class="stat-card-trend" style="color:var(--text-tertiary)">${extra}</div>` : ''}
      </div>`;
    }

    function buildVolumeSeries(features, granularity) {
      const buckets = {};
      let minTs = Infinity, maxTs = -Infinity;

      features.forEach(f => {
        const ts = f.completedAt ? new Date(f.completedAt) : null;
        if (!ts || isNaN(ts)) return;
        const t = ts.getTime();
        if (t < minTs) minTs = t;
        if (t > maxTs) maxTs = t;
        let key;
        if (granularity === 'daily') {
          key = ts.toISOString().slice(0, 10);
        } else if (granularity === 'weekly') {
          const d = new Date(ts);
          const dow = d.getUTCDay() || 7;
          d.setUTCDate(d.getUTCDate() - dow + 1);
          key = d.toISOString().slice(0, 10);
        } else {
          key = ts.toISOString().slice(0, 7) + '-01';
        }
        buckets[key] = (buckets[key] || 0) + 1;
      });

      if (minTs === Infinity) return [];

      // Fill in zero-count buckets for a continuous timeline
      const filled = [];
      const cur = new Date(minTs);
      const end = new Date(maxTs);

      if (granularity === 'daily') {
        cur.setUTCHours(0, 0, 0, 0);
        end.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          filled.push({ date: key, count: buckets[key] || 0 });
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      } else if (granularity === 'weekly') {
        // Align to Monday
        const dow = cur.getUTCDay() || 7;
        cur.setUTCDate(cur.getUTCDate() - dow + 1);
        cur.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          filled.push({ date: key, count: buckets[key] || 0 });
          cur.setUTCDate(cur.getUTCDate() + 7);
        }
      } else {
        cur.setUTCDate(1); cur.setUTCHours(0, 0, 0, 0);
        end.setUTCDate(1); end.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          filled.push({ date: key, count: buckets[key] || 0 });
          cur.setUTCMonth(cur.getUTCMonth() + 1);
        }
      }
      return filled;
    }

    function renderVolumeChart(fullSeries, granularity) {
      statsState.volumeSeries = fullSeries || [];
      statsState.volumeWindowEnd = null; // reset to latest on full re-render

      if (statsState.volumeChart) {
        statsState.volumeChart.destroy();
        statsState.volumeChart = null;
      }

      const canvas = document.getElementById('volume-chart-canvas');
      if (!canvas || !fullSeries || fullSeries.length === 0) return;

      // Build full-series chart first (window applied after)
      statsState.volumeChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: 'rgba(59,130,246,0.7)',
            hoverBackgroundColor: 'rgba(59,130,246,1)',
            borderRadius: 3,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => {
                  const label = ctx[0].label;
                  if (granularity === 'weekly') return 'Week of ' + label;
                  return label;
                },
                label: ctx => ` ${ctx.parsed.y} feature${ctx.parsed.y !== 1 ? 's' : ''} completed`
              },
              backgroundColor: '#1a1a1f',
              titleColor: '#ededef',
              bodyColor: '#a0a0a8',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              padding: 10
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#6b6b76', font: { size: 11 } },
              border: { color: 'rgba(255,255,255,0.06)' }
            },
            y: {
              beginAtZero: true,
              ticks: { color: '#6b6b76', font: { size: 11 }, precision: 0 },
              grid: { color: 'rgba(255,255,255,0.04)' },
              border: { display: false }
            }
          }
        }
      });
      applyVolumeWindow();
    }

    function buildCycleTimeSeries(features, granularity) {
      const MIN_DURATION_MS = 5 * 60 * 1000; // ignore < 5 min (likely backfill artifacts)

      // Compute outlier cap: P95 or 48h, whichever is larger
      const allHours = features
        .filter(f => f.durationMs && f.durationMs >= MIN_DURATION_MS && !f.cycleTimeExclude)
        .map(f => f.durationMs / 3600000)
        .sort((a, b) => a - b);
      const p95 = allHours.length > 0 ? allHours[Math.floor(allHours.length * 0.95)] : 48;
      const outlierCap = Math.max(p95, 48);

      const buckets = {};
      features.forEach(f => {
        if (!f.durationMs || f.durationMs < MIN_DURATION_MS) return;
        if (f.cycleTimeExclude) return;
        const ts = f.completedAt ? new Date(f.completedAt) : null;
        if (!ts || isNaN(ts)) return;
        let key;
        if (granularity === 'daily') {
          key = ts.toISOString().slice(0, 10);
        } else if (granularity === 'weekly') {
          const d = new Date(ts);
          const dow = d.getUTCDay() || 7;
          d.setUTCDate(d.getUTCDate() - dow + 1);
          key = d.toISOString().slice(0, 10);
        } else {
          key = ts.toISOString().slice(0, 7) + '-01';
        }
        const hours = f.durationMs / 3600000;
        if (!buckets[key]) buckets[key] = { included: [], outliers: 0 };
        if (hours > outlierCap) {
          buckets[key].outliers++;
        } else {
          buckets[key].included.push(hours);
        }
      });
      return Object.keys(buckets).sort().map(k => {
        const { included, outliers } = buckets[k];
        let medianHours = null;
        if (included.length > 0) {
          const sorted = included.slice().sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          medianHours = Math.round((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
        }
        return { date: k, medianHours, count: included.length, outliersExcluded: outliers };
      });
    }

    function renderCycleTimeChart(fullSeries, granularity) {
      statsState.cycleTimeSeries = fullSeries || [];
      statsState.cycleTimeWindowEnd = null;

      if (statsState.cycleTimeChart) {
        statsState.cycleTimeChart.destroy();
        statsState.cycleTimeChart = null;
      }
      const canvas = document.getElementById('cycle-time-chart-canvas');
      if (!canvas || !fullSeries || fullSeries.length === 0) return;

      statsState.cycleTimeChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: 'rgba(34,197,94,0.7)',
            hoverBackgroundColor: 'rgba(34,197,94,1)',
            borderRadius: 3,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => {
                  const label = ctx[0].label;
                  if (granularity === 'weekly') return 'Week of ' + label;
                  return label;
                },
                label: ctx => ` Median cycle time: ${ctx.parsed.y}h`
              },
              backgroundColor: '#1a1a1f',
              titleColor: '#ededef',
              bodyColor: '#a0a0a8',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              padding: 10
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#6b6b76', font: { size: 11 } },
              border: { color: 'rgba(255,255,255,0.06)' }
            },
            y: {
              beginAtZero: true,
              ticks: { color: '#6b6b76', font: { size: 11 },
                callback: v => v + 'h'
              },
              grid: { color: 'rgba(255,255,255,0.04)' },
              border: { display: false }
            }
          }
        }
      });
      applyCycleTimeWindow();
    }

    function applyCycleTimeWindow() {
      const series = statsState.cycleTimeSeries;
      const gran = statsState.volumeGranularity;
      const windowSize = VOLUME_WINDOW[gran] || 8;
      if (!series || !series.length) return;

      const needsNav = series.length > windowSize;

      const navEl = document.getElementById('ct-nav-controls');
      if (navEl) navEl.style.visibility = needsNav ? 'visible' : 'hidden';

      let startIdx, endIdx, slice;
      if (!needsNav) {
        startIdx = 0;
        endIdx = series.length - 1;
        slice = series.slice();
        statsState.cycleTimeWindowEnd = endIdx;
      } else {
        if (statsState.cycleTimeWindowEnd === null) statsState.cycleTimeWindowEnd = series.length - 1;
        statsState.cycleTimeWindowEnd = Math.min(statsState.cycleTimeWindowEnd, series.length - 1);
        endIdx = statsState.cycleTimeWindowEnd;
        startIdx = Math.max(0, endIdx - windowSize + 1);
        slice = series.slice(startIdx, endIdx + 1);
      }

      const chart = statsState.cycleTimeChart;
      if (chart) {
        chart.data.labels = slice.map(d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(5, 10));
        chart.data.datasets[0].data = slice.map(d => d.medianHours);
        chart.options.plugins.tooltip.callbacks.label = ctx => {
          const d = slice[ctx.dataIndex];
          const line = ` Median cycle time: ${ctx.parsed.y}h`;
          return d && d.outliersExcluded > 0 ? [line, ` (${d.outliersExcluded} outlier${d.outliersExcluded > 1 ? 's' : ''} excluded)`] : line;
        };
        chart.update('none');
      }

      if (needsNav) {
        const fmt = d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(0, 10);
        const rangeEl = document.getElementById('ct-nav-range');
        if (rangeEl && slice.length) rangeEl.textContent = `${fmt(slice[0])} – ${fmt(slice[slice.length - 1])}`;
        const btnPrev = document.getElementById('ct-nav-prev');
        const btnNext = document.getElementById('ct-nav-next');
        if (btnPrev) btnPrev.disabled = startIdx === 0;
        if (btnNext) btnNext.disabled = endIdx >= series.length - 1;
      }
    }

    function panCycleTimeChart(direction) {
      const series = statsState.cycleTimeSeries || [];
      const windowSize = VOLUME_WINDOW[statsState.volumeGranularity] || 8;
      if (!series.length) return;
      const step = Math.max(1, Math.floor(windowSize / 2));
      const current = statsState.cycleTimeWindowEnd !== null ? statsState.cycleTimeWindowEnd : series.length - 1;
      if (direction === 'prev') {
        statsState.cycleTimeWindowEnd = Math.max(windowSize - 1, current - step);
      } else {
        statsState.cycleTimeWindowEnd = Math.min(series.length - 1, current + step);
      }
      applyCycleTimeWindow();
    }

    function applyVolumeWindow() {
      const series = statsState.volumeSeries;
      const gran = statsState.volumeGranularity;
      const windowSize = VOLUME_WINDOW[gran] || 8;
      if (!series.length) return;

      const needsNav = series.length > windowSize;

      // Show nav controls only when data exceeds window
      const navEl = document.getElementById('vol-nav-controls');
      if (navEl) navEl.style.visibility = needsNav ? 'visible' : 'hidden';

      let startIdx, endIdx, slice;
      if (!needsNav) {
        // All data fits — show everything
        startIdx = 0;
        endIdx = series.length - 1;
        slice = series.slice();
        statsState.volumeWindowEnd = endIdx;
      } else {
        if (statsState.volumeWindowEnd === null) statsState.volumeWindowEnd = series.length - 1;
        statsState.volumeWindowEnd = Math.min(statsState.volumeWindowEnd, series.length - 1);
        endIdx = statsState.volumeWindowEnd;
        startIdx = Math.max(0, endIdx - windowSize + 1);
        slice = series.slice(startIdx, endIdx + 1);
      }

      const chart = statsState.volumeChart;
      if (chart) {
        chart.data.labels = slice.map(d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(5, 10));
        chart.data.datasets[0].data = slice.map(d => d.count);
        chart.update('none');
      }

      if (needsNav) {
        const fmt = d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(0, 10);
        const rangeEl = document.getElementById('vol-nav-range');
        if (rangeEl && slice.length) rangeEl.textContent = `${fmt(slice[0])} – ${fmt(slice[slice.length - 1])}`;
        const btnPrev = document.getElementById('vol-nav-prev');
        const btnNext = document.getElementById('vol-nav-next');
        if (btnPrev) btnPrev.disabled = startIdx === 0;
        if (btnNext) btnNext.disabled = endIdx >= series.length - 1;
      }
    }

    function panVolumeChart(direction) {
      const series = statsState.volumeSeries;
      const windowSize = VOLUME_WINDOW[statsState.volumeGranularity] || 8;
      if (!series.length) return;
      const step = Math.max(1, Math.floor(windowSize / 2));
      const current = statsState.volumeWindowEnd !== null ? statsState.volumeWindowEnd : series.length - 1;
      if (direction === 'prev') {
        statsState.volumeWindowEnd = Math.max(windowSize - 1, current - step);
      } else {
        statsState.volumeWindowEnd = Math.min(series.length - 1, current + step);
      }
      applyVolumeWindow();
    }

    function filterFeaturesByPeriodAndRepo(features, period, repoFilter) {
      const now = Date.now();
      const ms = { '7d': 7, '30d': 30, '90d': 90, 'all': null };
      const days = ms[period];
      const since = days ? now - days * 86400000 : 0;
      return features.filter(f => {
        if (f.completedAt && new Date(f.completedAt).getTime() < since) return false;
        if (repoFilter !== 'all' && f.repoPath !== repoFilter) return false;
        return true;
      });
    }

