'use strict';

const { spawnSync } = require('child_process');
const { fingerprint } = require('../fingerprint');

function isAvailable() {
    const r = spawnSync('which', ['semgrep'], { encoding: 'utf8' });
    return r.status === 0;
}

const CONFIGS = ['p/javascript', 'p/owasp-top-ten', 'p/nodejsscan'];

async function run(opts = {}) {
    if (!isAvailable()) {
        return { skipped: true, reason: 'semgrep not installed', findings: [], raw: '' };
    }

    const cwd = opts.cwd || process.cwd();
    const configArgs = CONFIGS.flatMap(c => ['--config', c]);
    const result = spawnSync(
        'semgrep',
        [...configArgs, '--json', cwd],
        { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000 }
    );

    const raw = result.stdout || '';
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        return { skipped: false, findings: [], raw };
    }

    const results = (parsed && parsed.results) || [];
    const findings = results.map(r => {
        const sev = (r.extra && r.extra.severity) || 'WARNING';
        const normalized = sev.toUpperCase();
        const severity = normalized === 'ERROR' ? 'HIGH' : normalized === 'WARNING' ? 'MEDIUM' : 'LOW';
        const file = r.path || '';
        const line = (r.start && r.start.line) || 0;
        const message = (r.extra && r.extra.message) || '';
        const snippet = (r.extra && r.extra.lines) || message;
        return {
            tool: 'semgrep',
            severity,
            confidence: 0.8,
            category: (r.check_id || '').replace(/^.*\./, ''),
            file,
            line,
            message: `${r.check_id || ''}: ${message}`,
            fingerprint: fingerprint(r.check_id || 'semgrep', file, snippet),
        };
    });

    return { skipped: false, findings, raw };
}

module.exports = { run };
