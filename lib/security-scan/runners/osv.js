'use strict';

const { spawnSync } = require('child_process');
const { fingerprint } = require('../fingerprint');

function isAvailable() {
    const r = spawnSync('which', ['osv-scanner'], { encoding: 'utf8' });
    return r.status === 0;
}

async function run(opts = {}) {
    if (!isAvailable()) {
        return { skipped: true, reason: 'osv-scanner not installed', findings: [], raw: '' };
    }

    const cwd = opts.cwd || process.cwd();
    const result = spawnSync(
        'osv-scanner',
        ['scan', 'source', '--format', 'json', cwd],
        { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 }
    );

    const raw = result.stdout || '';
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        return { skipped: false, findings: [], raw };
    }

    const results = (parsed && parsed.results) || [];
    const findings = [];

    for (const res of results) {
        for (const pkg of (res.packages || [])) {
            for (const vuln of (pkg.vulnerabilities || [])) {
                const id = vuln.id || '';
                const sev = (vuln.database_specific && vuln.database_specific.severity) || 'MEDIUM';
                const normalized = sev.toUpperCase();
                const severity = ['HIGH', 'CRITICAL'].includes(normalized) ? 'HIGH' : normalized === 'LOW' ? 'LOW' : 'MEDIUM';
                const pkgName = (pkg.package && pkg.package.name) || 'unknown';
                const version = (pkg.package && pkg.package.version) || '';
                findings.push({
                    tool: 'osv-scanner',
                    severity,
                    confidence: 1.0,
                    category: 'dependency-vulnerability',
                    file: 'package.json',
                    line: 0,
                    message: `${id}: ${vuln.summary || ''} (${pkgName}@${version})`,
                    fingerprint: fingerprint('dependency-vulnerability', 'package.json', `${id}|${pkgName}|${version}`),
                });
            }
        }
    }

    return { skipped: false, findings, raw };
}

module.exports = { run };
