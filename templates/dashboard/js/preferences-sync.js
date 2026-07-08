/* dashboard-esm-processed */
/** POST hidden-repo prefs — isolated so store.js avoids importing api.js. */

export async function syncDashboardHiddenRepos(hiddenRepos) {
  try {
    await fetch('/api/dashboard-preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hiddenRepos: hiddenRepos || [] }),
      cache: 'no-store',
    });
  } catch (_) { /* non-fatal — next toggle or reload will retry */ }
}
