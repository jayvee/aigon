# Feature: dashboard-sse-push-model-replace-polling-with-server-sent-events

## Summary

Replace the dashboard's pull-based polling model (frontend fetches `/api/status` every 10 seconds) with a push-based Server-Sent Events (SSE) model. The server maintains a unified in-memory state, detects changes via a lightweight internal tick, and pushes JSON diffs to all connected browser clients only when state actually changes. Done features are sent once on connection and never retransmitted. This eliminates the fundamental mismatch between poll rate and actual change rate — at idle (no features in progress) the server emits nothing; during an active Fleet run it pushes updates the moment agent state changes.

This is the long-term target architecture for the dashboard. It should be implemented after the tiered-polling quick win (Option A) has stabilised.

---

## Current Architecture and Why It Doesn't Scale

### The pull model

```
Frontend                    Server
  |                           |
  |— GET /api/status -------->|  (every 10s, unconditionally)
  |                           |  collectDashboardStatusData()  ← full I/O every time
  |<—— 200 JSON (500KB) ——---|
  |  render()                 |
  |                           |
  |— GET /api/status -------->|  (10s later, even if nothing changed)
  ...
```

**Problems with this model:**
- **Unconditional I/O**: The server collects all data every 10s regardless of whether anything changed. A project at rest (no active features) still performs the full poll cycle — reading directories, statting files, spawning tmux subprocesses.
- **Unbounded growth**: Poll cycle time grows linearly with done-feature count. At 400 done features the cycle is ~200ms; at 4000 it becomes 2000ms — approaching or exceeding the poll interval itself.
- **Wasted bandwidth**: A 500KB JSON payload is sent to every connected browser every 10s even when the state is byte-for-byte identical to the previous response.
- **Latency floor**: State changes (agent submits, eval starts) are visible at most 10s after they happen. With a push model, changes are visible in under 1s.
- **Multi-tab waste**: Each open browser tab maintains its own poll loop. 3 tabs = 3× the server-side API calls.

### What already exists

The server has a WebSocket relay at `/ws` (`lib/dashboard-server.js` ~L1400-1500) used for session peek output streaming. The infrastructure for long-lived connections is already present. SSE does not require a WebSocket — it works over plain HTTP/1.1 and is simpler to implement.

---

## Solution: SSE Push Model

### Architecture

```
Server                              Frontend
  |                                   |
  |  Internal state machine           |— GET /api/stream ——————>|
  |  (in-memory, updated by           |                          |  (persistent connection)
  |   lightweight tick loop)          |<—— event: snapshot ——————|  (full state on connect)
  |                                   |
  |  State changes detected           |<—— event: patch ——————————|  (delta on change)
  |  → broadcast patch to             |  applyPatch(state, patch) |
  |    all SSE clients                |  render()                 |
  |                                   |
  |  (nothing to broadcast)           |  (no network traffic)
```

### Key components

#### 1. Server-side state manager (`lib/dashboard-state-manager.js`, new)

Owns the canonical in-memory state. Responsibilities:
- Runs an internal tick (10s for hot data, tiered for cold — builds on Option A)
- On each tick: collect new state, diff against previous state
- If diff is non-empty: broadcast patch to all SSE clients
- Exposes `getSnapshot()` for the initial connection payload
- Exposes `subscribe(clientId, writeFn)` / `unsubscribe(clientId)` for SSE client management

```js
// Pseudo-code
class DashboardStateManager {
    #state = null;
    #clients = new Map();  // clientId → writeFn

    async tick() {
        const next = await collectDashboardStatusData();
        const patch = diff(this.#state, next);
        if (patch.length > 0) {
            this.#state = next;
            this.#broadcast(patch);
        }
    }

    subscribe(id, write) {
        this.#clients.set(id, write);
        write({ event: 'snapshot', data: this.#state });  // full state on connect
    }

    #broadcast(patch) {
        for (const write of this.#clients.values()) {
            write({ event: 'patch', data: patch });
        }
    }
}
```

#### 2. SSE endpoint (`GET /api/stream`)

Added to `lib/dashboard-server.js`:

```js
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const id = crypto.randomUUID();
    const write = ({ event, data }) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    stateManager.subscribe(id, write);
    req.on('close', () => stateManager.unsubscribe(id));
});
```

`GET /api/status` is retained as a fallback for non-SSE clients (CLI tools, health checks, old browser tabs).

#### 3. JSON diff algorithm

Use a structural diff that produces an array of RFC 6902-style JSON Patch operations (or a simplified equivalent). Only changed keys are transmitted.

For the aigon state shape, a practical diff approach:
- Features: keyed by `id` — emit `replace` operations for changed fields, `add` for new features, `remove` for deleted
- Agents within a feature: same keyed approach
- Top-level summary counters: emit `replace` when changed

A minimal custom differ for the known state shape is preferable to a general-purpose JSON patch library — the shape is well-known and stable.

#### 4. Frontend changes (`templates/dashboard/js/state.js`, `init.js`)

Replace the `setInterval(poll, POLL_MS)` loop with an SSE subscription:

```js
// Before
setInterval(poll, POLL_MS);

// After
const stream = new EventSource('/api/stream');

stream.addEventListener('snapshot', (e) => {
    state.data = JSON.parse(e.data);
    render();
});

stream.addEventListener('patch', (e) => {
    const patch = JSON.parse(e.data);
    state.data = applyPatch(state.data, patch);
    render();
});

stream.addEventListener('error', () => {
    // EventSource auto-reconnects; on reconnect server sends fresh snapshot
});
```

`EventSource` reconnects automatically on network interruption. On reconnect, the server sends a full snapshot — no client-side reconciliation needed.

#### 5. Multi-tab deduplication

Each browser tab opens one SSE connection. The server's `#clients` map holds all active connections. The state manager runs one tick loop regardless of client count — cost is constant, not proportional to tabs.

---

## User Stories

- [ ] As a user, agent status changes (submitted, error, evaluating) are visible in the dashboard within 1 second, not up to 10 seconds
- [ ] As a user, the dashboard at idle (no active features) consumes near-zero server CPU and network bandwidth
- [ ] As a user with 3 browser tabs open, the server still runs one poll cycle, not three
- [ ] As a developer, opening the dashboard on a project with 1000 done features loads instantly — done features are sent once and never re-polled
- [ ] As a user, the dashboard reconnects automatically after a server restart with no manual refresh required

## Acceptance Criteria

- [ ] `GET /api/stream` endpoint returns `Content-Type: text/event-stream` and sends an initial `snapshot` event with full state
- [ ] When any feature/agent state changes, a `patch` event is pushed to all connected clients within one tick (≤10s)
- [ ] When nothing changes, no SSE events are emitted (zero bytes sent at idle)
- [ ] Multiple browser tabs share one server-side poll cycle (client count does not multiply I/O)
- [ ] Done features are included in the initial `snapshot` and not re-sent in subsequent `patch` events unless they change (they won't)
- [ ] `GET /api/status` continues to work as a fallback (returns current in-memory state, no new I/O)
- [ ] Client auto-reconnects after server restart and receives fresh snapshot
- [ ] Dashboard renders correctly from patch application — no visual glitches from partial updates
- [ ] SSE connections are cleaned up when browser tab closes (no memory leak in `#clients` map)
- [ ] Works correctly with Caddy reverse proxy (`aigon.localhost`) — proxy must not buffer SSE responses

## Validation

```bash
node -c lib/dashboard-server.js
node -c lib/dashboard-state-manager.js
# Manual: open dashboard, watch Network tab — /api/stream should show persistent connection
# Manual: submit a feature from a worktree — dashboard should update within 1s
# Manual: idle project — no SSE events after initial snapshot
# Manual: close tab — server should log client disconnect
```

## Technical Approach

### Implementation sequence

1. **Extract `lib/dashboard-state-manager.js`** — move `collectDashboardStatusData()` call and `latestStatus` variable from `dashboard-server.js` into the state manager. Wire tick loop there.
2. **Add `GET /api/stream`** in `dashboard-server.js` — thin wrapper over `stateManager.subscribe()`.
3. **Implement diff** — write `diffState(prev, next)` returning a patch array. Start simple: full feature-level replacement (replace entire feature object when any field changes). Optimise field-level diffs later.
4. **Update frontend** — replace `setInterval(poll, POLL_MS)` with `EventSource`. Keep `poll()` as a fallback callable from the manual refresh button.
5. **Caddy config** — verify `aigon.localhost` proxy does not buffer SSE. Caddy handles SSE correctly by default with HTTP/1.1 (`flush_interval -1` or automatic).
6. **Retain `/api/status`** — returns `stateManager.getSnapshot()` synchronously, no I/O.

### Diff strategy (start simple)

```js
function diffState(prev, next) {
    const ops = [];
    if (!prev) return [{ op: 'replace', path: '/', value: next }];

    // Per-repo features: diff by feature id
    for (const repo of next.repos) {
        const prevRepo = prev.repos.find(r => r.path === repo.path);
        for (const feature of repo.features) {
            const prevFeature = prevRepo?.features.find(f => f.id === feature.id);
            if (!prevFeature || JSON.stringify(prevFeature) !== JSON.stringify(feature)) {
                ops.push({ op: 'replace', path: `/features/${feature.id}`, value: feature });
            }
        }
        // Handle added/removed features
    }
    return ops;
}
```

JSON.stringify comparison is adequate for initial implementation — the state objects are small per-feature and the comparison only runs when the tick detects any change.

### Caddy proxy consideration

SSE requires the proxy not to buffer responses. Caddy 2.x handles this correctly when the response has `Content-Type: text/event-stream`. No Caddy config change needed. Verify by checking that `event: snapshot` arrives in the browser immediately after connecting (not delayed until buffer fills).

## Dependencies

- `depends_on: tiered-polling-hot-warm-cold-data-separation` — Option A should be implemented first to stabilise the collection layer before refactoring how it's consumed. The state manager builds on the tiered collector.
- No new npm dependencies — `EventSource` is native in all modern browsers; SSE is native Node.js HTTP.

## Out of Scope

- Filesystem watchers (Option B) — the SSE model is compatible with fs-watch as a change detection source, but this feature uses the existing tick-based collector
- Field-level JSON Patch (RFC 6902) — start with feature-level replacement, optimise later
- Offline support / service workers
- SSE authentication / per-user filtering (all repos shown to all local users — current behaviour preserved)
- WebSocket upgrade (SSE is sufficient; WebSocket adds handshake complexity for no benefit here)

## Open Questions

- Should the diff include research and feedback entities, or start with features only? (Proposed: include all from day one — the diff function operates on the full state shape)
- What happens to the `POST /api/action` flow after SSE? (No change — actions still POST, response still comes from HTTP. SSE carries state, not responses to commands.)
- Should `/api/refresh` (manual refresh button) force a tick, or just return the current snapshot? (Proposed: force a tick — preserves current UX where the button fetches fresh data)

## Related

- `feature-tiered-polling-hot-warm-cold-data-separation` — Option A, prerequisite, should ship first
- Option B (filesystem watchers) — not specced; could replace the tick loop inside the state manager as a future optimisation without changing the SSE frontend contract
- Existing WebSocket relay (`/ws`) — used for session peek; unrelated to this feature, retained as-is
