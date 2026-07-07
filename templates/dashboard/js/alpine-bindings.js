/* dashboard-esm-processed */
/**
 * Alpine x-data factories — exposed on globalThis for markup (x-data="monitorView()").
 * Alpine CDN loads after main.js so these are set before Alpine evaluates components.
 */
import { monitorView } from './monitor.js';
import { pipelineView } from './pipeline.js';

globalThis.monitorView = monitorView;
globalThis.pipelineView = pipelineView;

export { monitorView, pipelineView };
