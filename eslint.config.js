'use strict';

const globals = {
    __dirname: 'readonly',
    __filename: 'readonly',
    Buffer: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    console: 'readonly',
    exports: 'writable',
    global: 'readonly',
    module: 'readonly',
    process: 'readonly',
    require: 'readonly',
    setImmediate: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
};

// Browser runtime globals available to the dashboard's classic <script> files.
// These are the standard DOM/Web APIs the dashboard JS legitimately uses. The
// point of linting dashboard JS at all is to catch undeclared *application*
// globals (F556 incident: a bare `AUTONOMOUS_AGENT_IDS` reference that was never
// defined). Keep this list to genuine platform APIs — do not park unknown
// identifiers here just to silence no-undef, or the check stops catching bugs.
const browserGlobals = {
    window: 'readonly',
    document: 'readonly',
    console: 'readonly',
    fetch: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    requestAnimationFrame: 'readonly',
    cancelAnimationFrame: 'readonly',
    CSS: 'readonly',
    CustomEvent: 'readonly',
    Event: 'readonly',
    EventSource: 'readonly',
    WebSocket: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    FormData: 'readonly',
    Blob: 'readonly',
    File: 'readonly',
    FileReader: 'readonly',
    Image: 'readonly',
    XMLHttpRequest: 'readonly',
    localStorage: 'readonly',
    sessionStorage: 'readonly',
    location: 'readonly',
    history: 'readonly',
    navigator: 'readonly',
    alert: 'readonly',
    confirm: 'readonly',
    prompt: 'readonly',
    getComputedStyle: 'readonly',
    MutationObserver: 'readonly',
    IntersectionObserver: 'readonly',
    ResizeObserver: 'readonly',
    DOMParser: 'readonly',
    Node: 'readonly',
    HTMLElement: 'readonly',
    Element: 'readonly',
    AbortController: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
    structuredClone: 'readonly',
    queueMicrotask: 'readonly',
    performance: 'readonly',
    btoa: 'readonly',
    atob: 'readonly',
    crypto: 'readonly',
};

// Third-party libraries loaded ahead of the dashboard modules via <script>
// tags in index.html (Alpine, marked, Chart.js, xterm + addons). They are real
// globals at runtime; declare them so no-undef does not false-positive on them.
const dashboardVendorGlobals = {
    Alpine: 'readonly',
    marked: 'readonly',
    Chart: 'readonly',
    Terminal: 'readonly',
    FitAddon: 'readonly',
    WebglAddon: 'readonly',
    Unicode11Addon: 'readonly',
    WebLinksAddon: 'readonly',
};

module.exports = [
    // Third-party bundled libraries shipped under the dashboard — never lint.
    {
        ignores: ['templates/dashboard/js/vendor/**'],
    },
    {
        files: ['lib/**/*.js', 'tests/integration/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals,
        },
        rules: {
            'no-redeclare': 'error',
            'no-undef': 'error',
            'no-unused-vars': 'off',
        },
    },
    {
        files: [
            'lib/dashboard-status-collector.js',
            'lib/workflow-rules-report.js',
            'tests/integration/**/*.js',
        ],
        rules: {
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
        },
    },
    // F623/F641: dashboard ES modules — only vendor + browser environment globals.
    {
        files: ['templates/dashboard/js/**/*.js'],
        ignores: ['templates/dashboard/js/vendor/**'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...browserGlobals,
                ...dashboardVendorGlobals,
                __AIGON_BOOTSTRAP__: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-redeclare': ['error', { builtinGlobals: false }],
            'no-unused-vars': 'off',
        },
    },
];
