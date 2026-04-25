'use strict';

const path = require('path');
const { parseCliOptions, getOptionValue } = require('../cli-parse');
const sk = require('../scheduled-kickoff');

function usage() {
    console.error(`Usage:
  aigon schedule add feature_autonomous <id> --run-at=<iso8601> <agents...> [options]
      Options: --stop-after= --eval-agent= --review-agent= --workflow= --models= --efforts=
               --review-model= --review-effort= --repo=<path>
  aigon schedule add research_start <id> --run-at=<iso8601> [agents...] [--background|--foreground]
      Options: --repo=<path>
  aigon schedule list [--all] [--repo=<path>]
  aigon schedule cancel <jobId> [--repo=<path>]

runAt must include an explicit timezone (e.g. 2026-04-26T01:10:00Z or 2026-04-26T01:10:00-07:00).
If the server is not running at runAt, the job stays pending until the next poll after the server starts
(catch-up: fires once when runAt <= now).`);
}

function createScheduleCommands() {
    return {
        schedule: async (args) => {
            const opts = parseCliOptions(args);
            const sub = String(opts._[0] || '').trim().toLowerCase();
            if (!sub || sub === '-h' || sub === '--help') {
                usage();
                process.exitCode = 1;
                return;
            }

            const repoOpt = getOptionValue(opts, 'repo');
            const repoRes = sk.resolveRepoForScheduleCli(repoOpt != null ? String(repoOpt) : '');
            if (!repoRes.ok) {
                console.error(`❌ ${repoRes.error}`);
                process.exitCode = 1;
                return;
            }
            const repoPath = repoRes.repoPath;

            if (sub === 'list') {
                const includeAll = getOptionValue(opts, 'all') !== undefined;
                const jobs = sk.listJobs(repoPath, { includeAll });
                if (jobs.length === 0) {
                    console.log(includeAll ? 'No scheduled jobs.' : 'No pending scheduled jobs.');
                    return;
                }
                for (const j of jobs) {
                    const err = j.error ? ` error=${JSON.stringify(String(j.error).slice(0, 120))}` : '';
                    console.log(`${j.jobId}  ${j.status.padEnd(10)}  ${j.kind}  #${j.entityId}  runAt=${j.runAt}${err}`);
                }
                return;
            }

            if (sub === 'cancel' || sub === 'rm') {
                const jobId = String(opts._[1] || '').trim();
                if (!jobId) {
                    usage();
                    process.exitCode = 1;
                    return;
                }
                const r = sk.cancelJob(repoPath, jobId);
                if (!r.ok) {
                    console.error(`❌ ${r.error}`);
                    process.exitCode = 1;
                    return;
                }
                if (r.noop) console.log(`Job ${jobId} already cancelled.`);
                else console.log(`Cancelled job ${jobId}.`);
                return;
            }

            if (sub !== 'add') {
                console.error(`❌ Unknown schedule subcommand: ${sub}`);
                usage();
                process.exitCode = 1;
                return;
            }

            const kindRaw = String(opts._[1] || '').trim();
            const kind = kindRaw === 'feature_autonomous' || kindRaw === 'feature-autonomous'
                ? 'feature_autonomous'
                : (kindRaw === 'research_start' || kindRaw === 'research-start' ? 'research_start' : '');
            const entityId = String(opts._[2] || '').trim();
            const runAtRaw = getOptionValue(opts, 'run-at');
            const runAt = runAtRaw != null ? String(runAtRaw).trim() : '';

            if (!kind || !entityId || !runAt) {
                usage();
                process.exitCode = 1;
                return;
            }

            if (kind === 'feature_autonomous') {
                const agents = opts._.slice(3).map(a => String(a).trim()).filter(Boolean);
                const payload = {
                    agents,
                    stopAfter: getOptionValue(opts, 'stop-after') != null ? String(getOptionValue(opts, 'stop-after')) : undefined,
                    evalAgent: getOptionValue(opts, 'eval-agent') != null ? String(getOptionValue(opts, 'eval-agent')) : undefined,
                    reviewAgent: getOptionValue(opts, 'review-agent') != null ? String(getOptionValue(opts, 'review-agent')) : undefined,
                    models: getOptionValue(opts, 'models') != null ? String(getOptionValue(opts, 'models')) : undefined,
                    efforts: getOptionValue(opts, 'efforts') != null ? String(getOptionValue(opts, 'efforts')) : undefined,
                    reviewModel: getOptionValue(opts, 'review-model') != null ? String(getOptionValue(opts, 'review-model')) : undefined,
                    reviewEffort: getOptionValue(opts, 'review-effort') != null ? String(getOptionValue(opts, 'review-effort')) : undefined,
                    workflow: getOptionValue(opts, 'workflow') != null ? String(getOptionValue(opts, 'workflow')) : undefined,
                };
                const r = sk.addJob(repoPath, { kind, entityId, runAt, payload });
                if (!r.ok) {
                    console.error(`❌ ${r.error}`);
                    process.exitCode = 1;
                    return;
                }
                console.log(`Scheduled ${kind} for feature #${entityId} at ${r.job.runAt}`);
                console.log(`  jobId: ${r.job.jobId}`);
                console.log(`  repo:  ${r.job.repoPath}`);
                return;
            }

            const agents = opts._.slice(3).map(a => String(a).trim()).filter(Boolean);
            const payload = {
                agents,
                background: getOptionValue(opts, 'background') !== undefined,
                foreground: getOptionValue(opts, 'foreground') !== undefined,
            };
            const r = sk.addJob(repoPath, { kind: 'research_start', entityId, runAt, payload });
            if (!r.ok) {
                console.error(`❌ ${r.error}`);
                process.exitCode = 1;
                return;
            }
            console.log(`Scheduled research_start for #${entityId} at ${r.job.runAt}`);
            console.log(`  jobId: ${r.job.jobId}`);
            console.log(`  repo:  ${path.resolve(r.job.repoPath)}`);
        },
    };
}

module.exports = { createScheduleCommands };
