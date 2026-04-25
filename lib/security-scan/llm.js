'use strict';

const { spawnSync } = require('child_process');
const { fingerprint } = require('./fingerprint');

function isAvailable() {
    const r = spawnSync('which', ['claude'], { encoding: 'utf8' });
    return r.status === 0;
}

// Normalise a raw LLM finding into the common finding shape.
function normaliseFinding(raw) {
    const severity = (raw.severity || raw.level || 'MEDIUM').toUpperCase();
    const file = raw.file || raw.path || '';
    const line = raw.line || raw.lineNumber || 0;
    const message = raw.message || raw.description || raw.finding || '';
    const category = raw.category || raw.type || raw.cwe || 'llm-finding';
    return {
        tool: 'claude-security-review',
        severity: ['HIGH', 'CRITICAL'].includes(severity) ? 'HIGH' : severity === 'LOW' ? 'LOW' : 'MEDIUM',
        confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.7,
        category,
        file,
        line,
        message,
        fingerprint: fingerprint(category, file, message),
    };
}

async function run(opts = {}) {
    if (opts.noLlm) {
        return { skipped: true, reason: '--no-llm flag set', findings: [], raw: '' };
    }

    if (!isAvailable()) {
        return { skipped: true, reason: 'claude CLI not found on PATH', findings: [], raw: '' };
    }

    const cwd = opts.cwd || process.cwd();
    const result = spawnSync(
        'claude',
        ['--print', '--output-format', 'json', '/security-review'],
        { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000 }
    );

    const raw = result.stdout || '';

    if (result.status !== 0 || !raw.trim()) {
        const stderr = result.stderr || '';
        return { skipped: true, reason: `claude exited ${result.status}: ${stderr.trim().slice(0, 200)}`, findings: [], raw };
    }

    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        return { skipped: true, reason: 'claude output was not valid JSON', findings: [], raw };
    }

    // /security-review returns an array of findings, or an object with a findings key
    const rawFindings = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.findings) ? parsed.findings : []);

    const findings = rawFindings.map(normaliseFinding);
    return { skipped: false, findings, raw };
}

module.exports = { run, isAvailable };
