/* dashboard-esm-processed */

import { POLL_MS, state } from './state.js';
import { setHealth, showServerRestartBanner } from './monitor.js';
import { loadNotifications, poll, setPollInterval } from './poll.js';

const POLL_SLOW_MS = 60000;
let warnedUnavailable = false;
let es = null;
let connected = false;
let everOpened = false;
let fetchInFlight = false;
let needsFollowUp = false;

function warnOnce(msg) {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(msg);
}

function setSseConnected(next) {
  if (connected === next) return;
  connected = next;
  state.sseConnected = next;
  setHealth();
  setPollInterval(next ? POLL_SLOW_MS : POLL_MS);
}

function scheduleStatusFetch() {
  if (fetchInFlight) {
    needsFollowUp = true;
    return;
  }
  fetchInFlight = true;
  Promise.resolve(poll()).finally(() => {
    fetchInFlight = false;
    if (needsFollowUp) {
      needsFollowUp = false;
      scheduleStatusFetch();
    }
  });
}

export function connectLive() {
  if (typeof EventSource === 'undefined') {
    warnOnce('[aigon] EventSource unavailable — using poll fallback');
    return;
  }
  try {
    es = new EventSource('/api/events');
  } catch (_) {
    warnOnce('[aigon] SSE unavailable — using poll fallback');
    return;
  }

  es.addEventListener('open', () => {
    everOpened = true;
    setSseConnected(true);
    scheduleStatusFetch();
  });

  es.addEventListener('error', () => {
    setSseConnected(false);
    if (!everOpened) {
      warnOnce('[aigon] SSE unavailable — using poll fallback');
      try { es.close(); } catch (_) {}
    }
  });

  es.addEventListener('status', () => {
    scheduleStatusFetch();
  });

  es.addEventListener('notification', () => {
    loadNotifications();
  });

  es.addEventListener('server-restarting', () => {
    showServerRestartBanner();
    setSseConnected(false);
  });
}
