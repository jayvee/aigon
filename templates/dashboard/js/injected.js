/* dashboard-esm-processed */
/**
 * Server-injected bootstrap — the only module that reads window.__AIGON_BOOTSTRAP__.
 * Populated by buildDashboardHtml inline script before main.js loads.
 */
const boot = globalThis.__AIGON_BOOTSTRAP__ || {};

export const INITIAL_DATA = boot.initialData ?? { repos: [] };
export const INSTANCE_NAME = boot.instanceName ?? 'main';
export const agents = Array.isArray(boot.agents) ? boot.agents : [];
export const defaultAgent = boot.defaultAgent ?? 'cc';
