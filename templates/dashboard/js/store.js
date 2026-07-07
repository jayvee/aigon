/* dashboard-esm-processed */
import { INITIAL_DATA, INSTANCE_NAME } from './injected.js';

// ── Constants ───────────────────────────────────────────────────────────────
export const POLL_MS = 10000;
export const TS_MS = 30000;
export function lsKey(k) { return 'aigon-' + INSTANCE_NAME + '-' + k; }

const LEGACY_PRO_TAB_TO_SETTINGS_SECTION = {
  'backup-sync': 'aigon-sync',
  'scheduled-features': 'schedule',
};

const DEFAULT_OPTIMISTIC_TTL_MS = 60000;
const STARTUP_PHASE_LABELS = ['Setting up', 'Preparing worktrees', 'Launching agents'];
const STARTUP_PHASE_SEGMENT_MS = 5500;
let _hydratedSettingsInitialSectionId = null;

// ── Persistence map ─────────────────────────────────────────────────────────
const PERSISTENCE = {
  view: {
    lsKey: 'view',
    default: 'monitor',
    serialize: (v) => String(v),
    deserialize(raw) {
      let stored = raw || 'monitor';
      if (LEGACY_PRO_TAB_TO_SETTINGS_SECTION[stored]) {
        _hydratedSettingsInitialSectionId = LEGACY_PRO_TAB_TO_SETTINGS_SECTION[stored];
        stored = 'settings';
        localStorage.setItem(lsKey('view'), 'settings');
      }
      if (stored === 'console') return 'logs';
      if (stored === 'logs') return 'all-items';
      if (stored === 'config') return 'settings';
      return stored;
    },
  },
  filter: {
    lsKey: 'filter',
    default: 'all',
    serialize: (v) => String(v),
    deserialize(raw) {
      const stored = raw || 'all';
      return stored === 'submitted' ? 'complete' : stored;
    },
  },
  collapsed: {
    lsKey: 'collapsed',
    default: {},
    serialize: (v) => JSON.stringify(v || {}),
    deserialize: (raw) => JSON.parse(raw || '{}'),
  },
  hiddenRepos: {
    lsKey: 'hiddenRepos',
    default: [],
    serialize: (v) => JSON.stringify(v || []),
    deserialize: (raw) => JSON.parse(raw || '[]'),
  },
  sidebarHidden: {
    lsKey: 'sidebarHidden',
    default: false,
    serialize: (v) => String(!!v),
    deserialize: (raw) => raw === 'true',
  },
  selectedRepo: {
    lsKey: 'selectedRepo',
    default: 'all',
    serialize: (v) => String(v),
    deserialize: (raw) => raw || 'all',
  },
  settingsRepo: {
    lsKey: 'settingsRepo',
    default: '',
    serialize: (v) => String(v || ''),
    deserialize: (raw) => raw || '',
  },
  settingsModelRepo: {
    lsKey: 'settingsModelRepo',
    default: null,
    serialize: (v) => String(v || ''),
    deserialize(raw, hydrated) {
      if (raw) return raw;
      const settingsRepo = hydrated.settingsRepo;
      return settingsRepo && settingsRepo !== 'all' ? settingsRepo : '';
    },
  },
  settingsDefaultsRepo: {
    lsKey: 'settingsDefaultsRepo',
    default: null,
    serialize: (v) => String(v || ''),
    deserialize(raw, hydrated) {
      if (raw) return raw;
      return hydrated.settingsRepo || '';
    },
  },
  pipelineType: {
    lsKey: 'pipelineType',
    default: 'features',
    serialize: (v) => String(v),
    deserialize: (raw) => raw || 'features',
  },
  pipelineGroupBySet: {
    lsKey: 'pipelineGroupBySet',
    default: false,
    serialize: (v) => (v ? '1' : '0'),
    deserialize: (raw) => raw === '1',
  },
  monitorType: {
    lsKey: 'monitorType',
    default: 'all',
    serialize: (v) => String(v),
    deserialize: (raw) => raw || 'all',
  },
  expandedPipelineColumns: {
    lsKey: 'expandedPipelineColumns',
    default: {},
    serialize: (v) => JSON.stringify(v || {}),
    deserialize: (raw) => JSON.parse(raw || '{}'),
  },
};

function hydratePersisted(key) {
  const cfg = PERSISTENCE[key];
  const hydrated = {};
  for (const k of ['settingsRepo']) {
    if (PERSISTENCE[k]) {
      hydrated[k] = PERSISTENCE[k].deserialize(localStorage.getItem(lsKey(PERSISTENCE[k].lsKey)));
    }
  }
  const raw = localStorage.getItem(lsKey(cfg.lsKey));
  return cfg.deserialize(raw != null ? raw : null, hydrated);
}

function storeTarget() {
  if (typeof Alpine !== 'undefined' && typeof Alpine.store === 'function') {
    const registered = Alpine.store('dashboard');
    if (registered) return registered;
  }
  return _rawState;
}

function persistWrite(key, value) {
  const cfg = PERSISTENCE[key];
  localStorage.setItem(lsKey(cfg.lsKey), cfg.serialize(value));
}

// ── Raw state ───────────────────────────────────────────────────────────────
const _rawState = {
  data: INITIAL_DATA,
  failures: 0,
  lastStatuses: new Map(),
  collapsed: hydratePersisted('collapsed'),
  hiddenRepos: hydratePersisted('hiddenRepos'),
  sidebarHidden: hydratePersisted('sidebarHidden'),
  filter: hydratePersisted('filter'),
  view: hydratePersisted('view'),
  selectedRepo: hydratePersisted('selectedRepo'),
  settingsRepo: hydratePersisted('settingsRepo'),
  settingsModelRepo: hydratePersisted('settingsModelRepo'),
  settingsDefaultsRepo: hydratePersisted('settingsDefaultsRepo'),
  pipelineType: hydratePersisted('pipelineType'),
  pipelineGroupBySet: hydratePersisted('pipelineGroupBySet'),
  monitorType: hydratePersisted('monitorType'),
  expandedPipelineColumns: hydratePersisted('expandedPipelineColumns'),
  pendingActions: new Set(),
  pendingDevServerPokes: new Set(),
  closeFailedFeatures: new Map(),
  serverRestarting: false,
  sseConnected: false,
  settingsInitialSectionId: _hydratedSettingsInitialSectionId,
  lastStatusVersion: null,
  _lastRenderedStatusVersion: null,
};

// ── Optimistic overlay engine ───────────────────────────────────────────────
let _lastRawData = null;
/** @type {Map<string, { patch: Function, settled: Function, ttlMs: number, addedAt: number }>} */
const _optimisticOverlays = new Map();

function deepCloneData(data) {
  return data == null ? data : JSON.parse(JSON.stringify(data));
}

function getForceProOverride() {
  const params = new URLSearchParams(location.search);
  if (!params.has('forcePro')) return null;
  const val = params.get('forcePro');
  if (val === '0' || val === 'false') return false;
  if (val === '1' || val === 'true') return true;
  return null;
}

export function applyForceProOverride(data) {
  if (!data) return data;
  const override = getForceProOverride();
  if (override === false) data.proAvailable = false;
  return data;
}

export function isProActive() {
  const override = getForceProOverride();
  if (override === false) return false;
  return !!(_rawState.data && _rawState.data.proAvailable);
}

function normalizeRepoPath(repoPath) {
  if (!repoPath) return '';
  return String(repoPath).replace(/^\/private\/var\//, '/var/');
}

function findRepoInDraft(draft, repoPath, entityKey, entityId) {
  const repos = (draft && draft.repos) || [];
  const needle = normalizeRepoPath(repoPath);
  if (needle) {
    const match = repos.find(r => r && normalizeRepoPath(r.path) === needle);
    if (match) return match;
  }
  return repos.find(r => r && (r[entityKey] || []).some(e => String(e.id) === String(entityId))) || null;
}

export function bumpEntityListIdentity(draft, repo, entityKey) {
  repo[entityKey] = (repo[entityKey] || []).slice();
}

function serverStartupPhaseLabel(entity) {
  const readiness = entity && entity.startupReadiness;
  const phase = readiness && readiness.phase ? String(readiness.phase) : '';
  if (phase === 'agents_booting' || phase === 'agents_partially_booted' || phase === 'agents_active') {
    return readiness.phaseLabel || null;
  }
  return null;
}

function hasCompletedStartup(entity) {
  const readiness = entity && entity.startupReadiness;
  if (readiness && readiness.phase === 'all_ready') return true;
  return Array.isArray(entity && entity.agents)
    && entity.agents.length > 0
    && entity.agents.every(agent => {
      const status = String(agent && agent.status || '').toLowerCase();
      return status === 'ready'
        || status === 'implementation-complete'
        || status === 'research-complete'
        || status === 'review-complete'
        || status === 'spec-review-complete';
    });
}

function markEntityStartupPhase(entity, opts) {
  const resetClock = opts && opts.resetClock;
  if (!entity) return;
  const serverPhase = serverStartupPhaseLabel(entity);
  if (serverPhase) {
    entity.startupPhase = serverPhase;
    return;
  }
  if (hasCompletedStartup(entity)) {
    delete entity.startupPhase;
    delete entity.startupPhaseStartedAt;
    return;
  }
  if (resetClock || entity.startupPhaseStartedAt == null) {
    entity.startupPhaseStartedAt = Date.now();
  }
  const elapsed = Date.now() - entity.startupPhaseStartedAt;
  const idx = Math.min(
    STARTUP_PHASE_LABELS.length - 1,
    Math.floor(elapsed / STARTUP_PHASE_SEGMENT_MS)
  );
  entity.startupPhase = STARTUP_PHASE_LABELS[idx];
}

function pruneOptimisticOverlays(raw) {
  const now = Date.now();
  for (const [key, overlay] of [..._optimisticOverlays.entries()]) {
    if (overlay.settled(raw)) _optimisticOverlays.delete(key);
  }
  for (const [key, overlay] of [..._optimisticOverlays.entries()]) {
    if (now - overlay.addedAt > overlay.ttlMs) _optimisticOverlays.delete(key);
  }
}

function assignDataFromRaw(rawNext, { evaluateSettled = true } = {}) {
  const raw = applyForceProOverride(rawNext);
  if (evaluateSettled) pruneOptimisticOverlays(raw);
  _lastRawData = raw;
  const draft = deepCloneData(raw);
  for (const overlay of _optimisticOverlays.values()) {
    overlay.patch(draft);
  }
  storeTarget().data = draft;
}

export function replaceData(rawNext, options) {
  assignDataFromRaw(rawNext, options);
}

export function addOptimistic({ key, patch, settled, ttlMs = DEFAULT_OPTIMISTIC_TTL_MS }) {
  _optimisticOverlays.set(key, { patch, settled, ttlMs, addedAt: Date.now() });
  assignDataFromRaw(_lastRawData ?? _rawState.data, { evaluateSettled: false });
}

export function dropOptimistic(key) {
  _optimisticOverlays.delete(key);
  assignDataFromRaw(_lastRawData ?? _rawState.data, { evaluateSettled: false });
}

export function optimisticKey(action, repoPath, entityType, entityId) {
  return `${action}:${repoPath || ''}:${entityType}:${entityId}`;
}

export function createEntityStartOverlay(action, args, repoPath) {
  const entityKey = action === 'research-start' ? 'research' : 'features';
  const entityId = String(((args || [])[0]) || '');
  if (!entityId) return null;
  const key = optimisticKey(action, repoPath, entityKey, entityId);
  const captured = { previousStage: null, previousStartupPhase: undefined, previousStartupPhaseStartedAt: undefined };

  return {
    key,
    ttlMs: 120000,
    patch(draft) {
      const repo = findRepoInDraft(draft, repoPath, entityKey, entityId);
      if (!repo) return;
      const entity = (repo[entityKey] || []).find(e => String(e.id) === entityId);
      if (!entity) return;
      if (captured.previousStage == null) {
        captured.previousStage = entity.stage;
        captured.previousStartupPhase = entity.startupPhase;
        captured.previousStartupPhaseStartedAt = entity.startupPhaseStartedAt;
      }
      if (captured.previousStage === 'in-progress') {
        markEntityStartupPhase(entity, { resetClock: true });
      } else if (entity.stage === 'backlog' || entity.stage === 'inbox' || entity.stage === 'in-progress') {
        entity.stage = 'in-progress';
        markEntityStartupPhase(entity, { resetClock: true });
      }
      bumpEntityListIdentity(draft, repo, entityKey);
    },
    settled(raw) {
      const repo = findRepoInDraft(raw, repoPath, entityKey, entityId);
      if (!repo) return true;
      const entity = (repo[entityKey] || []).find(e => String(e.id) === entityId);
      if (!entity) return true;
      if (entity.stage !== 'in-progress') return false;
      if (captured.previousStage === 'in-progress') {
        return hasCompletedStartup(entity) || !!serverStartupPhaseLabel(entity);
      }
      return true;
    },
  };
}

export function createEntityDeleteOverlay(action, args, repoPath) {
  const entityKey = action === 'research-delete' ? 'research' : 'features';
  const entityId = String((args || [])[0] || '');
  if (!entityId || !repoPath) return null;
  const key = optimisticKey(action, repoPath, entityKey, entityId);
  return {
    key,
    patch(draft) {
      const repo = findRepoInDraft(draft, repoPath, entityKey, entityId);
      if (!repo) return;
      const before = (repo[entityKey] || []).length;
      repo[entityKey] = (repo[entityKey] || []).filter(item => String(item.id) !== entityId);
      if ((repo[entityKey] || []).length !== before) bumpEntityListIdentity(draft, repo, entityKey);
    },
    settled(raw) {
      const repo = findRepoInDraft(raw, repoPath, entityKey, entityId);
      if (!repo) return true;
      return !(repo[entityKey] || []).some(e => String(e.id) === entityId);
    },
  };
}

export function clearStartupPhaseForEntity(action, args, repoPath) {
  if (action !== 'feature-start' && action !== 'research-start') return;
  const entityKey = action === 'research-start' ? 'research' : 'features';
  const entityId = String(((args || [])[0]) || '');
  if (!entityId) return;
  const draft = deepCloneData(_rawState.data);
  const repo = findRepoInDraft(draft, repoPath, entityKey, entityId);
  if (!repo) return;
  const entity = (repo[entityKey] || []).find(e => String(e.id) === entityId);
  if (!entity) return;
  if (entity.startupPhase === undefined && entity.startupPhaseStartedAt == null) return;
  delete entity.startupPhase;
  delete entity.startupPhaseStartedAt;
  bumpEntityListIdentity(draft, repo, entityKey);
  storeTarget().data = draft;
}

// ── Pending / close-failure APIs ────────────────────────────────────────────
export function markActionPending(key) { _rawState.pendingActions.add(key); }
export function clearActionPending(key) { _rawState.pendingActions.delete(key); }
export function isActionPending(key) { return _rawState.pendingActions.has(key); }

export function markDevServerPokePending(uiKey) { _rawState.pendingDevServerPokes.add(uiKey); }
export function clearDevServerPokePending(uiKey) { _rawState.pendingDevServerPokes.delete(uiKey); }
export function isDevServerPokePending(uiKey) { return _rawState.pendingDevServerPokes.has(uiKey); }

export function recordCloseFailure(featureId, info) {
  _rawState.closeFailedFeatures.set(String(featureId), info);
}
export function clearCloseFailure(featureId) {
  _rawState.closeFailedFeatures.delete(String(featureId));
}
export function hasCloseFailure(featureId) {
  return _rawState.closeFailedFeatures.has(String(featureId));
}
export function getCloseFailure(featureId) {
  return _rawState.closeFailedFeatures.get(String(featureId));
}

// ── Preference mutations ────────────────────────────────────────────────────
export function setView(view) {
  storeTarget().view = view;
  persistWrite('view', view);
}

export function setFilter(filter) {
  storeTarget().filter = filter;
  persistWrite('filter', filter);
}

export function toggleCollapse(path) {
  const target = storeTarget();
  const next = { ...(target.collapsed || {}) };
  next[path] = !next[path];
  target.collapsed = next;
  persistWrite('collapsed', next);
}

export function setSidebarHidden(hidden) {
  storeTarget().sidebarHidden = !!hidden;
  persistWrite('sidebarHidden', storeTarget().sidebarHidden);
}

export function toggleSidebarHidden() {
  setSidebarHidden(!storeTarget().sidebarHidden);
}

export function setSelectedRepo(repoPath) {
  storeTarget().selectedRepo = repoPath;
  persistWrite('selectedRepo', repoPath);
}

export function isRepoHidden(repoPath) {
  return (storeTarget().hiddenRepos || []).includes(repoPath);
}

export function toggleRepoVisibility(repoPath) {
  const target = storeTarget();
  const hidden = [...(target.hiddenRepos || [])];
  const idx = hidden.indexOf(repoPath);
  if (idx >= 0) hidden.splice(idx, 1);
  else hidden.push(repoPath);
  target.hiddenRepos = hidden;
  persistWrite('hiddenRepos', hidden);
  if (typeof syncDashboardHiddenRepos === 'function') {
    syncDashboardHiddenRepos(target.hiddenRepos);
  }
}

export function setPipelineType(pipelineType) {
  storeTarget().pipelineType = pipelineType;
  persistWrite('pipelineType', pipelineType);
}

export function setPipelineGroupBySet(enabled) {
  const target = storeTarget();
  target.pipelineGroupBySet = !!enabled;
  persistWrite('pipelineGroupBySet', target.pipelineGroupBySet);
}

export function setMonitorType(monitorType) {
  storeTarget().monitorType = monitorType;
  persistWrite('monitorType', monitorType);
}

export function setExpandedPipelineColumn(columnKey, expanded = true) {
  const target = storeTarget();
  const next = { ...(target.expandedPipelineColumns || {}) };
  next[columnKey] = expanded;
  target.expandedPipelineColumns = next;
  persistWrite('expandedPipelineColumns', next);
}

export function setSettingsModelRepo(repo) {
  storeTarget().settingsModelRepo = repo;
  persistWrite('settingsModelRepo', repo);
}

export function setSettingsDefaultsRepo(repo) {
  storeTarget().settingsDefaultsRepo = repo;
  persistWrite('settingsDefaultsRepo', repo);
}

export function setFailures(count) {
  storeTarget().failures = count;
}

export function setLastStatusVersion(version) {
  storeTarget().lastStatusVersion = version;
}

export function setLastRenderedStatusVersion(version) {
  storeTarget()._lastRenderedStatusVersion = version;
}

export function setServerRestarting(restarting) {
  storeTarget().serverRestarting = !!restarting;
}

export function setSseConnected(connected) {
  storeTarget().sseConnected = !!connected;
}

// ── Alpine registration ─────────────────────────────────────────────────────
export let state = _rawState;

document.addEventListener('alpine:init', () => {
  Alpine.store('dashboard', _rawState);
  state = Alpine.store('dashboard');
  globalThis.state = state;
});

_lastRawData = applyForceProOverride(INITIAL_DATA);
assignDataFromRaw(_lastRawData, { evaluateSettled: false });

Object.assign(globalThis, {
  POLL_MS,
  TS_MS,
  lsKey,
  state,
  isRepoHidden,
  toggleRepoVisibility,
  replaceData,
  addOptimistic,
  dropOptimistic,
  applyForceProOverride,
  isProActive,
  markActionPending,
  clearActionPending,
  isActionPending,
  markDevServerPokePending,
  clearDevServerPokePending,
  isDevServerPokePending,
  recordCloseFailure,
  clearCloseFailure,
  hasCloseFailure,
  getCloseFailure,
  setView,
  setFilter,
  toggleCollapse,
  setSidebarHidden,
  toggleSidebarHidden,
  setSelectedRepo,
  setPipelineType,
  setPipelineGroupBySet,
  setMonitorType,
  setExpandedPipelineColumn,
  setSettingsModelRepo,
  setSettingsDefaultsRepo,
  setFailures,
  setLastStatusVersion,
  setLastRenderedStatusVersion,
  createEntityStartOverlay,
  createEntityDeleteOverlay,
  clearStartupPhaseForEntity,
  bumpEntityListIdentity,
});
