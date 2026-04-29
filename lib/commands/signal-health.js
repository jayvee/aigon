'use strict';

const {
    readSignalEvents,
    summarizeSignalEvents,
} = require('../signal-health');
const { parseCliOptions, getOptionValue } = require('../cli-parse');

function printTable(rows, since) {
    console.log(`Signal-health summary since ${since.toISOString().slice(0, 10)}`);
    if (rows.length === 0) {
        console.log('  No signal-health events recorded.');
        return;
    }
    console.log('Agent  Reliability  Emitted  Missed  Nudge  User  Abandoned  Out-of-order');
    rows.forEach(row => {
        console.log([
            row.agent.padEnd(5),
            `${row.reliability.toFixed(1)}%`.padStart(11),
            String(row.emitted).padStart(7),
            String(row.missed).padStart(6),
            String(row.recoveredViaNudge).padStart(5),
            String(row.recoveredViaUser).padStart(4),
            String(row.abandoned).padStart(9),
            String(row.outOfOrder).padStart(12),
        ].join('  '));
    });
}

function createSignalHealthCommands() {
    return {
        'signal-health': (args = []) => {
            const options = parseCliOptions(args);
            const sinceRaw = getOptionValue(options, 'since');
            const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            if (Number.isNaN(since.getTime())) {
                console.error(`❌ Invalid --since date: ${sinceRaw}`);
                process.exitCode = 1;
                return;
            }
            const events = readSignalEvents({
                since,
                agent: getOptionValue(options, 'agent') || null,
                entityType: getOptionValue(options, 'entity-type') || null,
            });
            const summary = summarizeSignalEvents(events);
            if (options.json) {
                console.log(JSON.stringify({ since: since.toISOString(), events: events.length, summary }, null, 2));
                return;
            }
            printTable(summary, since);
        },
    };
}

module.exports = {
    createSignalHealthCommands,
};
