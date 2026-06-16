'use strict';

// F552: consent-driven fix dispatch for `aigon doctor --fix`.

const readline = require('readline');

/**
 * @typedef {object} FixQueueItem
 * @property {string} section
 * @property {string} message
 * @property {string} label
 * @property {string} command
 * @property {() => void|Promise<void>} apply
 */

function formatPrompt(item) {
    const cmd = item.command ? `\n  Command: ${item.command}` : '';
    const label = item.label ? ` (${item.label})` : '';
    return `\n${item.message}${label}${cmd}\nApply this fix? [y/N] `;
}

function askYesNo(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(String(answer || '').trim().toLowerCase() === 'y');
        });
    });
}

/**
 * Run queued auto-fixes. Batch when yes=true; interactive y/N when TTY; otherwise list only.
 * @param {FixQueueItem[]} queue
 * @param {{ yes?: boolean, isTTY?: boolean, log?: Function }} opts
 */
async function runFixDispatch(queue, opts = {}) {
    const log = opts.log || console.log;
    const yes = opts.yes === true;
    const isTTY = opts.isTTY !== undefined ? opts.isTTY : !!(process.stdin.isTTY && process.stdout.isTTY);

    if (queue.length === 0) {
        return { applied: 0, skipped: 0, manual: 0 };
    }

    if (!yes && !isTTY) {
        log('\n─── Fixes (non-interactive) ' + '─'.repeat(32));
        log('stdin is not a TTY — auto-fixes were not applied.');
        log('Re-run in a terminal to confirm each fix, or pass --yes / -y to apply all:\n');
        for (const item of queue) {
            const cmd = item.command ? ` → ${item.command}` : '';
            log(`  • [${item.section}] ${item.message}${cmd}`);
        }
        log(`\n${queue.length} auto-fixable issue(s) pending.`);
        return { applied: 0, skipped: queue.length, manual: 0, nonInteractive: true };
    }

    let applied = 0;
    let skipped = 0;

    if (yes) {
        log('\n─── Applying fixes ' + '─'.repeat(38));
        for (const item of queue) {
            try {
                await item.apply();
                applied += 1;
            } catch (e) {
                log(`  ⚠️  Fix failed [${item.section}]: ${e.message}`);
                skipped += 1;
            }
        }
    } else {
        log('\n─── Interactive fixes ' + '─'.repeat(36));
        for (const item of queue) {
            const ok = await askYesNo(formatPrompt(item));
            if (ok) {
                try {
                    await item.apply();
                    applied += 1;
                } catch (e) {
                    log(`  ⚠️  Fix failed: ${e.message}`);
                    skipped += 1;
                }
            } else {
                skipped += 1;
            }
        }
    }

    return { applied, skipped, manual: 0 };
}

function printFixSummary(result, manualCount, log = console.log) {
    const { applied, skipped, manual } = result;
    const k = manualCount != null ? manualCount : manual;
    log(`\nFix summary: ${applied} applied, ${skipped} skipped, ${k} manual`);
}

function printManualIssues(issues, log = console.log) {
    const manual = issues.filter(i => i.fix && !i.fix.autoFixable);
    if (manual.length === 0) return;
    log('\n─── Manual steps ' + '─'.repeat(42));
    for (const i of manual) {
        const cmd = i.fix.command ? ` → ${i.fix.command}` : '';
        log(`  • [${i.section}] ${i.message}${cmd}`);
    }
}

module.exports = {
    runFixDispatch,
    printFixSummary,
    printManualIssues,
};
