# Testing

Aigon uses a four-layer test pyramid. Each layer adds scope and cost.

## Test Pyramid

```
Layer 1: Unit tests          npm test              ~15s   Pure logic, no server
Layer 2: Integration tests   (included in npm test) ~3s   Workflow engine + filesystem
Layer 3: API tests           npm run test:api       ~20s  Running server, HTTP requests
Layer 4: UI tests            npm run test:ui        ~60s  Playwright, browser + server
```

## Running Tests

```bash
# Layers 1-2: unit + integration (fast, run before every commit)
npm test

# Layer 3: API tests (starts a server, verifies HTTP endpoints)
npm run test:api

# Layer 4: UI tests (Playwright, requires browser)
npm run test:ui
npm run test:ui:dashboard      # dashboard component tests only
npm run test:ui:lifecycle       # lifecycle e2e tests only

# Everything
npm run test:all
```

## Directory Structure

```
tests/
├── unit/                  Layer 1: pure logic tests
│   ├── aigon-cli.test.js       CLI command wiring, arg parsing
│   ├── workflow-core.test.js   Engine state machine, events, snapshots
│   ├── workflow-signals.test.js Signal processing, heartbeats
│   ├── workflow-snapshot-adapter.test.js Dashboard action mapping
│   ├── config.test.js          Config loading, merging, profiles
│   ├── security.test.js        Merge gate scanners, config merging
│   ├── proxy.test.js           Port allocation, registry
│   ├── entity.test.js          Spec parsing, frontmatter
│   ├── telemetry.test.js       Cost reporting, session metrics
│   ├── templates.test.js       Template registry, placeholders
│   ├── supervisor.test.js      Liveness monitoring, module isolation
│   ├── shell-trap.test.js      Signal handling, heartbeat config
│   ├── dashboard-server.test.js Status collection, detail payloads
│   ├── action-scope.test.js    Action authorization scopes
│   ├── worktree.test.js        Worktree detection, tmux helpers
│   ├── git.test.js             Git helpers, attribution
│   └── feature-spec-resolver.test.js Spec path resolution
├── integration/           Layer 2: engine + filesystem
│   ├── lifecycle.test.js       Solo/fleet lifecycle, pause/resume, dashboard actions
│   ├── e2e.test.js             Full CLI e2e against seed repos
│   ├── e2e-mock-solo.test.js   Mock agent solo worktree lifecycle
│   └── e2e-mock-fleet.test.js  Mock agent fleet lifecycle
├── api/                   Layer 3: server HTTP API
│   ├── status-actions.test.js  /api/status validActions per state
│   ├── dashboard-e2e.test.js   Full dashboard API layer
│   ├── dashboard-e2e-agents.test.js Agent lifecycle via API
│   └── dashboard-e2e-research.test.js Research flow via API
└── dashboard/             Layer 4: Playwright UI tests
    ├── playwright.config.js
    ├── server.js               Test server
    ├── actions.spec.js         Button rendering, action dispatch
    ├── analytics.spec.js       Statistics view
    ├── monitor.spec.js         Monitor tab
    └── pipeline.spec.js        Pipeline view, feature creation
tests/dashboard-e2e/       Layer 4: Playwright lifecycle tests
    ├── playwright.config.js
    ├── setup.js / teardown.js
    ├── solo-lifecycle.spec.js
    ├── fleet-lifecycle.spec.js
    └── state-consistency.spec.js
```

## When to Add Tests

| Change type | Test layer |
|-------------|-----------|
| New pure function, parser, config logic | Unit (`tests/unit/`) |
| New CLI command or workflow transition | Integration (`tests/integration/lifecycle.test.js`) |
| New or changed HTTP API endpoint | API (`tests/api/`) |
| New dashboard UI feature or button | UI (`tests/dashboard/`) |

## Writing Tests

All test files use Node.js built-in `assert` — no test frameworks required.

Pattern for unit/integration tests:
```js
const assert = require('assert');

let passed = 0, failed = 0;

function test(description, fn) {
    try { fn(); console.log(`  ✓ ${description}`); passed++; }
    catch (err) { console.error(`  ✗ ${description}\n    ${err.message}`); failed++; }
}

// ... tests ...

console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

For async tests, collect promises and `Promise.all()` them before reporting.

Playwright tests use `@playwright/test` with configs in their respective directories.

## Validation in Feature Workflow

The `feature-do` template instructs agents to run `npm test` before submitting.
The validation section of feature specs can add feature-specific checks:

```markdown
## Validation
\`\`\`bash
npm test
npm run test:api
\`\`\`
```
