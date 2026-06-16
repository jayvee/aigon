'use strict';

// F552: scoped doctor views — parse scope / detail flags from argv.

const SCOPE_FLAGS = {
    '--auth': 'auth',
    '--auth-only': 'auth',
    '--ports': 'ports',
};

const DETAIL_FLAGS = new Set(['--full', '--verbose', '-v']);

const KNOWN_DOCTOR_FLAGS = new Set([
    '--fix',
    '--yes',
    '-y',
    '--register',
    '--gc',
    '--rebuild-stats',
    '--reap-orphans',
    '--fix-templates',
    '--dry-run',
    ...Object.keys(SCOPE_FLAGS),
    ...DETAIL_FLAGS,
]);

function isKnownDoctorFlag(arg) {
    if (KNOWN_DOCTOR_FLAGS.has(arg)) return true;
    if (arg.startsWith('--min-age=')) return true;
    return false;
}

/**
 * Parse doctor argv for scope and detail flags.
 * @returns {{
 *   scope: 'auth'|'ports'|null,
 *   authOnly: boolean,
 *   full: boolean,
 *   verbose: boolean,
 *   unknownScopeFlags: string[],
 * }}
 */
function parseDoctorScopes(args = []) {
    let scope = null;
    let authOnly = false;
    let full = args.includes('--full');
    let verbose = args.includes('--verbose') || args.includes('-v');
    const unknownScopeFlags = [];

    for (const arg of args) {
        if (!arg.startsWith('-') || isKnownDoctorFlag(arg)) continue;
        // Unknown --flag: treat as typo scope unless it looks like a value-bearing option we missed.
        if (arg.startsWith('--')) {
            unknownScopeFlags.push(arg);
        }
    }

    if (args.includes('--auth') || args.includes('--auth-only')) {
        scope = 'auth';
        authOnly = true;
    } else if (args.includes('--ports')) {
        scope = 'ports';
        full = true; // ports scope always shows the full table
    }

    return { scope, authOnly, full, verbose, unknownScopeFlags };
}

/** Section ids included for each scope (null scope = all). */
function sectionInScope(sectionId, scope) {
    if (!scope) return true;
    if (scope === 'auth') return sectionId === 'agent-auth';
    if (scope === 'ports') return sectionId === 'port-health';
    return true;
}

function scopeUsageLine() {
    return 'Valid scope flags: --auth, --auth-only, --ports  |  Detail: --full (expand all sections), --verbose/-v (debug rows e.g. install paths)';
}

module.exports = {
    parseDoctorScopes,
    sectionInScope,
    scopeUsageLine,
};
