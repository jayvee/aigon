// ── State & constants ─────────────────────────────────────────────────────
// INITIAL_DATA and INSTANCE_NAME are defined in the inline <script> in index.html
    const POLL_MS = 10000;
    const TS_MS = 30000;
    function lsKey(k) { return 'aigon-' + INSTANCE_NAME + '-' + k; }
    // _rawState is the plain JS object; state becomes the Alpine proxy after init
    const storedView = localStorage.getItem(lsKey('view')) || 'monitor';
    const initialView = storedView === 'console'
      ? 'logs'
      : (storedView === 'logs' ? 'all-items' : storedView);

    const _rawState = {
      data: INITIAL_DATA,
      failures: 0,
      lastStatuses: new Map(),
      collapsed: JSON.parse(localStorage.getItem(lsKey('collapsed')) || '{}'),
      hiddenRepos: JSON.parse(localStorage.getItem(lsKey('hiddenRepos')) || '[]'),
      sidebarHidden: localStorage.getItem(lsKey('sidebarHidden')) === 'true',
      filter: localStorage.getItem(lsKey('filter')) || 'all',
      view: initialView,
      selectedRepo: localStorage.getItem(lsKey('selectedRepo')) || 'all',
      settingsRepo: localStorage.getItem(lsKey('settingsRepo')) || '',
      pipelineType: localStorage.getItem(lsKey('pipelineType')) || 'features',
      monitorType: localStorage.getItem(lsKey('monitorType')) || 'all',
      expandedPipelineColumns: JSON.parse(localStorage.getItem(lsKey('expandedPipelineColumns')) || '{}'),
      pendingActions: new Set(),
      pendingDevServerPokes: new Set(),
      // feature 234: true while the backend is restarting after a lib/*.js merge
      serverRestarting: false
    };

    function isRepoHidden(repoPath) {
      return (state.hiddenRepos || []).includes(repoPath);
    }

    function toggleRepoVisibility(repoPath) {
      const hidden = state.hiddenRepos || [];
      const idx = hidden.indexOf(repoPath);
      if (idx >= 0) {
        hidden.splice(idx, 1);
      } else {
        hidden.push(repoPath);
      }
      state.hiddenRepos = [...hidden];
      localStorage.setItem(lsKey('hiddenRepos'), JSON.stringify(state.hiddenRepos));
    }
    let state = _rawState;

    // ── Alpine store — initialised from state so mutations trigger re-renders ─
    document.addEventListener('alpine:init', () => {
      Alpine.store('dashboard', _rawState);
      state = Alpine.store('dashboard'); // all future writes go through the proxy
    });
