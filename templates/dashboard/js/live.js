// F622: SSE live push — status version pings, notifications, server-restart signal.
(function () {
  const POLL_SLOW_MS = 60000;
  let warnedUnavailable = false;
  let es = null;
  let connected = false;
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
    if (typeof setHealth === 'function') setHealth();
    if (typeof setPollInterval === 'function') {
      setPollInterval(next ? POLL_SLOW_MS : POLL_MS);
    }
  }

  function scheduleStatusFetch() {
    if (typeof poll !== 'function') return;
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

  function connectLive() {
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
      setSseConnected(true);
      scheduleStatusFetch();
    });

    es.addEventListener('error', () => {
      setSseConnected(false);
    });

    es.addEventListener('status', () => {
      scheduleStatusFetch();
    });

    es.addEventListener('notification', () => {
      if (typeof loadNotifications === 'function') loadNotifications();
    });

    es.addEventListener('server-restarting', () => {
      if (typeof showServerRestartBanner === 'function') showServerRestartBanner();
      setSseConnected(false);
    });
  }

  window.connectLive = connectLive;
  window.isSseConnected = () => connected;
})();
