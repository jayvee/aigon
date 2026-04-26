'use strict';

const { checkRecurringFeatures, listRecurringStatus, getISOWeek, getISOQuarter } = require('../recurring');

function getRepoPath() {
    const utils = require('../utils');
    return utils.getMainRepoPath ? utils.getMainRepoPath(process.cwd()) : process.cwd();
}

function createRecurringCommands() {
    return {
        'recurring-run': (args) => {
            const repoPath = getRepoPath();
            console.log(`Running recurring feature check for ${repoPath}...`);
            const results = checkRecurringFeatures(repoPath);

            if (results.skipped === true) {
                console.log('⚠️  Check already running, skipped.');
                return;
            }
            if (results.error) {
                console.error(`❌ Recurring check failed: ${results.error}`);
                process.exitCode = 1;
                return;
            }

            console.log(`\n📅 Week: ${results.week}${results.quarter ? ` · Quarter: ${results.quarter}` : ''}`);
            console.log(`📋 Templates found: ${results.found}`);
            console.log(`✅ Created: ${results.created}`);

            if (results.skipped && results.skipped.length > 0) {
                console.log(`⏭️  Skipped: ${results.skipped.length}`);
                for (const s of results.skipped) {
                    console.log(`   • ${s.slug}: ${s.reason}`);
                }
            }

            if (results.due === 0) {
                console.log('\nNothing due this week.');
            }
        },

        'recurring-list': (args) => {
            const repoPath = getRepoPath();
            const items = listRecurringStatus(repoPath);

            if (items.length === 0) {
                console.log(`No recurring templates found in docs/specs/recurring/`);
                console.log(`Create a template with 'schedule: weekly' or 'schedule: quarterly' frontmatter to get started.`);
                return;
            }

            console.log(`\n📅 Recurring features (week ${getISOWeek()} · quarter ${getISOQuarter()})\n`);
            const COL1 = 30;
            const COL2 = 10;
            const COL3 = 12;
            const header = `${'Slug'.padEnd(COL1)} ${'Schedule'.padEnd(COL2)} ${'Last period'.padEnd(COL3)} Status`;
            console.log(header);
            console.log('-'.repeat(header.length));

            for (const item of items) {
                const status = item.isDue ? '🔴 DUE' : '✅ done';
                const lastPeriod = item.schedule === 'weekly'
                    ? (item.lastWeek || '—')
                    : (item.lastQuarter || '—');
                const row = `${item.recurringSlug.padEnd(COL1)} ${item.schedule.padEnd(COL2)} ${lastPeriod.padEnd(COL3)} ${status}`;
                console.log(row);
            }
            console.log('');
        },
    };
}

module.exports = { createRecurringCommands };
