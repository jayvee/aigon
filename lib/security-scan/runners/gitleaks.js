'use strict';

const { spawnSync } = require('child_process');
const { fingerprint } = require('../fingerprint');

function isAvailable() {
    const r = spawnSync('which', ['gitleaks'], { encoding: 'utf8' });
    return r.status === 0;
}

async function run(opts = {}) {
    if (!isAvailable()) {
        return { skipped: true, reason: 'gitleaks not installed', findings: [], raw: '' };
    }

    const cwd = opts.cwd || process.cwd();
    const result = spawnSync(
        'gitleaks',
        ['detect', '--no-git', '--report-format', 'json', '--report-path', '/dev/stdout', '--redact', '--source', cwd],
        { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }
    );

    const raw = result.stdout || '';
    let parsed = [];
    try {
        parsed = JSON.parse(raw) || [];
    } catch (_) {
        if (result.status !== 0 && !raw.trim()) {
            return { skipped: false, findings: [], raw };
        }
    }

    if (!Array.isArray(parsed)) parsed = [];

    const findings = parsed.map(r => ({
        tool: 'gitleaks',
        severity: 'HIGH',
        confidence: 0.9,
        category: 'secret-exposure',
        file: r.File || '',
        line: r.StartLine || 0,
        message: `${r.Description || 'Secret detected'}: ${r.RuleID || ''}`,
        fingerprint: fingerprint('secret-exposure', r.File || '', r.Secret || r.Match || ''),
    }));

    return { skipped: false, findings, raw };
}

module.exports = { run };
