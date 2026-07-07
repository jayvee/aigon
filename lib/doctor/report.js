'use strict';

// DoctorReport — structured collector for `aigon doctor` issues + triage digest.
// Feature 550 (doctor-triage-digest). Severity table is the single source of
// truth; sections call `report.issue({ section, check, message, fix })` and
// severity is derived from the check id (override allowed).

const SEVERITY = {
    blocking: 'blocking',
    degraded: 'degraded',
    advisory: 'advisory',
};

// Maps check id → severity. Acceptance spec §"Severity mapping (initial)".
const SEVERITY_BY_CHECK = {
    // Prerequisites
    'prereq-git-missing': SEVERITY.blocking,
    'prereq-node-too-old': SEVERITY.blocking,
    'prereq-tmux-missing': SEVERITY.advisory,
    'prereq-no-agents-installed': SEVERITY.advisory,
    'legacy-codex-prompts': SEVERITY.advisory,
    'default-agent-misconfigured': SEVERITY.advisory,

    // Agent Auth
    'agent-unauthenticated': SEVERITY.degraded,
    'agent-auth-check-failed': SEVERITY.degraded,
    'provider-quota': SEVERITY.degraded,
    'provider-quota-warning': SEVERITY.advisory,

    // Model Health
    'model-warning': SEVERITY.advisory,
    'model-template-missing': SEVERITY.degraded,

    // Terminal App
    'terminal-app-missing': SEVERITY.degraded,

    // Multi-Repo Version Sweep
    'repo-version-behind': SEVERITY.degraded,
    'repo-version-missing': SEVERITY.advisory,

    // tmux Liveness
    'tmux-error': SEVERITY.degraded,

    // Dashboard Health
    'dashboard-unhealthy': SEVERITY.degraded,

    // Shell PATH
    'shell-path-mismatch': SEVERITY.advisory,
    'shell-path-aigon-missing': SEVERITY.advisory,

    // git Identity
    'git-identity-missing': SEVERITY.degraded,

    // Stash Hygiene
    'stale-auto-stash': SEVERITY.advisory,

    // Port Health
    'port-conflict': SEVERITY.degraded,
    'port-range-overlap': SEVERITY.degraded,
    'port-stale': SEVERITY.advisory,

    // Proxy Health
    'caddy-not-installed': SEVERITY.degraded,
    'caddy-not-running': SEVERITY.degraded,
    'proxy-diag-failed': SEVERITY.advisory,

    // Backup
    'backup-not-configured': SEVERITY.advisory,

    // Signal-health
    'signal-health-low-reliability': SEVERITY.advisory,

    // State Reconciliation
    'pre-commit-hook-missing': SEVERITY.degraded,
    'git-hooks-path-missing': SEVERITY.degraded,
    'env-local-tracked': SEVERITY.degraded,
    'env-local-untracked': SEVERITY.advisory,
    'stage-mismatch': SEVERITY.degraded,
    'orphaned-worktree': SEVERITY.degraded,
    'stale-pending': SEVERITY.advisory,
    'dead-agent': SEVERITY.advisory,
    'stale-implementing-session-ended': SEVERITY.advisory,
    'stale-drive-branch': SEVERITY.advisory,
    'stale-lock': SEVERITY.advisory,
    'log-migration': SEVERITY.advisory,
    'research-folder-renumber': SEVERITY.degraded,
    'invalid-spec-agent-field': SEVERITY.advisory,
    'pending-migrations': SEVERITY.degraded,
    'migration-failed': SEVERITY.blocking,
    'install-manifest-corrupt': SEVERITY.degraded,
    'install-manifest-missing': SEVERITY.advisory,
    'install-manifest-missing-files': SEVERITY.degraded,
    'install-manifest-modified': SEVERITY.degraded,
    'partial-bootstrap': SEVERITY.blocking,
    'missing-workflow-state': SEVERITY.degraded,
    'misplaced-slug-spec': SEVERITY.advisory,
    'legacy-submitted-lifecycle': SEVERITY.advisory,
    'spec-folder-drift': SEVERITY.degraded,
    'worktree-dir-missing': SEVERITY.advisory,
    'legacy-worktree-location': SEVERITY.advisory,
    'profile-sync-not-configured': SEVERITY.advisory,
};

function severityForCheck(check) {
    return SEVERITY_BY_CHECK[check] || null;
}

const SEVERITY_ORDER = [SEVERITY.blocking, SEVERITY.degraded, SEVERITY.advisory];
const SEVERITY_RANK = { [SEVERITY.blocking]: 0, [SEVERITY.degraded]: 1, [SEVERITY.advisory]: 2 };
const SEVERITY_GLYPH = {
    [SEVERITY.blocking]: '❌',
    [SEVERITY.degraded]: '⚠️ ',
    [SEVERITY.advisory]: 'ℹ️ ',
};

class DoctorReport {
    constructor(opts = {}) {
        this.issues = [];
        this.sections = new Map();
        // F551: render mode. 'default' collapses healthy sections; 'full' expands all.
        this.mode = opts.mode === 'full' ? 'full' : 'default';
    }

    section(id, title) {
        if (!this.sections.has(id)) {
            this.sections.set(id, { id, title: title || id, status: 'pass', issueCount: 0, summaryLine: null });
        }
        const s = this.sections.get(id);
        if (title) s.title = title;
        return s;
    }

    pass(id, title, summaryLine) {
        const s = this.section(id, title);
        if (summaryLine) s.summaryLine = summaryLine;
        return s;
    }

    // Primary entry point.
    // { section, sectionTitle, check, message, detail, severity, fix }
    issue(opts) {
        if (!opts || !opts.section) throw new Error('DoctorReport.issue: section required');
        if (!opts.check) throw new Error('DoctorReport.issue: check required');
        if (!opts.message) throw new Error('DoctorReport.issue: message required');
        const severity = opts.severity || severityForCheck(opts.check) || SEVERITY.advisory;
        const fix = opts.fix
            ? {
                label: opts.fix.label || null,
                command: opts.fix.command || null,
                autoFixable: opts.fix.autoFixable === true,
            }
            : null;
        const entry = {
            section: opts.section,
            check: opts.check,
            message: opts.message,
            detail: opts.detail || null,
            severity,
            fix,
        };
        this.issues.push(entry);
        const s = this.section(opts.section, opts.sectionTitle);
        s.issueCount += 1;
        if (severity === SEVERITY.blocking) s.status = 'fail';
        else if (s.status !== 'fail') s.status = 'warn';
        return entry;
    }

    // Mirror a legacy `{check, featureId, message, safe}` issue (used by the
    // existing State Reconciliation array). `safe === true` → fix is auto via
    // `aigon doctor --fix`.
    fromLegacy(legacy, sectionId = 'state-reconciliation', sectionTitle = 'State Reconciliation') {
        if (!legacy || !legacy.check) return null;
        const severity = severityForCheck(legacy.check) || (legacy.safe ? SEVERITY.advisory : SEVERITY.degraded);
        const fix = legacy.safe
            ? { label: 'auto-fix', command: 'aigon doctor --fix', autoFixable: true }
            : null;
        const tag = legacy.featureId && legacy.featureId !== '-' ? `[${legacy.featureId}] ` : '';
        return this.issue({
            section: sectionId,
            sectionTitle,
            check: legacy.check,
            message: `${tag}${legacy.message}`,
            severity,
            fix,
        });
    }

    worstSeverity() {
        for (const sev of SEVERITY_ORDER) {
            if (this.issues.some(i => i.severity === sev)) return sev;
        }
        return null;
    }

    countAutoFixable() {
        return this.issues.filter(i => i.fix && i.fix.autoFixable).length;
    }

    summaryCounts() {
        const auto = this.countAutoFixable();
        return { total: this.issues.length, autoFixable: auto, manual: this.issues.length - auto };
    }

    render(opts = {}) {
        const out = (opts.log || console.log);
        out('');
        out('─── Triage ' + '─'.repeat(48));
        if (this.issues.length === 0) {
            out(' ✅ No issues found');
            out('─'.repeat(58));
            return;
        }
        const sorted = [...this.issues].sort(
            (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        );
        const sectionWidth = Math.max(
            8,
            ...sorted.map(i => String(i.section).length)
        );
        let lastSev = null;
        for (const i of sorted) {
            if (i.severity !== lastSev) {
                out(` ${i.severity}`);
                lastSev = i.severity;
            }
            const sec = String(i.section).padEnd(sectionWidth);
            const fixCol = i.fix && i.fix.command ? `   ${i.fix.command}` : '';
            out(`  ${SEVERITY_GLYPH[i.severity]} ${sec}  ${i.message}${fixCol}`);
        }
        out('─'.repeat(58));
        const { total, autoFixable, manual } = this.summaryCounts();
        const word = total === 1 ? 'issue' : 'issues';
        out(`${total} ${word} — ${autoFixable} auto-fixable with \`aigon doctor --fix\`, ${manual} manual`);
    }
}

module.exports = {
    DoctorReport,
    SEVERITY,
    SEVERITY_BY_CHECK,
    severityForCheck,
};
