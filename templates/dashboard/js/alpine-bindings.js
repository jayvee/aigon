/* dashboard-esm-processed */
/**
 * Alpine binding boundary (F640) — the ONLY module that wires markup-visible surface.
 *
 * Registered surface (complete list):
 * - Alpine.data: monitorView, pipelineView (component factories for x-data)
 * - window.aigon: formatters/constants referenced directly in index.html expressions
 * - $store.dashboard: registered in store.js on alpine:init
 *
 * Load order: main.js imports this after monitor/pipeline modules. alpine.min.js is
 * defer-loaded after main.js; module scripts run first, so alpine:init listeners here
 * are registered before Alpine evaluates x-data on the DOM.
 */
import { AGENT_DISPLAY_NAMES } from './actions-picker.js';
import { monitorView } from './monitor.js';
import {
  agentDisplayName,
  buildAgentStatusSpan,
  pipelineView,
  STAGE_LABELS,
} from './pipeline.js';
import { buildAskAgentHtml, buildMainDevServerHtml } from './sidebar.js';
import { openDrawer } from './spec-drawer.js';
import { openResearchFindingsPeek } from './terminal.js';

/** Auditable markup surface — keys must match aigon.* references in index.html. */
export const AIGON_ALPINE_MARKUP_BINDINGS = Object.freeze({
  AGENT_DISPLAY_NAMES,
  STAGE_LABELS,
  agentDisplayName,
  buildAgentStatusSpan,
  buildAskAgentHtml,
  buildMainDevServerHtml,
  openDrawer,
  openResearchFindingsPeek,
});

function createStrictBindings(bindings) {
  return new Proxy(bindings, {
    get(target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      const key = String(prop);
      console.error(`[aigon] Unregistered Alpine binding: aigon.${key} — register in js/alpine-bindings.js`);
      return undefined;
    },
  });
}

globalThis.aigon = createStrictBindings(AIGON_ALPINE_MARKUP_BINDINGS);

document.addEventListener('alpine:init', () => {
  Alpine.data('monitorView', monitorView);
  Alpine.data('pipelineView', pipelineView);
});

export { monitorView, pipelineView };
