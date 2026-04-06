    // ── Statistics view ────────────────────────────────────────────────────────

    const VOLUME_WINDOW = { daily: 30, weekly: 12, monthly: 6 };
    const LS_KEYS = {
      period: 'aigon.stats.period',
      gran: 'aigon.stats.gran'
    };

    function saveStatsPrefs() {
      try {
        localStorage.setItem(LS_KEYS.period, statsState.period);
        localStorage.setItem(LS_KEYS.gran, statsState.volumeGranularity);
      } catch (_) {}
    }

    function loadStatsPrefs() {
      try {
        return {
          period: localStorage.getItem(LS_KEYS.period) || '30d',
          volumeGranularity: localStorage.getItem(LS_KEYS.gran) || 'weekly'
        };
      } catch (_) {
        return { period: '30d', volumeGranularity: 'weekly' };
      }
    }

    const _savedPrefs = loadStatsPrefs();
    const statsState = {
      period: _savedPrefs.period,
      volumeGranularity: _savedPrefs.volumeGranularity,
      volumeWindowEnd: null,
      cycleTimeWindowEnd: null,
      commitWindowEnd: null,
      data: null,
      commitsData: null,
      loading: false,
      commitsLoading: false,
      error: null,
      commitsError: null,
      volumeChart: null,
      volumeSeries: [],
      cycleTimeChart: null,
      cycleTimeSeries: [],
      commitChart: null,
      commitSeries: [],
      commitFeatureFilter: 'all',
      commitAgentFilter: 'all',
      commitTypeFilter: 'all',
      commitSort: { col: 'date', dir: 'desc' },
      featureCommitMap: {},
      filteredFeatures: [],
      featureListPage: 0,
      insightsData: null,
      insightsLoading: false,
      insightsError: null,
      subTab: localStorage.getItem('aigon.stats.subtab') || 'summary'
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

    async function loadCommits(force) {
      if (statsState.commitsLoading) return;
      statsState.commitsLoading = true;
      try {
        const endpoint = force ? '/api/commits?force=1&limit=0' : '/api/commits?limit=0';
        const res = await fetch(endpoint, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        statsState.commitsData = await res.json();
        statsState.commitsError = null;
      } catch (e) {
        statsState.commitsError = e.message;
      } finally {
        statsState.commitsLoading = false;
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

    function fmtTickVal(v) {
      if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
      if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K';
      if (v >= 1) return v % 1 === 0 ? String(v) : v.toFixed(2);
      if (v > 0) return v.toFixed(2);
      return '0';
    }

    function buildSparklineSvg(points, color) {
      if (!points || points.length < 2) return '';
      const vals = points.map(p => (p.count !== undefined ? p.count : p.score) || 0);
      const maxVal = Math.max(...vals, 1);
      const minVal = Math.min(...vals);
      const labelLeft = 45, labelBottom = 16, pad = 4;
      const w = 400, h = 80;
      const plotLeft = labelLeft, plotRight = w - pad;
      const plotTop = pad, plotBottom = h - labelBottom;
      const xs = vals.map((_, i) => plotLeft + (i / (vals.length - 1)) * (plotRight - plotLeft));
      const ys = vals.map(v => plotBottom - ((v - 0) / (maxVal || 1)) * (plotBottom - plotTop));
      const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
      const fillPts = `${xs[0]},${plotBottom} ${pts} ${xs[xs.length - 1]},${plotBottom}`;
      const firstDay = points[0].day ? points[0].day.slice(5) : '';
      const lastDay = points[points.length - 1].day ? points[points.length - 1].day.slice(5) : '';
      return `<svg class="sparkline-svg" viewBox="0 0 ${w} ${h}">
        <line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <text x="${plotLeft - 4}" y="${plotTop + 4}" text-anchor="end" fill="#999" font-size="9">${fmtTickVal(maxVal)}</text>
        <text x="${plotLeft - 4}" y="${plotBottom}" text-anchor="end" fill="#999" font-size="9">${fmtTickVal(minVal)}</text>
        <text x="${plotLeft}" y="${h - 2}" text-anchor="start" fill="#999" font-size="9">${firstDay}</text>
        <text x="${plotRight}" y="${h - 2}" text-anchor="end" fill="#999" font-size="9">${lastDay}</text>
        <polygon points="${fillPts}" fill="${color}" opacity="0.15"/>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>
      </svg>`;
    }

    function buildStatCard(label, value, trendHtml, extra, tooltip, options) {
      const opts = options || {};
      const infoHtml = tooltip ? ` <span class="stat-info" data-stat-tooltip="${escHtml(tooltip)}">?</span>` : '';
      const proBadge = opts.pro ? '<span class="pro-badge-inline">PRO</span>' : '';
      return `<div class="stat-card">
        ${proBadge}
        <div class="stat-card-label">${escHtml(label)}${infoHtml}</div>
        <div class="stat-card-value">${value}</div>
        ${trendHtml ? `<div class="stat-card-trend">${trendHtml}</div>` : ''}
        ${extra ? `<div class="stat-card-trend" style="color:var(--text-tertiary)">${extra}</div>` : ''}
      </div>`;
    }

    function buildKvLabel(label, tooltip) {
      if (!tooltip) return escHtml(label);
      return `${escHtml(label)} <span class="stat-info" data-stat-tooltip="${escHtml(tooltip)}">?</span>`;
    }

    /**
     * Build a Pro-gated stat card: blurred fake content with a PRO badge.
     * The data-pro-slot attribute lets pro-reports.js replace it when Pro activates.
     */
    function buildProGatedStatCard(label, slotId, tooltip) {
      const infoHtml = tooltip ? ` <span class="stat-info" data-stat-tooltip="${escHtml(tooltip)}">?</span>` : '';
      return `<div class="stat-card pro-gated" data-pro-slot="${escHtml(slotId)}">
        <span class="pro-badge">PRO</span>
        <div class="stat-card-label">${escHtml(label)}${infoHtml}</div>
        <div class="pro-gated-content">
          <div class="stat-card-value">42%</div>
        </div>
        <div style="font-size:10px;color:var(--text-tertiary);opacity:.7;margin-top:auto">Pro — coming later</div>
      </div>`;
    }

    /**
     * Build a Pro-gated chart placeholder: blurred static SVG with overlay.
     * Title is outside the blur so users know what they're missing.
     */
    function buildProGatedChart(title, slotId, tooltipText) {
      const tooltip = tooltipText ? ` <span class="stat-info" data-stat-tooltip="${escHtml(tooltipText)}">?</span>` : '';
      const fakeSvg = `<svg viewBox="0 0 400 120" preserveAspectRatio="none" style="width:100%;height:120px">
        <polyline points="10,100 60,80 120,90 180,50 240,60 300,30 360,45 390,20" fill="none" stroke="var(--text-tertiary)" stroke-width="2" opacity="0.5"/>
        <polygon points="10,120 10,100 60,80 120,90 180,50 240,60 300,30 360,45 390,20 390,120" fill="var(--text-tertiary)" opacity="0.08"/>
      </svg>`;
      return `<div class="volume-chart-wrap pro-gated-chart" data-pro-slot="${escHtml(slotId)}">
        <div class="volume-chart-header">
          <div class="volume-chart-title">${escHtml(title)}${tooltip}</div>
        </div>
        <div class="pro-gated-content" style="position:relative">
          <div style="height:160px;position:relative;display:flex;align-items:center;justify-content:center">${fakeSvg}</div>
        </div>
        <div class="pro-chart-overlay">
          <span class="pro-badge">PRO</span>
          <span style="color:var(--text-tertiary);font-size:12px">Coming later</span>
        </div>
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

    function buildCommitSeries(commits, granularity) {
      const buckets = {};
      let minTs = Infinity, maxTs = -Infinity;

      commits.forEach(c => {
        const ts = c.date ? new Date(c.date) : null;
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
        if (!buckets[key]) buckets[key] = { count: 0, feature: 0, nonFeature: 0 };
        buckets[key].count++;
        buckets[key][c.featureId ? 'feature' : 'nonFeature']++;
      });

      if (minTs === Infinity) return [];
      const filled = [];
      const cur = new Date(minTs);
      const end = new Date(maxTs);
      const zero = { count: 0, feature: 0, nonFeature: 0 };

      if (granularity === 'daily') {
        cur.setUTCHours(0, 0, 0, 0);
        end.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          const b = buckets[key] || zero;
          filled.push({ date: key, count: b.count, feature: b.feature, nonFeature: b.nonFeature });
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      } else if (granularity === 'weekly') {
        const dow = cur.getUTCDay() || 7;
        cur.setUTCDate(cur.getUTCDate() - dow + 1);
        cur.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          const b = buckets[key] || zero;
          filled.push({ date: key, count: b.count, feature: b.feature, nonFeature: b.nonFeature });
          cur.setUTCDate(cur.getUTCDate() + 7);
        }
      } else {
        cur.setUTCDate(1); cur.setUTCHours(0, 0, 0, 0);
        end.setUTCDate(1); end.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          const b = buckets[key] || zero;
          filled.push({ date: key, count: b.count, feature: b.feature, nonFeature: b.nonFeature });
          cur.setUTCMonth(cur.getUTCMonth() + 1);
        }
      }
      return filled;
    }

    // Align multiple series to the same date axis — union of all dates, zero-filled
    function alignAllSeries(...seriesArr) {
      const dateSet = new Set();
      seriesArr.forEach(s => (s || []).forEach(d => dateSet.add(d.date)));
      const allDates = [...dateSet].sort();
      return seriesArr.map(s => {
        const map = {};
        (s || []).forEach(d => { map[d.date] = d; });
        // Build a zero-entry template from the first item's keys
        const sample = (s || [])[0] || {};
        const zeroEntry = { date: '' };
        Object.keys(sample).forEach(k => { if (k !== 'date') zeroEntry[k] = 0; });
        return allDates.map(date => map[date] ? { ...map[date] } : { ...zeroEntry, date });
      });
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

    function renderCommitChart(fullSeries, granularity) {
      statsState.commitSeries = fullSeries || [];
      statsState.commitWindowEnd = null;

      if (statsState.commitChart) {
        statsState.commitChart.destroy();
        statsState.commitChart = null;
      }
      const canvas = document.getElementById('commits-chart-canvas');
      if (!canvas || !fullSeries || fullSeries.length === 0) return;

      statsState.commitChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Feature',
              data: [],
              backgroundColor: 'rgba(59,130,246,0.7)',
              hoverBackgroundColor: 'rgba(59,130,246,1)',
              borderRadius: 3,
              borderSkipped: false
            },
            {
              label: 'Non-feature',
              data: [],
              backgroundColor: 'rgba(148,163,184,0.45)',
              hoverBackgroundColor: 'rgba(148,163,184,0.7)',
              borderRadius: 3,
              borderSkipped: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: true, position: 'top', align: 'end',
              labels: { boxWidth: 10, boxHeight: 10, padding: 12, color: '#a0a0a8', font: { size: 11 } }
            },
            tooltip: {
              callbacks: {
                title: ctx => granularity === 'weekly' ? ('Week of ' + ctx[0].label) : ctx[0].label,
                label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} commit${ctx.parsed.y !== 1 ? 's' : ''}`
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
              stacked: true,
              grid: { display: false },
              ticks: { color: '#6b6b76', font: { size: 11 } },
              border: { color: 'rgba(255,255,255,0.06)' }
            },
            y: {
              stacked: true,
              beginAtZero: true,
              ticks: { color: '#6b6b76', font: { size: 11 }, precision: 0 },
              grid: { color: 'rgba(255,255,255,0.04)' },
              border: { display: false }
            }
          }
        }
      });
      applyCommitWindow();
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

    function buildCommitsPerFeatureSeries(features, featureCommitMap, granularity) {
      // For each time bucket, collect commits-per-feature for features completed in that period
      const buckets = {};
      features.forEach(f => {
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
        const featureKey = `${f.repoPath || ''}:${String(f.featureNum || '').padStart(2, '0')}`;
        const cpf = (featureCommitMap[featureKey] || { count: 0 }).count;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(cpf);
      });
      return Object.keys(buckets).sort().map(k => {
        const arr = buckets[k].sort((a, b) => a - b);
        const mid = Math.floor(arr.length / 2);
        const median = arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2 * 10) / 10;
        return { date: k, medianCpf: median, count: arr.length };
      });
    }

    function renderCpfChart(fullSeries, granularity) {
      statsState.cpfSeries = fullSeries || [];
      statsState.cpfWindowEnd = null;

      if (statsState.cpfChart) {
        statsState.cpfChart.destroy();
        statsState.cpfChart = null;
      }
      const canvas = document.getElementById('cpf-chart-canvas');
      if (!canvas || !fullSeries || fullSeries.length === 0) return;

      statsState.cpfChart = new Chart(canvas, {
        type: 'bar',
        data: { labels: [], datasets: [{
          data: [],
          backgroundColor: 'rgba(251,191,36,0.7)',
          hoverBackgroundColor: 'rgba(251,191,36,1)',
          borderRadius: 3,
          borderSkipped: false
        }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => granularity === 'weekly' ? ('Week of ' + ctx[0].label) : ctx[0].label,
                label: ctx => ` Median: ${ctx.parsed.y} commits/feature`
              },
              backgroundColor: '#1a1a1f', titleColor: '#ededef', bodyColor: '#a0a0a8',
              borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 10
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#6b6b76', font: { size: 11 } }, border: { color: 'rgba(255,255,255,0.06)' } },
            y: { beginAtZero: true, ticks: { color: '#6b6b76', font: { size: 11 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } }
          }
        }
      });
      applyCpfWindow();
    }

    function applyCpfWindow() {
      const series = statsState.cpfSeries;
      const gran = statsState.volumeGranularity;
      const windowSize = VOLUME_WINDOW[gran] || 8;
      if (!series || !series.length) return;

      if (statsState.cpfWindowEnd === null) statsState.cpfWindowEnd = statsState.volumeWindowEnd;
      const endIdx = statsState.cpfWindowEnd !== null
        ? Math.min(statsState.cpfWindowEnd, series.length - 1)
        : series.length - 1;
      const startIdx = Math.max(0, endIdx - windowSize + 1);
      const slice = series.slice(startIdx, endIdx + 1);

      const chart = statsState.cpfChart;
      if (chart) {
        chart.data.labels = slice.map(d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(5, 10));
        chart.data.datasets[0].data = slice.map(d => d.medianCpf || 0);
        chart.update('none');
      }
    }

    function buildReworkRatioSeries(commits, granularity) {
      const fixRegex = /^(fix|fixup|bugfix)\b|fix:/i;
      const buckets = {};
      let minTs = Infinity, maxTs = -Infinity;
      commits.forEach(c => {
        const ts = c.date ? new Date(c.date) : null;
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
        if (!buckets[key]) buckets[key] = { total: 0, fix: 0 };
        buckets[key].total++;
        if (fixRegex.test(c.message || '')) buckets[key].fix++;
      });
      if (minTs === Infinity) return [];
      return Object.keys(buckets).sort().map(k => {
        const b = buckets[k];
        const ratio = b.total > 0 ? Math.round(b.fix / b.total * 1000) / 10 : 0;
        return { date: k, reworkPct: ratio, count: b.total };
      });
    }

    function renderReworkChart(fullSeries, granularity) {
      statsState.reworkSeries = fullSeries || [];
      statsState.reworkWindowEnd = null;
      if (statsState.reworkChart) { statsState.reworkChart.destroy(); statsState.reworkChart = null; }
      const canvas = document.getElementById('rework-chart-canvas');
      if (!canvas || !fullSeries || fullSeries.length === 0) return;
      statsState.reworkChart = new Chart(canvas, {
        type: 'bar',
        data: { labels: [], datasets: [{
          data: [],
          backgroundColor: 'rgba(239,68,68,0.6)',
          hoverBackgroundColor: 'rgba(239,68,68,0.9)',
          borderRadius: 3,
          borderSkipped: false
        }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: ctx => granularity === 'weekly' ? ('Week of ' + ctx[0].label) : ctx[0].label,
                label: ctx => ` Rework: ${ctx.parsed.y}%`
              },
              backgroundColor: '#1a1a1f', titleColor: '#ededef', bodyColor: '#a0a0a8',
              borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 10
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#6b6b76', font: { size: 11 } }, border: { color: 'rgba(255,255,255,0.06)' } },
            y: { beginAtZero: true, ticks: { color: '#6b6b76', font: { size: 11 }, callback: v => v + '%' },
              grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } }
          }
        }
      });
      applyReworkWindow();
    }

    function applyReworkWindow() {
      const series = statsState.reworkSeries;
      const gran = statsState.volumeGranularity;
      const windowSize = VOLUME_WINDOW[gran] || 8;
      if (!series || !series.length) return;
      if (statsState.reworkWindowEnd === null) statsState.reworkWindowEnd = statsState.volumeWindowEnd;
      const endIdx = statsState.reworkWindowEnd !== null
        ? Math.min(statsState.reworkWindowEnd, series.length - 1) : series.length - 1;
      const startIdx = Math.max(0, endIdx - windowSize + 1);
      const slice = series.slice(startIdx, endIdx + 1);
      const chart = statsState.reworkChart;
      if (chart) {
        chart.data.labels = slice.map(d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(5, 10));
        chart.data.datasets[0].data = slice.map(d => d.reworkPct || 0);
        chart.update('none');
      }
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
                callback: function(v) {
                  // Dynamic: use minutes when all values < 2h, otherwise hours
                  const useMin = this.chart && this.chart._aigonUseMinutes;
                  return useMin ? Math.round(v) + 'm' : v + 'h';
                }
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
        const hours = slice.map(d => d.medianHours || 0);
        const maxHours = Math.max(...hours, 0);
        const useMinutes = maxHours < 2;
        chart._aigonUseMinutes = useMinutes;
        chart.data.labels = slice.map(d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(5, 10));
        chart.data.datasets[0].data = useMinutes ? hours.map(h => Math.round(h * 60)) : hours;
        chart.options.plugins.tooltip.callbacks.label = ctx => {
          const d = slice[ctx.dataIndex];
          const val = useMinutes ? `${ctx.parsed.y}m` : `${ctx.parsed.y}h`;
          const line = ` Median cycle time: ${val}`;
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

    function buildTokenSeries(features, granularity) {
      const buckets = {};
      let minTs = Infinity, maxTs = -Infinity;

      features.forEach(f => {
        if (!f.billableTokens || f.billableTokens <= 0) return;
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
        buckets[key] = (buckets[key] || 0) + f.billableTokens;
      });

      if (minTs === Infinity) return [];

      const filled = [];
      const cur = new Date(minTs);
      const end = new Date(maxTs);

      if (granularity === 'daily') {
        cur.setUTCHours(0, 0, 0, 0); end.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          filled.push({ date: key, tokens: buckets[key] || 0 });
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      } else if (granularity === 'weekly') {
        const dow = cur.getUTCDay() || 7;
        cur.setUTCDate(cur.getUTCDate() - dow + 1); cur.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          filled.push({ date: key, tokens: buckets[key] || 0 });
          cur.setUTCDate(cur.getUTCDate() + 7);
        }
      } else {
        cur.setUTCDate(1); cur.setUTCHours(0, 0, 0, 0);
        end.setUTCDate(1); end.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
          const key = cur.toISOString().slice(0, 10);
          filled.push({ date: key, tokens: buckets[key] || 0 });
          cur.setUTCMonth(cur.getUTCMonth() + 1);
        }
      }
      return filled;
    }

    function renderTokenChart(fullSeries, granularity) {
      statsState.tokenSeries = fullSeries || [];
      statsState.tokenWindowEnd = null;

      if (statsState.tokenChart) { statsState.tokenChart.destroy(); statsState.tokenChart = null; }
      const canvas = document.getElementById('token-chart-canvas');
      if (!canvas || !fullSeries || fullSeries.length === 0) return;

      statsState.tokenChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: 'rgba(139,92,246,0.7)',
            hoverBackgroundColor: 'rgba(139,92,246,1)',
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
                title: ctx => granularity === 'weekly' ? ('Week of ' + ctx[0].label) : ctx[0].label,
                label: ctx => ` ${fmtTickVal(ctx.parsed.y)} tokens`
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
              ticks: { color: '#6b6b76', font: { size: 11 }, callback: v => fmtTickVal(v) },
              grid: { color: 'rgba(255,255,255,0.04)' },
              border: { display: false }
            }
          }
        }
      });
      applyTokenWindow();
    }

    function applyTokenWindow() {
      const series = statsState.tokenSeries;
      const gran = statsState.volumeGranularity;
      const windowSize = VOLUME_WINDOW[gran] || 8;
      if (!series || !series.length) return;

      if (statsState.tokenWindowEnd === null) statsState.tokenWindowEnd = statsState.volumeWindowEnd;
      const endIdx = statsState.tokenWindowEnd !== null
        ? Math.min(statsState.tokenWindowEnd, series.length - 1)
        : series.length - 1;
      const startIdx = Math.max(0, endIdx - windowSize + 1);
      const slice = series.slice(startIdx, endIdx + 1);

      const chart = statsState.tokenChart;
      if (chart) {
        chart.data.labels = slice.map(d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(5, 10));
        chart.data.datasets[0].data = slice.map(d => d.tokens || 0);
        chart.update('none');
      }
    }

    // panCycleTimeChart is now handled by panAllCharts below

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

    function applyCommitWindow() {
      const series = statsState.commitSeries;
      const gran = statsState.volumeGranularity;
      const windowSize = VOLUME_WINDOW[gran] || 8;
      if (!series || !series.length) return;

      // Use same window position as volume chart (aligned series)
      if (statsState.commitWindowEnd === null) statsState.commitWindowEnd = statsState.volumeWindowEnd;
      const endIdx = statsState.commitWindowEnd !== null
        ? Math.min(statsState.commitWindowEnd, series.length - 1)
        : series.length - 1;
      const startIdx = Math.max(0, endIdx - windowSize + 1);
      const slice = series.slice(startIdx, endIdx + 1);

      const chart = statsState.commitChart;
      if (chart) {
        chart.data.labels = slice.map(d => gran === 'monthly' ? d.date.slice(0, 7) : d.date.slice(5, 10));
        chart.data.datasets[0].data = slice.map(d => d.feature || 0);
        chart.data.datasets[1].data = slice.map(d => d.nonFeature || 0);
        chart.update('none');
      }
    }

    // Sync pan across all aligned charts (all three share same date axis)
    function panAllCharts(direction) {
      const series = statsState.volumeSeries;
      if (!series || !series.length) return;
      const windowSize = VOLUME_WINDOW[statsState.volumeGranularity] || 8;
      const step = Math.max(1, Math.floor(windowSize / 2));
      const current = statsState.volumeWindowEnd !== null ? statsState.volumeWindowEnd : series.length - 1;
      let newEnd;
      if (direction === 'prev') {
        newEnd = Math.max(windowSize - 1, current - step);
      } else {
        newEnd = Math.min(series.length - 1, current + step);
      }
      statsState.volumeWindowEnd = newEnd;
      statsState.commitWindowEnd = newEnd;
      statsState.cycleTimeWindowEnd = newEnd;
      statsState.cpfWindowEnd = newEnd;
      statsState.reworkWindowEnd = newEnd;
      statsState.tokenWindowEnd = newEnd;
      applyVolumeWindow();
      applyCommitWindow();
      applyCycleTimeWindow();
      applyCpfWindow();
      applyReworkWindow();
      applyTokenWindow();
    }

    function panVolumeChart(direction) { panAllCharts(direction); }
    function panCommitChart(direction) { panAllCharts(direction); }
    function panCycleTimeChart(direction) { panAllCharts(direction); }

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

    function filterCommitsByPeriodAndRepo(commits, period, repoFilter) {
      const now = Date.now();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, 'all': null };
      const days = daysMap[period];
      const since = days ? now - days * 86400000 : 0;
      return (commits || []).filter(c => {
        const ts = c.date ? new Date(c.date).getTime() : null;
        if (!ts || ts < since) return false;
        if (repoFilter !== 'all' && c.repoPath !== repoFilter) return false;
        return true;
      });
    }
