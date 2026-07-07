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

// Application globals the dashboard's classic scripts intentionally share across
// files. The dashboard's *.js files load as ordered <script> tags into one
// shared global scope: a top-level `function escHtml(){}` / `const state = …` in
// one file is read bare in others. ESLint lints each file in isolation and
// cannot see another file's top-level declarations, so these cross-file globals
// must be declared here or no-undef false-positives on every shared reference.
//
// This list was derived empirically: it is exactly the set of identifiers that
// are (a) referenced bare in some classic script and (b) declared at top level
// in some *other* classic script (or provided by a Pro-tier script that is
// absent from OSS — fmtSyncTime / renderBackupSync / renderScheduledFeatures,
// guarded with `typeof … === 'function'`). `module` is the CommonJS dual-use
// guard. CRITICAL: an undeclared global used bare within its own file — the
// F556 `AUTONOMOUS_AGENT_IDS` incident — is NOT on this list and therefore stays
// caught by no-undef. Do not add a name here to silence an error without first
// confirming it is genuinely defined somewhere; that is how the incident shipped.
const dashboardAppGlobals = {
    AGENT_DISPLAY_NAMES: 'writable', AGENT_SHORT_NAMES: 'readonly', AIGON_AGENTS: 'writable',
    INITIAL_DATA: 'readonly', INSTANCE_NAME: 'readonly', POLL_MS: 'readonly',
    TS_MS: 'readonly', _formatHeadlineAge: 'readonly', alignAllSeries: 'readonly',
    applyCommitWindow: 'readonly', applyCpfWindow: 'readonly',
    applyCycleTimeWindow: 'readonly', applyForceProOverride: 'readonly',
    applyReworkWindow: 'readonly', applyTokenWindow: 'readonly', applyVolumeWindow: 'readonly',
    benchTooltip: 'readonly', budgetWarningForAgents: 'readonly',
    buildAskAgentHtml: 'readonly', buildCardHeadlineHtml: 'readonly',
    buildCommitSeries: 'readonly', buildCommitsPerFeatureSeries: 'readonly',
    buildCycleTimeSeries: 'readonly', buildInsightsMetricsSection: 'readonly',
    buildKvLabel: 'readonly', buildMainDevServerHtml: 'readonly',
    buildProGatedChart: 'readonly', buildProGatedStatCard: 'readonly',
    buildReworkRatioSeries: 'readonly', buildScheduledGlyphHtml: 'readonly',
    buildSparklineSvg: 'readonly', buildSpecDriftBadgeHtml: 'readonly',
    buildLeaseBadgeHtml: 'readonly', buildStorageStatusBadgeHtml: 'readonly',
    formatLeaseHolderLabel: 'readonly',
    buildStatCard: 'readonly', buildTokenSeries: 'readonly', buildVolumeSeries: 'readonly',
    closeDrawer: 'readonly', complexityBadgeHtml: 'readonly', connectLive: 'readonly', copyText: 'readonly',
    createDrawerDetailTabs: 'readonly', createEl: 'readonly', drawerState: 'writable',
    escHtml: 'readonly', featureRank: 'readonly', fetchAgentModels: 'readonly',
    fetchBudget: 'readonly', fetchPrStatus: 'readonly', fetchSpecRecommendation: 'readonly',
    filterCommitsByPeriodAndRepo: 'readonly', filterFeaturesByPeriodAndRepo: 'readonly',
    fmtHours: 'readonly', fmtNum: 'readonly', fmtPct: 'readonly', fmtSyncTime: 'readonly',
    formatFeatureIdForDisplay: 'readonly', getAskAgent: 'readonly',
    getTerminalClickTarget: 'readonly', getTerminalFont: 'readonly',
    getVisibleRepos: 'readonly', handleCloseWithAgent: 'readonly',
    handleFeatureAction: 'readonly', handleSetAction: 'readonly',
    initAmpTokenCharts: 'readonly', isCompleteStatus: 'readonly', isProActive: 'readonly',
    isRepoHidden: 'readonly', loadAnalytics: 'readonly', loadCommits: 'readonly',
    loadInsights: 'readonly', loadNotifications: 'readonly', logsDateFmt: 'readonly', lsKey: 'readonly', module: 'readonly',
    openDrawer: 'readonly', openResearchFindingsPeek: 'readonly',
    openTerminalPanel: 'readonly', panCycleTimeChart: 'readonly', panVolumeChart: 'readonly',
    poll: 'readonly',
    postMarkComplete: 'readonly', quotaEntryForModel: 'readonly', quotaTooltip: 'readonly',
    reapplyPendingOptimisticEntityStarts: 'readonly', relTime: 'readonly', render: 'readonly',
    renderActionButtons: 'readonly', renderAgentPickerRows: 'readonly',
    renderAllItemsView: 'readonly', renderBackupSync: 'readonly',
    renderCommitChart: 'readonly', renderCpfChart: 'readonly',
    renderCycleTimeChart: 'readonly', renderLogs: 'readonly',
    renderPickerRecommendationBanner: 'readonly', renderRepoHeader: 'readonly',
    renderReworkChart: 'readonly', renderScheduledFeatures: 'readonly',
    renderSettings: 'readonly', renderSidebar: 'readonly', renderStatistics: 'readonly',
    renderTokenChart: 'readonly', renderUpdateBadge: 'readonly', renderVolumeChart: 'readonly',
    replaceNodeChildren: 'readonly', requestAction: 'readonly',
    requestAgentDevServerPoke: 'readonly', requestAgentFlagAction: 'readonly',
    requestAttach: 'readonly', requestFeatureOpen: 'readonly', requestRefresh: 'readonly',
    requestRepoMainDevServerStart: 'readonly', requestSpecReconcile: 'readonly',
    requestSpecReviewLaunch: 'readonly', runAskAgent: 'readonly', saveStatsPrefs: 'readonly',
    setAskAgent: 'readonly', setHealth: 'readonly', setPickerRecommendation: 'readonly',
    setPollInterval: 'writable',
    setTerminalClickTarget: 'readonly', setTerminalFont: 'readonly',
    showAgentPicker: 'readonly', showConfirm: 'readonly', showDangerConfirm: 'readonly',
    showNudgeModal: 'readonly', showServerRestartBanner: 'readonly', showToast: 'readonly',
    state: 'writable', statsState: 'writable', statusRank: 'readonly', termState: 'writable',
    toggleRepoVisibility: 'readonly', trendIcon: 'readonly', tripletsToCliArgs: 'readonly',
    updatePickerBudgetNotice: 'readonly', updateTitleAndFavicon: 'readonly',
    updateViewTabs: 'readonly',
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
    // F556: dashboard classic <script> files. These are browser scripts loaded
    // in order by index.html and sharing one global scope. Lint with
    // sourceType:'script' + no-undef:error so an undeclared application global
    // (the AUTONOMOUS_AGENT_IDS incident) is caught before it ships.
    {
        files: ['templates/dashboard/js/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                ...browserGlobals,
                ...dashboardVendorGlobals,
                ...dashboardAppGlobals,
            },
        },
        rules: {
            'no-undef': 'error',
            // The cross-file globals above ARE declared in their defining file,
            // so the legitimate definition must not trip no-redeclare. We still
            // catch true in-file duplicate declarations (builtinGlobals only
            // governs whether configured globals count as prior declarations).
            'no-redeclare': ['error', { builtinGlobals: false }],
            'no-unused-vars': 'off',
        },
    },
    // F556: dashboard action modules under js/actions/** are ES modules
    // (import/export) lazy-loaded via dynamic import(). They reach classic-script
    // globals through `window.*`, so they need browser globals but not the
    // cross-file app-global allowlist.
    {
        files: ['templates/dashboard/js/actions/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...browserGlobals,
                ...dashboardVendorGlobals,
            },
        },
        rules: {
            'no-undef': 'error',
            'no-redeclare': ['error', { builtinGlobals: false }],
            'no-unused-vars': 'off',
        },
    },
];
