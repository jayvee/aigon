// ── State & constants ─────────────────────────────────────────────────────
// INITIAL_DATA and INSTANCE_NAME are defined in the inline <script> in index.html
    const POLL_MS = 10000;
    const TS_MS = 30000;
    function lsKey(k) { return 'aigon-' + INSTANCE_NAME + '-' + k; }
    // _rawState is the plain JS object; state becomes the Alpine proxy after init
    const _rawState = {
      data: INITIAL_DATA,
      failures: 0,
      lastStatuses: new Map(),
      collapsed: JSON.parse(localStorage.getItem(lsKey('collapsed')) || '{}'),
      filter: localStorage.getItem(lsKey('filter')) || 'all',
      view: localStorage.getItem(lsKey('view')) || 'monitor',
      selectedRepo: localStorage.getItem(lsKey('selectedRepo')) || 'all',
      pipelineType: localStorage.getItem(lsKey('pipelineType')) || 'features',
      monitorType: localStorage.getItem(lsKey('monitorType')) || 'all',
      pendingActions: new Set()
    };
    let state = _rawState;

    // ── Alpine store — initialised from state so mutations trigger re-renders ─
    document.addEventListener('alpine:init', () => {
      Alpine.store('dashboard', _rawState);
      state = Alpine.store('dashboard'); // all future writes go through the proxy
    });

