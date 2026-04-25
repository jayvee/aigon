'use strict';

const { spawnSync } = require('child_process');
const { fingerprint } = require('../fingerprint');

async function run(opts = {}) {
    const cwd = opts.cwd || process.cwd();
    const result = spawnSync(
        'npm',
        ['audit', '--omit=dev', '--audit-level=high', '--json'],
        { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }
    );

    const raw = result.stdout || '';
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        return { skipped: false, findings: [], raw };
    }

    const vulns = parsed && (parsed.vulnerabilities || (parsed.advisories ? Object.values(parsed.advisories) : []));
    if (!vulns) return { skipped: false, findings: [], raw };

    const findings = [];
    const entries = Array.isArray(vulns) ? vulns : Object.values(vulns);

    for (const v of entries) {
        const sev = (v.severity || '').toUpperCase();
        if (!['HIGH', 'CRITICAL'].includes(sev)) continue;

        const name = v.name || v.module_name || 'unknown';
        const via = Array.isArray(v.via)
            ? v.via.filter(x => typeof x === 'object').map(x => x.title || x.url || '').join('; ')
            : (typeof v.via === 'string' ? v.via : '');

        findings.push({
            tool: 'npm-audit',
            severity: sev === 'CRITICAL' ? 'HIGH' : 'HIGH',
            confidence: 1.0,
            category: 'dependency-vulnerability',
            file: 'package.json',
            line: 0,
            message: `${name}: ${via || v.url || ''}`,
            fingerprint: fingerprint('dependency-vulnerability', 'package.json', `${name}|${via}`),
        });
    }

    return { skipped: false, findings, raw };
}

module.exports = { run };
