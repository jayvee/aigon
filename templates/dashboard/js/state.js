// ── State & constants ─────────────────────────────────────────────────────
// INITIAL_DATA and INSTANCE_NAME are defined in the inline <script> in index.html
    const POLL_MS = 10000;
    const TS_MS = 30000;
    function lsKey(k) { return 'aigon-' + INSTANCE_NAME + '-' + k; }
    // _rawState is the plain JS object; state becomes the Alpine proxy after init
    let storedView = localStorage.getItem(lsKey('view')) || 'monitor';
    /** Legacy top-level Pro tabs (feature 236) — remap to Settings subsection scroll */
    let settingsInitialSectionId = null;
    const LEGACY_PRO_TAB_TO_SETTINGS_SECTION = {
      'backup-sync': 'aigon-sync',
      'scheduled-features': 'schedule',
    };
    if (LEGACY_PRO_TAB_TO_SETTINGS_SECTION[storedView]) {
      settingsInitialSectionId = LEGACY_PRO_TAB_TO_SETTINGS_SECTION[storedView];
      storedView = 'settings';
      localStorage.setItem(lsKey('view'), 'settings');
    }
    const initialView = storedView === 'console'
      ? 'logs'
      : (storedView === 'logs' ? 'all-items' : (storedView === 'config' ? 'settings' : storedView));

    const storedSettingsRepo = localStorage.getItem(lsKey('settingsRepo')) || '';
    const _rawState = {
      data: INITIAL_DATA,
      failures: 0,
      lastStatuses: new Map(),
      collapsed: JSON.parse(localStorage.getItem(lsKey('collapsed')) || '{}'),
      hiddenRepos: JSON.parse(localStorage.getItem(lsKey('hiddenRepos')) || '[]'),
      sidebarHidden: localStorage.getItem(lsKey('sidebarHidden')) === 'true',
      filter: (() => { const stored = localStorage.getItem(lsKey('filter')) || 'all'; return stored === 'submitted' ? 'complete' : stored; })(),
      view: initialView,
      selectedRepo: localStorage.getItem(lsKey('selectedRepo')) || 'all',
      settingsRepo: storedSettingsRepo,
      settingsModelRepo: localStorage.getItem(lsKey('settingsModelRepo')) || (storedSettingsRepo !== 'all' ? storedSettingsRepo : ''),
      settingsDefaultsRepo: localStorage.getItem(lsKey('settingsDefaultsRepo')) || (storedSettingsRepo || ''),
      pipelineType: localStorage.getItem(lsKey('pipelineType')) || 'features',
      pipelineGroupBySet: localStorage.getItem(lsKey('pipelineGroupBySet')) === '1',
      monitorType: localStorage.getItem(lsKey('monitorType')) || 'all',
      expandedPipelineColumns: JSON.parse(localStorage.getItem(lsKey('expandedPipelineColumns')) || '{}'),
      pendingActions: new Set(),
      pendingDevServerPokes: new Set(),
      closeFailedFeatures: new Map(),
      // feature 234: true while the backend is restarting after a lib/*.js merge
      serverRestarting: false,
      settingsInitialSectionId: settingsInitialSectionId,
      // F454: structural fingerprint of the last-rendered status; poll() skips
      // render() when the fingerprint is unchanged so scroll position and
      // open menus are preserved between identical polls.
      lastFingerprint: '',
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
