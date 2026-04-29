'use strict';

const fs = require('fs');
const path = require('path');
const { readConductorReposFromGlobalConfig } = require('./config');
const { readSnapshotSync } = require('./workflow-core/entity-lifecycle');
const { getEventsPathForEntity } = require('./workflow-core/paths');
const { readTelemetryFile } = require('./telemetry');

/**
 * Parse log file frontmatter, including a YAML events array.
 * Returns { fields: {key: value}, events: [{ts, status}] }
 * NOTE: Read-only — kept for analytics migration (feature-backfill-timestamps).
 * New code should use lib/manifest.js for all state reads/writes.
 */
function parseLogFrontmatterFull(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return { fields: {}, events: [] };
    const block = m[1];
    const fields = {};
    const events = [];
    let inEvents = false;
    for (const line of block.split('\n')) {
        if (/^events:/.test(line)) { inEvents = true; continue; }
        if (inEvents) {
            if (line.startsWith('  - ')) {
                const tsMatch = line.match(/ts:\s*"([^"]+)"/);
                const statusMatch = line.match(/status:\s*(\w+)/);
                if (tsMatch && statusMatch) events.push({ ts: tsMatch[1], status: statusMatch[1] });
            } else if (line && !/^\s/.test(line)) {
                inEvents = false;
                const idx = line.indexOf(':');
                if (idx !== -1) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        } else {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            if (key) fields[key] = value;
        }
    }
    return { fields, events };
}

// serializeLogFrontmatter and updateLogFrontmatterInPlace removed —
// agent status now lives in .aigon/state/ JSON manifests via lib/manifest.js.

/**
 * Build series buckets for volume metrics.
 * Returns { daily: [{date, count}], weekly: [...], monthly: [...], quarterly: [...] }
 */
function buildCompletionSeries(allFeatures) {
    const now = new Date();
    function isoWeek(d) {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const y = t.getUTCFullYear();
        const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
        return `${y}-W${String(w).padStart(2, '0')}`;
    }
    function toDateKey(ts) {
        const d = new Date(ts);
        return d.toISOString().slice(0, 10);
    }
    function toMonthKey(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    function toQuarterKey(ts) {
        const d = new Date(ts);
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `${d.getFullYear()}-Q${q}`;
    }

    const daily = {}, weekly = {}, monthly = {}, quarterly = {};
    // Pre-populate last 30 days
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        daily[d.toISOString().slice(0, 10)] = 0;
    }
    // Pre-populate last 12 weeks
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 7 * 86400000);
        weekly[isoWeek(d)] = 0;
    }
    // Pre-populate last 12 months
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthly[toMonthKey(d)] = 0;
    }
    // Pre-populate last 8 quarters
    for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
        quarterly[toQuarterKey(d)] = 0;
    }

    allFeatures.forEach(f => {
        if (!f.completedTime) return;
        const ts = f.completedTime;
        const dk = toDateKey(ts);
        const wk = isoWeek(new Date(ts));
        const mk = toMonthKey(ts);
        const qk = toQuarterKey(ts);
        if (dk in daily) daily[dk]++;
        if (wk in weekly) weekly[wk]++;
        if (mk in monthly) monthly[mk]++;
        if (qk in quarterly) quarterly[qk]++;
    });

    return {
        daily: Object.entries(daily).map(([date, count]) => ({ date, count })),
        weekly: Object.entries(weekly).map(([week, count]) => ({ week, count })),
        monthly: Object.entries(monthly).map(([month, count]) => ({ month, count })),
        quarterly: Object.entries(quarterly).map(([quarter, count]) => ({ quarter, count }))
    };
}

/**
 * Build weekly autonomy trend from features.
 */
function buildWeeklyAutonomyTrend(allFeatures) {
    const byWeek = {};
    function isoWeek(d) {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const y = t.getUTCFullYear();
        const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
        return `${y}-W${String(w).padStart(2, '0')}`;
    }
    allFeatures.forEach(f => {
        if (!f.completedTime || f.autonomyRatio === null) return;
        const wk = isoWeek(new Date(f.completedTime));
        if (!byWeek[wk]) byWeek[wk] = { sum: 0, count: 0 };
        byWeek[wk].sum += f.autonomyRatio;
        byWeek[wk].count++;
    });
    return Object.entries(byWeek)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([week, { sum, count }]) => ({
            week,
            score: Math.round(sum / count * 100) / 100
        }));
}

/**
 * Collect analytics data across all registered repos.
 * Returns the analytics payload object.
 */
function collectAnalyticsData(globalConfig) {
    const repos = (globalConfig && Array.isArray(globalConfig.repos))
        ? globalConfig.repos
        : readConductorReposFromGlobalConfig();
    const now = new Date();
    const nowTs = now.getTime();
    const today = new Date(now.toDateString()).getTime();
    const d7 = nowTs - 7 * 24 * 60 * 60 * 1000;
    const d30 = nowTs - 30 * 24 * 60 * 60 * 1000;
    const d90 = nowTs - 90 * 24 * 60 * 60 * 1000;

    const analyticsConfig = (globalConfig && globalConfig.analytics) || {};
    const activeHours = analyticsConfig.activeHours || { start: 8, end: 23 };
    let timezone = analyticsConfig.timezone;
    if (!timezone) {
        try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { timezone = 'UTC'; }
    }

    let allFeatures = [];
    const allTelemetrySessions = [];
    const evalWins = {}; // agent -> { wins, evals }
    const evalWinsByRepo = []; // { repoPath, agent, wins, evals } — for per-repo filtering
    const parseNumberMaybe = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const num = typeof value === 'number' ? value : parseFloat(String(value).trim());
        return Number.isFinite(num) ? num : null;
    };
    const parseBooleanMaybe = (value) => {
        if (value === true || value === false) return value;
        if (value === null || value === undefined) return null;
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
        return null;
    };
    const parseAutonomyLabel = (value) => {
        if (value === null || value === undefined) return null;
        const label = String(value).trim();
        return label ? label : null;
    };
    const buildDailyMetricTrend = (features, metricKey, sinceTs) => {
        const buckets = {};
        features.forEach(f => {
            if (!inPeriod(f.completedTime, sinceTs)) return;
            const metric = f[metricKey];
            if (metric === null || metric === undefined) return;
            const day = new Date(f.completedTime).toISOString().slice(0, 10);
            if (!buckets[day]) buckets[day] = { sum: 0, count: 0 };
            buckets[day].sum += metric;
            buckets[day].count++;
        });
        return Object.keys(buckets).sort().map(day => ({
            day,
            score: Math.round((buckets[day].sum / buckets[day].count) * 1000) / 1000
        }));
    };
    const buildAutonomyBreakdown = (features) => {
        const labelCounts = {};
        features.forEach(f => {
            if (!f.autonomyLabel) return;
            labelCounts[f.autonomyLabel] = (labelCounts[f.autonomyLabel] || 0) + 1;
        });
        return Object.entries(labelCounts)
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    };
    const normalizeFeatureId = (value) => {
        if (value === null || value === undefined) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        if (/^\d+$/.test(raw)) return String(parseInt(raw, 10));
        return raw;
    };
    const readTelemetryRecords = (repoRoot) => {
        const telemetryDir = path.join(repoRoot, '.aigon', 'telemetry');
        const records = [];
        const byFeature = {};
        if (!fs.existsSync(telemetryDir)) return { records, byFeature };
        try {
            fs.readdirSync(telemetryDir)
                .filter(f => f.endsWith('.json') || f.endsWith('.json.gz'))
                .forEach(file => {
                    try {
                        const parsed = JSON.parse(readTelemetryFile(path.join(telemetryDir, file)));
                        const featureId = normalizeFeatureId(parsed.featureId);
                        if (!featureId) return;
                        const tokenUsage = parsed.tokenUsage || {};
                        const input = Number(tokenUsage.input || 0);
                        const output = Number(tokenUsage.output || 0);
                        const thinking = Number(tokenUsage.thinking || 0);
                        const billable = Number(tokenUsage.billable || (input + output + thinking));
                        const record = {
                            featureId,
                            agent: parsed.agent || 'unknown',
                            model: parsed.model || null,
                            activity: parsed.activity || null,
                            startAt: parsed.startAt || null,
                            endAt: parsed.endAt || null,
                            endTime: parsed.endAt ? new Date(parsed.endAt).getTime() : null,
                            costUsd: Number(parsed.costUsd || 0),
                            tokenUsage: {
                                input,
                                output,
                                thinking,
                                billable,
                            },
                        };
                        records.push(record);
                        if (!byFeature[featureId]) byFeature[featureId] = [];
                        byFeature[featureId].push(record);
                    } catch (e) { /* ignore bad telemetry file */ }
                });
        } catch (e) { /* ignore unreadable telemetry dir */ }
        return { records, byFeature };
    };
    const summarizeTelemetryForFeature = (records) => {
        if (!Array.isArray(records) || records.length === 0) return null;
        const costUsd = records.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0);
        const billableTokens = records.reduce((sum, r) => sum + (Number(r.tokenUsage && r.tokenUsage.billable) || 0), 0);
        return {
            sessions: records.length,
            costUsd: Math.round(costUsd * 10000) / 10000,
            billableTokens: Math.round(billableTokens),
        };
    };
    const aggregateTelemetryByAgent = (records) => {
        if (!Array.isArray(records) || records.length === 0) return null;
        const byAgent = {};
        records.forEach(r => {
            const agent = r.agent || 'unknown';
            if (!byAgent[agent]) byAgent[agent] = { billableTokens: 0, sessions: 0, costUsd: 0 };
            byAgent[agent].billableTokens += Number(r.tokenUsage && r.tokenUsage.billable || 0);
            byAgent[agent].sessions += 1;
            byAgent[agent].costUsd += Number(r.costUsd || 0);
        });
        // Round values
        Object.keys(byAgent).forEach(agent => {
            byAgent[agent].billableTokens = Math.round(byAgent[agent].billableTokens);
            byAgent[agent].costUsd = Math.round(byAgent[agent].costUsd * 10000) / 10000;
        });
        return byAgent;
    };

    repos.forEach(repoPath => {
        const absRepo = path.resolve(repoPath);
        const doneDir = path.join(absRepo, 'docs', 'specs', 'features', '05-done');
        const logsDir = path.join(absRepo, 'docs', 'specs', 'features', 'logs');
        const evalsDir = path.join(absRepo, 'docs', 'specs', 'features', 'evaluations');
        const telemetry = readTelemetryRecords(absRepo);
        telemetry.records.forEach(r => allTelemetrySessions.push({ ...r, repoPath: absRepo }));

        // Parse eval files for win rates
        if (fs.existsSync(evalsDir)) {
            try {
                const repoEvalMap = {}; // agent -> { wins, evals } for this repo
                fs.readdirSync(evalsDir)
                    .filter(f => f.endsWith('.md'))
                    .forEach(evalFile => {
                        try {
                            const content = fs.readFileSync(path.join(evalsDir, evalFile), 'utf8');
                            const participantMatches = content.match(/^- \[.?\] \*\*([a-z]{2})\*\*/gm) || [];
                            const participants = [...new Set(
                                participantMatches
                                    .map(m => { const mm = m.match(/\*\*([a-z]{2})\*\*/); return mm ? mm[1] : null; })
                                    .filter(Boolean)
                            )];
                            participants.forEach(a => {
                                if (!evalWins[a]) evalWins[a] = { wins: 0, evals: 0 };
                                evalWins[a].evals++;
                                if (!repoEvalMap[a]) repoEvalMap[a] = { wins: 0, evals: 0 };
                                repoEvalMap[a].evals++;
                            });
                            const winnerMatch = content.match(/\*\*Winner:\*\*\s*\*\*([a-z]{2})\b/mi);
                            if (winnerMatch) {
                                const winner = winnerMatch[1].toLowerCase();
                                if (!evalWins[winner]) evalWins[winner] = { wins: 0, evals: 0 };
                                evalWins[winner].wins++;
                                if (!repoEvalMap[winner]) repoEvalMap[winner] = { wins: 0, evals: 0 };
                                repoEvalMap[winner].wins++;
                            }
                        } catch (e) { /* ignore */ }
                    });
                Object.entries(repoEvalMap).forEach(([agent, data]) => {
                    evalWinsByRepo.push({ repoPath: absRepo, agent, wins: data.wins, evals: data.evals });
                });
            } catch (e) { /* ignore */ }
        }

        // Enumerate completed features (F397: engine-first, folder-fallback).
        // UNION of:
        //  - engine-done features: snapshot.lifecycle === 'done'  (truth)
        //  - legacy 05-done specs with no engine dir              (pre-engine)
        // Deduplicated by featureNum.
        const featuresWorkflowRoot = path.join(absRepo, '.aigon', 'workflows', 'features');
        const completed = new Map(); // featureNum -> { featureNum, desc, specPath }

        // 1. Engine-done snapshots
        try {
            if (fs.existsSync(featuresWorkflowRoot)) {
                fs.readdirSync(featuresWorkflowRoot)
                    .filter(d => /^\d+$/.test(d))
                    .forEach(idDir => {
                        const snapshot = readSnapshotSync(absRepo, 'feature', idDir);
                        if (!snapshot) return;
                        const lifecycle = String(snapshot.currentSpecState || snapshot.lifecycle || '').toLowerCase();
                        if (lifecycle !== 'done') return;
                        const featureNum = idDir;
                        // Try to find spec under 05-done first, then any other folder via spec path on snapshot.
                        let specFile = null;
                        let specDirResolved = doneDir;
                        if (fs.existsSync(doneDir)) {
                            try {
                                specFile = fs.readdirSync(doneDir).find(f => f.startsWith(`feature-${featureNum}-`) && f.endsWith('.md')) || null;
                            } catch (_) { /* ignore */ }
                        }
                        if (!specFile && snapshot.specPath) {
                            const abs = path.isAbsolute(snapshot.specPath) ? snapshot.specPath : path.resolve(absRepo, snapshot.specPath);
                            if (fs.existsSync(abs)) {
                                specFile = path.basename(abs);
                                specDirResolved = path.dirname(abs);
                            }
                        }
                        const descFromName = specFile ? (specFile.match(/^feature-\d+-(.+)\.md$/) || [, ''])[1] : '';
                        completed.set(featureNum, { featureNum, desc: descFromName || (snapshot.slug || ''), specFile, specDir: specDirResolved });
                    });
            }
        } catch (_) { /* ignore */ }

        // 2. Legacy 05-done scan — adds pre-engine done features whose IDs
        //    are not present in the engine workflow root.
        if (fs.existsSync(doneDir)) {
            try {
                fs.readdirSync(doneDir)
                    .filter(f => /^feature-\d+-.+\.md$/.test(f))
                    .forEach(specFile => {
                        const m = specFile.match(/^feature-(\d+)-(.+)\.md$/);
                        if (!m) return;
                        const featureNum = m[1];
                        if (completed.has(featureNum)) return; // engine snapshot wins
                        completed.set(featureNum, { featureNum, desc: m[2], specFile, specDir: doneDir });
                    });
            } catch (_) { /* ignore */ }
        }

        if (completed.size === 0) return;

        [...completed.values()].forEach(entry => {
            const featureNum = entry.featureNum;
            const desc = entry.desc;
            const specFile = entry.specFile;
            const resolvedSpecDir = entry.specDir;
            const telemetryRecordsForFeature = telemetry.byFeature[normalizeFeatureId(featureNum)] || [];
            const telemetrySummary = summarizeTelemetryForFeature(telemetryRecordsForFeature);
            const tokensByAgent = aggregateTelemetryByAgent(telemetryRecordsForFeature);

            // Find winner log from flat logs/ dir
            // Winner is determined by: manifest winner field > agent ID in filename > 'solo'
            let selectedLogPath = null;
            let legacyLogDate = null; // date extracted from legacy filename
            let winnerAgent = 'solo';
            let selectedLogContent = null;
            let selectedLogFrontmatter = { fields: {}, events: [] };

            // Try to read winner from manifest
            let manifestWinner = null;
            try {
                const manifestPath = path.join(absRepo, '.aigon', 'state', `feature-${featureNum}.json`);
                if (fs.existsSync(manifestPath)) {
                    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    if (m.winner) manifestWinner = m.winner;
                }
            } catch (e) { /* ignore */ }

            if (fs.existsSync(logsDir)) {
                try {
                    const allLogs = fs.readdirSync(logsDir)
                        .filter(f => f.startsWith(`feature-${featureNum}-`) && !fs.lstatSync(path.join(logsDir, f)).isDirectory());
                    const standardLogs = allLogs.filter(f => f.endsWith('-log.md'));
                    const legacyLogs = allLogs.filter(f => /\d{4}-\d{2}-\d{2}\.md$/.test(f));

                    // If manifest has a winner, prefer that agent's log
                    let chosen = null;
                    if (manifestWinner && manifestWinner !== 'solo') {
                        chosen = standardLogs.find(f => f.includes(`-${manifestWinner}-`))
                              || legacyLogs.find(f => f.includes(`-${manifestWinner}-`));
                    }
                    if (!chosen) {
                        chosen = standardLogs.length > 0 ? standardLogs[0]
                            : legacyLogs.length > 0 ? legacyLogs[0] : null;
                    }

                    if (chosen) {
                        selectedLogPath = path.join(logsDir, chosen);
                        winnerAgent = manifestWinner || (() => {
                            const agentMatch = chosen.match(/^feature-\d+-([a-z]{2})-.+-log\.md$/);
                            return agentMatch ? agentMatch[1] : 'solo';
                        })();
                        // For legacy filenames, extract date as completedAt fallback
                        const dateMatch = chosen.match(/(\d{4}-\d{2}-\d{2})\.md$/);
                        if (dateMatch) legacyLogDate = dateMatch[1] + 'T12:00:00.000Z';
                        try {
                            selectedLogContent = fs.readFileSync(selectedLogPath, 'utf8');
                            selectedLogFrontmatter = parseLogFrontmatterFull(selectedLogContent);
                        } catch (e) {
                            selectedLogContent = null;
                            selectedLogFrontmatter = { fields: {}, events: [] };
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            // Read timestamps: engine events > manifest events > log frontmatter > file mtime
            let startedAt = null;
            let completedAt = null;
            // 1. Engine event log (F397 fix #9): authoritative for completion time.
            try {
                const eventsPath = getEventsPathForEntity(absRepo, 'feature', featureNum);
                if (fs.existsSync(eventsPath)) {
                    const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
                    for (const line of lines) {
                        try {
                            const ev = JSON.parse(line);
                            if (!completedAt && ev.type === 'feature.closed' && ev.at) completedAt = ev.at;
                            if (!startedAt && (ev.type === 'feature.started' || ev.type === 'feature.implementation_started') && ev.at) startedAt = ev.at;
                        } catch (_) { /* skip malformed line */ }
                    }
                }
            } catch (_) { /* ignore */ }
            // 2. Legacy state manifest events
            try {
                const manifestPath = path.join(absRepo, '.aigon', 'state', `feature-${featureNum}.json`);
                if (fs.existsSync(manifestPath)) {
                    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    const events = m.events || [];
                    const started = events.find(e => e.type === 'stage-changed' && e.to === 'in-progress');
                    const closedEvent = events.find(e => e.type === 'stage-changed' && e.to === 'done');
                    if (!startedAt && started) startedAt = started.at;
                    if (!completedAt && closedEvent) completedAt = closedEvent.at;
                }
            } catch (e) { /* ignore */ }
            // 3. Legacy log frontmatter (for pre-manifest features)
            if ((!startedAt || !completedAt) && selectedLogPath) {
                try {
                    const fmFields = selectedLogFrontmatter.fields;
                    if (!startedAt && fmFields.startedAt) startedAt = fmFields.startedAt;
                    if (!completedAt && fmFields.completedAt) completedAt = fmFields.completedAt;
                } catch (e) { /* ignore */ }
            }
            // 4. Legacy log filename date
            if (!completedAt && legacyLogDate) completedAt = legacyLogDate;
            // 5. File mtime (last resort) — only when a spec file is on disk.
            if (!completedAt && specFile && resolvedSpecDir) {
                try { completedAt = new Date(fs.statSync(path.join(resolvedSpecDir, specFile)).mtime).toISOString(); } catch (e) { /* ignore */ }
            }
            if (!startedAt && selectedLogPath) {
                try { startedAt = new Date(fs.statSync(selectedLogPath).mtime).toISOString(); } catch (e) { /* ignore */ }
            }

            const completedTime = completedAt ? new Date(completedAt).getTime() : null;
            const startedTime = startedAt ? new Date(startedAt).getTime() : null;
            const durationMs = (startedTime && completedTime && completedTime > startedTime)
                ? completedTime - startedTime : null;

            // Check autonomous flag in log content
            let autonomousMode = false;
            if (selectedLogContent) {
                try {
                    autonomousMode = /--(iterate|autonomous)/.test(selectedLogContent);
                } catch (e) { /* ignore */ }
            }

            // Calculate autonomy from events (manifest events or legacy frontmatter)
            let fmEvents = [];
            try {
                const manifestPath = path.join(absRepo, '.aigon', 'state', `feature-${featureNum}.json`);
                if (fs.existsSync(manifestPath)) {
                    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    fmEvents = (m.events || []).filter(e => e.type === 'status-changed').map(e => ({ ts: e.at, status: e.status }));
                }
            } catch (e) { /* ignore */ }
            if (fmEvents.length === 0 && selectedLogPath) {
                try {
                    fmEvents = selectedLogFrontmatter.events;
                } catch (e) { /* ignore */ }
            }

            let waitCount = 0;
            let totalWaitMs = 0;
            let wallTimeMs = null;
            let firstPassSuccess = null;

            if (fmEvents.length >= 2) {
                const firstImpl = fmEvents.find(e => e.status === 'implementing');
                const lastSubmit = [...fmEvents].reverse().find(e => e.status === 'submitted');
                if (firstImpl && lastSubmit) {
                    wallTimeMs = new Date(lastSubmit.ts).getTime() - new Date(firstImpl.ts).getTime();
                }
                for (let i = 0; i < fmEvents.length - 1; i++) {
                    if (fmEvents[i].status === 'waiting') {
                        waitCount++;
                        const nextImpl = fmEvents.slice(i + 1).find(e => e.status === 'implementing');
                        if (nextImpl) {
                            totalWaitMs += new Date(nextImpl.ts).getTime() - new Date(fmEvents[i].ts).getTime();
                        }
                    }
                }
                firstPassSuccess = !fmEvents.some(e => e.status === 'waiting');
            }

            const autonomyRatio = (wallTimeMs && wallTimeMs > 0)
                ? Math.max(0, Math.min(1, 1 - totalWaitMs / wallTimeMs))
                : null;

            // Check cycleTimeExclude from legacy frontmatter (old features) or manifest
            let cycleTimeExclude = false;
            if (selectedLogPath) {
                try {
                    const logFm = selectedLogFrontmatter.fields;
                    cycleTimeExclude = logFm.cycleTimeExclude === 'true' || logFm.cycleTimeExclude === true;
                } catch (e) { /* ignore */ }
            }
            const logFm = selectedLogFrontmatter.fields || {};
            const costUsd = parseNumberMaybe(logFm.cost_usd);
            const tokensPerLineChanged = parseNumberMaybe(logFm.tokens_per_line_changed);
            const inputTokens = parseNumberMaybe(logFm.input_tokens);
            const outputTokens = parseNumberMaybe(logFm.output_tokens);
            const thinkingTokens = parseNumberMaybe(logFm.thinking_tokens);
            const billableTokensFromLog = (inputTokens !== null || outputTokens !== null)
                ? (inputTokens || 0) + (outputTokens || 0) + (thinkingTokens || 0)
                : null;
            const costUsdEffective = costUsd !== null ? costUsd : (telemetrySummary ? telemetrySummary.costUsd : null);
            const billableTokens = billableTokensFromLog !== null
                ? billableTokensFromLog
                : (telemetrySummary ? telemetrySummary.billableTokens : null);
            const autonomyLabel = parseAutonomyLabel(logFm.autonomy_label);
            const reworkThrashing = parseBooleanMaybe(logFm.rework_thrashing);
            const reworkFixCascade = parseBooleanMaybe(logFm.rework_fix_cascade);
            const reworkScopeCreep = parseBooleanMaybe(logFm.rework_scope_creep);
            const hasReworkSignals = [reworkThrashing, reworkFixCascade, reworkScopeCreep].some(v => v !== null);
            const hasReworkFlags = [reworkThrashing, reworkFixCascade, reworkScopeCreep].some(v => v === true);
            const firstPassNoRework = hasReworkSignals ? !hasReworkFlags : null;
            const hasAadeData = [costUsdEffective, tokensPerLineChanged, autonomyLabel].some(v => v !== null) || hasReworkSignals;

            allFeatures.push({
                repoPath: absRepo,
                featureNum,
                desc,
                winnerAgent,
                completedAt,
                startedAt,
                completedTime,
                startedTime,
                durationMs,
                wallTimeMs,
                totalWaitMs,
                waitCount,
                firstPassSuccess,
                autonomousMode,
                autonomyRatio,
                cycleTimeExclude,
                costUsd: costUsdEffective,
                tokensPerLineChanged,
                billableTokens,
                autonomyLabel,
                reworkThrashing,
                reworkFixCascade,
                reworkScopeCreep,
                hasReworkFlags,
                firstPassNoRework,
                hasAadeData,
                tokensByAgent
            });
        });
    });

    // Deduplicate: if the same repo+featureNum appears multiple times (e.g. seed-reset),
    // keep only the most recent completion
    const dedupeMap = new Map();
    allFeatures.forEach(f => {
        const key = `${f.repoPath}:${f.featureNum}`;
        const existing = dedupeMap.get(key);
        if (!existing || (f.completedTime || 0) > (existing.completedTime || 0)) {
            dedupeMap.set(key, f);
        }
    });
    allFeatures = [...dedupeMap.values()];

    const inPeriod = (ts, since) => ts !== null && ts !== undefined && ts >= since;
    const f7d = allFeatures.filter(f => inPeriod(f.completedTime, d7));
    const f30d = allFeatures.filter(f => inPeriod(f.completedTime, d30));
    const f90d = allFeatures.filter(f => inPeriod(f.completedTime, d90));
    const fToday = allFeatures.filter(f => inPeriod(f.completedTime, today));

    // Volume
    const series = buildCompletionSeries(allFeatures);
    const volume = {
        completedToday: fToday.length,
        completed7d: f7d.length,
        completed30d: f30d.length,
        completed90d: f90d.length,
        series
    };

    // Compute trend indicators (30d vs prior 30d)
    const d60 = nowTs - 60 * 24 * 60 * 60 * 1000;
    const prior30d = allFeatures.filter(f => inPeriod(f.completedTime, d60) && !inPeriod(f.completedTime, d30));
    volume.trend30d = prior30d.length > 0
        ? Math.round(((f30d.length - prior30d.length) / prior30d.length) * 100)
        : null;

    // Autonomy
    const featWithAutonomy = f30d.filter(f => f.autonomyRatio !== null);
    const autonomyScore = featWithAutonomy.length > 0
        ? featWithAutonomy.reduce((s, f) => s + f.autonomyRatio, 0) / featWithAutonomy.length
        : null;
    const featWithWaits = f30d.filter(f => f.wallTimeMs !== null);
    const avgWaitEvents = featWithWaits.length > 0
        ? featWithWaits.reduce((s, f) => s + f.waitCount, 0) / featWithWaits.length
        : null;
    const featWithFirstPass = f30d.filter(f => f.firstPassSuccess !== null);
    const firstPassSuccessRate = featWithFirstPass.length > 0
        ? featWithFirstPass.filter(f => f.firstPassSuccess).length / featWithFirstPass.length
        : null;
    const autonomousModeAdoption = f30d.length > 0
        ? f30d.filter(f => f.autonomousMode).length / f30d.length
        : null;
    const featWithTouchTime = f30d.filter(f => f.wallTimeMs && f.wallTimeMs > 0);
    const avgTouchTimeRatio = featWithTouchTime.length > 0
        ? featWithTouchTime.reduce((s, f) => s + (f.totalWaitMs / f.wallTimeMs), 0) / featWithTouchTime.length
        : null;
    const weeklyTrend = buildWeeklyAutonomyTrend(allFeatures);

    const autonomy = {
        score: autonomyScore !== null ? Math.round(autonomyScore * 100) / 100 : null,
        avgWaitEventsPerFeature: avgWaitEvents !== null ? Math.round(avgWaitEvents * 10) / 10 : null,
        autonomousModeAdoption: autonomousModeAdoption !== null ? Math.round(autonomousModeAdoption * 100) / 100 : null,
        firstPassSuccessRate: firstPassSuccessRate !== null ? Math.round(firstPassSuccessRate * 100) / 100 : null,
        avgTouchTimeRatio: avgTouchTimeRatio !== null ? Math.round(avgTouchTimeRatio * 100) / 100 : null,
        overnightCommitPct: null,
        trend: weeklyTrend
    };

    // Insights metrics (quality, cost, token series for Pro Insights tab + Reports embed)
    const featWithAade = allFeatures.filter(f => f.hasAadeData);
    const featWithCost30d = f30d.filter(f => f.costUsd !== null);
    const tplFeatures30d = f30d.filter(f => f.tokensPerLineChanged !== null);
    const featWithRework30d = f30d.filter(f => f.firstPassNoRework !== null);
    const firstPassRateNoRework = featWithRework30d.length > 0
        ? featWithRework30d.filter(f => f.firstPassNoRework).length / featWithRework30d.length
        : null;
    const reworkRate30d = featWithRework30d.length > 0
        ? featWithRework30d.filter(f => f.hasReworkFlags).length / featWithRework30d.length
        : null;
    const avgCost30d = featWithCost30d.length > 0
        ? featWithCost30d.reduce((sum, f) => sum + f.costUsd, 0) / featWithCost30d.length
        : null;
    const avgTokensPerLine30d = tplFeatures30d.length > 0
        ? tplFeatures30d.reduce((sum, f) => sum + f.tokensPerLineChanged, 0) / tplFeatures30d.length
        : null;
    const costTrend7d = buildDailyMetricTrend(allFeatures, 'costUsd', d7);
    const costTrend30d = buildDailyMetricTrend(allFeatures, 'costUsd', d30);
    const tplTrend7d = buildDailyMetricTrend(allFeatures, 'tokensPerLineChanged', d7);
    const tplTrend30d = buildDailyMetricTrend(allFeatures, 'tokensPerLineChanged', d30);
    const recentCostCards = allFeatures
        .filter(f => f.costUsd !== null)
        .sort((a, b) => (b.completedTime || 0) - (a.completedTime || 0))
        .slice(0, 8)
        .map(f => ({
            featureNum: f.featureNum,
            desc: f.desc,
            repoPath: f.repoPath,
            costUsd: Math.round(f.costUsd * 10000) / 10000,
            autonomyLabel: f.autonomyLabel,
            hasReworkFlags: f.hasReworkFlags
        }));
    const autonomyBreakdown30d = buildAutonomyBreakdown(f30d);
    const autonomyBreakdownAll = buildAutonomyBreakdown(allFeatures);
    const insightsMetrics = {
        featuresWithAadeData: featWithAade.length,
        firstPassRateNoRework: firstPassRateNoRework !== null ? Math.round(firstPassRateNoRework * 100) / 100 : null,
        reworkRate30d: reworkRate30d !== null ? Math.round(reworkRate30d * 100) / 100 : null,
        avgCostUsd30d: avgCost30d !== null ? Math.round(avgCost30d * 10000) / 10000 : null,
        avgTokensPerLineChanged30d: avgTokensPerLine30d !== null ? Math.round(avgTokensPerLine30d * 1000) / 1000 : null,
        trends: {
            costPerFeature: {
                d7: costTrend7d,
                d30: costTrend30d
            },
            tokensPerLineChanged: {
                d7: tplTrend7d,
                d30: tplTrend30d
            }
        },
        autonomyLabels: {
            d30: autonomyBreakdown30d,
            allTime: autonomyBreakdownAll
        },
        recentCostCards
    };
    const telemetryAgent30d = {};
    allTelemetrySessions.forEach(s => {
        if (!inPeriod(s.endTime, d30)) return;
        const agent = s.agent || 'unknown';
        if (!telemetryAgent30d[agent]) telemetryAgent30d[agent] = { sessions: 0, costUsd: 0, billableTokens: 0 };
        telemetryAgent30d[agent].sessions += 1;
        telemetryAgent30d[agent].costUsd += Number(s.costUsd || 0);
        telemetryAgent30d[agent].billableTokens += Number(s.tokenUsage && s.tokenUsage.billable || 0);
    });
    insightsMetrics.crossAgentCost30d = Object.entries(telemetryAgent30d)
        .map(([agent, data]) => ({
            agent,
            sessions: data.sessions,
            costUsd: Math.round(data.costUsd * 10000) / 10000,
            billableTokens: Math.round(data.billableTokens),
        }))
        .sort((a, b) => b.costUsd - a.costUsd);

    // Token usage by agent over time (for stacked bar chart)
    // Bucket telemetry sessions by day and agent
    const tokensByAgentTimeSeries = (() => {
        const buckets = {}; // { day: { agent: billableTokens } }
        allTelemetrySessions.forEach(s => {
            if (!s.endTime) return;
            const day = new Date(s.endTime).toISOString().slice(0, 10);
            const agent = s.agent || 'unknown';
            if (!buckets[day]) buckets[day] = {};
            if (!buckets[day][agent]) buckets[day][agent] = 0;
            buckets[day][agent] += Number(s.tokenUsage && s.tokenUsage.billable || 0);
        });
        return Object.keys(buckets).sort().map(day => ({
            day,
            agents: buckets[day]
        }));
    })();
    insightsMetrics.tokensByAgentTimeSeries = tokensByAgentTimeSeries;

    // Token usage by agent:activity over time (for stacked area chart)
    // Each entry: { day, series: { 'cc:implement': N, 'gg:implement': N, 'cc:eval': N, ... }, models: { 'cc:implement': 'claude-opus-4-6', ... } }
    const tokensByActivityTimeSeries = (() => {
        const buckets = {}; // { day: { seriesKey: billableTokens } }
        const modelCounts = {}; // { seriesKey: { model: count } }
        const featuresWithActivity = new Set();
        allTelemetrySessions.forEach(s => {
            if (!s.endTime) return;
            const day = new Date(s.endTime).toISOString().slice(0, 10);
            const agent = s.agent || 'unknown';
            const seriesKey = s.activity ? `${agent}:${s.activity}` : agent;
            if (s.activity && s.featureId) featuresWithActivity.add(s.featureId);
            if (!buckets[day]) buckets[day] = {};
            if (!buckets[day][seriesKey]) buckets[day][seriesKey] = 0;
            buckets[day][seriesKey] += Number(s.tokenUsage && s.tokenUsage.billable || 0);
            // Track most common model per seriesKey
            if (s.model) {
                if (!modelCounts[seriesKey]) modelCounts[seriesKey] = {};
                modelCounts[seriesKey][s.model] = (modelCounts[seriesKey][s.model] || 0) + 1;
            }
        });
        // Derive dominant model per seriesKey
        const seriesModels = {};
        Object.entries(modelCounts).forEach(([key, counts]) => {
            let best = null, bestN = 0;
            Object.entries(counts).forEach(([model, n]) => { if (n > bestN) { best = model; bestN = n; } });
            if (best) seriesModels[key] = best;
        });
        return {
            points: Object.keys(buckets).sort().map(day => ({ day, series: buckets[day] })),
            seriesModels,
            featuresWithActivity: featuresWithActivity.size,
        };
    })();
    insightsMetrics.tokensByActivityTimeSeries = tokensByActivityTimeSeries;

    // Agent efficiency summary (median tokens, median cost per agent across all features)
    const agentEfficiency = (() => {
        const agentFeatureMap = {}; // agent -> [{ billableTokens, costUsd }]
        allFeatures.forEach(f => {
            if (!f.tokensByAgent) return;
            Object.entries(f.tokensByAgent).forEach(([agent, data]) => {
                if (!agentFeatureMap[agent]) agentFeatureMap[agent] = [];
                agentFeatureMap[agent].push({
                    billableTokens: data.billableTokens || 0,
                    costUsd: data.costUsd || 0,
                    tokensPerLineChanged: f.tokensPerLineChanged,
                });
            });
        });
        const median = (arr) => {
            if (arr.length === 0) return null;
            const sorted = arr.slice().sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };
        return Object.entries(agentFeatureMap).map(([agent, features]) => ({
            agent,
            features: features.length,
            medianTokens: Math.round(median(features.map(f => f.billableTokens)) || 0),
            medianCost: Math.round((median(features.map(f => f.costUsd)) || 0) * 10000) / 10000,
            medianTokensPerLine: (() => {
                const tplVals = features.map(f => f.tokensPerLineChanged).filter(v => v !== null && v !== undefined);
                const m = median(tplVals);
                return m !== null ? Math.round(m * 100) / 100 : null;
            })(),
        })).sort((a, b) => b.features - a.features);
    })();
    insightsMetrics.agentEfficiency = agentEfficiency;

    // Quality
    const featWithDuration = f30d.filter(f => f.durationMs !== null && f.durationMs > 0 && !f.cycleTimeExclude);
    const durHours = featWithDuration.map(f => f.durationMs / (1000 * 3600)).sort((a, b) => a - b);
    const round1 = v => Math.round(v * 10) / 10;
    const durMid = Math.floor(durHours.length / 2);
    const quality = {
        durationHours: {
            average: durHours.length > 0 ? round1(durHours.reduce((s, v) => s + v, 0) / durHours.length) : null,
            median: durHours.length > 0 ? round1(durHours.length % 2 ? durHours[durMid] : (durHours[durMid - 1] + durHours[durMid]) / 2) : null,
            max: durHours.length > 0 ? round1(durHours[durHours.length - 1]) : null
        },
        avgIterationsPerFeature: avgWaitEvents !== null ? round1(1 + avgWaitEvents / 2) : null,
        cycleTrend: []
    };

    // Agent performance
    const agentMap = {};
    allFeatures.forEach(f => {
        const agent = f.winnerAgent || 'solo';
        if (!agentMap[agent]) agentMap[agent] = [];
        agentMap[agent].push(f);
    });
    const agents = Object.entries(agentMap).map(([agent, feats]) => {
        const recent = feats.filter(f => inPeriod(f.completedTime, d30));
        const withAutonomy = feats.filter(f => f.autonomyRatio !== null);
        const agentAutonomy = withAutonomy.length > 0
            ? withAutonomy.reduce((s, f) => s + f.autonomyRatio, 0) / withAutonomy.length : null;
        const withFP = feats.filter(f => f.firstPassSuccess !== null);
        const agentFP = withFP.length > 0
            ? withFP.filter(f => f.firstPassSuccess).length / withFP.length : null;
        const withDur = feats.filter(f => f.durationMs !== null && f.durationMs > 0 && !f.cycleTimeExclude);
        const agentDurSorted = withDur.map(f => f.durationMs / (1000 * 3600)).sort((a, b) => a - b);
        const agentMid = Math.floor(agentDurSorted.length / 2);
        const agentCycle = agentDurSorted.length > 0
            ? (agentDurSorted.length % 2 ? agentDurSorted[agentMid] : (agentDurSorted[agentMid - 1] + agentDurSorted[agentMid]) / 2) : null;
        return {
            agent,
            completed: feats.length,
            completed30d: recent.length,
            autonomyScore: agentAutonomy !== null ? Math.round(agentAutonomy * 100) / 100 : null,
            firstPassRate: agentFP !== null ? Math.round(agentFP * 100) / 100 : null,
            avgCycleHours: agentCycle !== null ? round1(agentCycle) : null
        };
    }).sort((a, b) => b.completed - a.completed);

    // Eval wins
    const evalWinsArray = Object.entries(evalWins)
        .map(([agent, data]) => ({
            agent,
            wins: data.wins,
            evals: data.evals,
            winRate: data.evals > 0 ? Math.round(data.wins / data.evals * 100) / 100 : 0
        }))
        .sort((a, b) => b.wins - a.wins);

    return {
        generatedAt: new Date().toISOString(),
        config: { activeHours, timezone },
        volume,
        autonomy,
        quality,
        insightsMetrics,
        costByAgent: insightsMetrics.crossAgentCost30d,
        agents,
        evalWins: evalWinsArray,
        evalWinsByRepo,
        features: allFeatures.map(f => ({
            featureNum: f.featureNum,
            desc: f.desc,
            repoPath: f.repoPath,
            winnerAgent: f.winnerAgent,
            completedAt: f.completedAt,
            startedAt: f.startedAt,
            durationMs: f.durationMs,
            waitCount: f.waitCount,
            firstPassSuccess: f.firstPassSuccess,
            autonomousMode: f.autonomousMode,
            autonomyRatio: f.autonomyRatio,
            cycleTimeExclude: f.cycleTimeExclude || false,
            costUsd: f.costUsd,
            tokensPerLineChanged: f.tokensPerLineChanged,
            billableTokens: f.billableTokens,
            autonomyLabel: f.autonomyLabel,
            reworkThrashing: f.reworkThrashing,
            reworkFixCascade: f.reworkFixCascade,
            reworkScopeCreep: f.reworkScopeCreep,
            hasReworkFlags: f.hasReworkFlags,
            firstPassNoRework: f.firstPassNoRework,
            hasAadeData: f.hasAadeData,
            tokensByAgent: f.tokensByAgent || null
        }))
    };
}

module.exports = {
    parseLogFrontmatterFull,
    buildCompletionSeries,
    buildWeeklyAutonomyTrend,
    collectAnalyticsData,
};
