'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_RELATIVE_PATH = path.join('.aigon', 'insights-cache.json');
const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_COST_CAP_USD = 0.10;

function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function parseYamlScalar(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        return value.slice(1, -1);
    }
    return value;
}

function parseFrontMatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return {};
    const data = {};
    match[1].split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key) return;
        data[key] = parseYamlScalar(value);
    });
    return data;
}

function resolveFeatureTimestamp(specPath, frontMatter) {
    if (frontMatter && frontMatter.completedAt) {
        const ts = Date.parse(frontMatter.completedAt);
        if (!Number.isNaN(ts)) return ts;
    }
    try {
        return fs.statSync(specPath).mtime.getTime();
    } catch (_) {
        return 0;
    }
}

function readFeatureFrontMatter(logPath) {
    if (!logPath || !fs.existsSync(logPath)) return {};
    try {
        return parseFrontMatter(fs.readFileSync(logPath, 'utf8'));
    } catch (_) {
        return {};
    }
}

function resolveFeatureLogPath({ logsDir, featureId, winnerAgent }) {
    if (!fs.existsSync(logsDir)) return null;
    const files = fs.readdirSync(logsDir)
        .filter(f => f.startsWith(`feature-${featureId}-`) && f.endsWith('-log.md'))
        .sort();
    if (files.length === 0) return null;
    if (winnerAgent) {
        const preferred = files.find(f => f.includes(`-${winnerAgent}-`));
        if (preferred) return path.join(logsDir, preferred);
    }
    return path.join(logsDir, files[0]);
}

function readManifestWinner(repoPath, featureId) {
    const manifestPath = path.join(repoPath, '.aigon', 'state', `feature-${featureId}.json`);
    if (!fs.existsSync(manifestPath)) return null;
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return manifest.winner || null;
    } catch (_) {
        return null;
    }
}

function collectAadeFeatures(repoPath = process.cwd()) {
    const doneDir = path.join(repoPath, 'docs', 'specs', 'features', '05-done');
    const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
    if (!fs.existsSync(doneDir)) return [];

    const specs = fs.readdirSync(doneDir)
        .filter(f => /^feature-\d+-.+\.md$/.test(f))
        .sort();

    const features = specs.map(specFile => {
        const match = specFile.match(/^feature-(\d+)-(.+)\.md$/);
        if (!match) return null;

        const featureId = match[1];
        const name = match[2];
        const winnerAgent = readManifestWinner(repoPath, featureId);
        const logPath = resolveFeatureLogPath({ logsDir, featureId, winnerAgent });
        const fm = readFeatureFrontMatter(logPath);
        const completedAtMs = resolveFeatureTimestamp(path.join(doneDir, specFile), fm);

        const reworkThrashing = fm.rework_thrashing === true;
        const reworkFixCascade = fm.rework_fix_cascade === true;
        const reworkScopeCreep = fm.rework_scope_creep === true;

        return {
            featureId,
            name,
            completedAtMs,
            costUsd: toNumber(fm.cost_usd),
            tokensPerLineChanged: toNumber(fm.tokens_per_line_changed),
            totalTokens: toNumber(fm.total_tokens),
            linesChanged: toNumber(fm.lines_changed),
            autonomyLabel: fm.autonomy_label ? String(fm.autonomy_label) : null,
            reworkThrashing,
            reworkFixCascade,
            reworkScopeCreep,
            hasRework: reworkThrashing || reworkFixCascade || reworkScopeCreep,
        };
    }).filter(Boolean);

    return features.sort((a, b) => a.completedAtMs - b.completedAtMs);
}

function movingTrend(values) {
    if (!values || values.length < 3) return null;
    const midpoint = Math.floor(values.length / 2);
    const older = values.slice(0, midpoint);
    const recent = values.slice(midpoint);
    if (older.length === 0 || recent.length === 0) return null;

    const olderAvg = older.reduce((sum, v) => sum + v, 0) / older.length;
    const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    if (olderAvg === 0) return null;

    const deltaPct = ((recentAvg - olderAvg) / olderAvg) * 100;
    return {
        direction: deltaPct > 5 ? 'up' : (deltaPct < -5 ? 'down' : 'flat'),
        deltaPct,
        olderAvg,
        recentAvg,
    };
}

function formatSignedPct(value) {
    const rounded = Math.round(value);
    if (rounded > 0) return `+${rounded}%`;
    return `${rounded}%`;
}

function computeOutliers(features) {
    const withCost = features.filter(f => f.costUsd !== null);
    const withTokens = features.filter(f => f.totalTokens !== null);

    const avgCost = withCost.length > 0
        ? withCost.reduce((sum, f) => sum + f.costUsd, 0) / withCost.length
        : null;
    const avgTokens = withTokens.length > 0
        ? withTokens.reduce((sum, f) => sum + f.totalTokens, 0) / withTokens.length
        : null;

    const outliers = [];
    features.forEach(feature => {
        if (avgCost && feature.costUsd !== null && feature.costUsd >= avgCost * 3) {
            outliers.push({ featureId: feature.featureId, name: feature.name, metric: 'cost', value: feature.costUsd, baseline: avgCost });
        }
        if (avgTokens && feature.totalTokens !== null && feature.totalTokens >= avgTokens * 3) {
            outliers.push({ featureId: feature.featureId, name: feature.name, metric: 'tokens', value: feature.totalTokens, baseline: avgTokens });
        }
    });

    return { outliers, avgCost, avgTokens };
}

function buildDeterministicInsights(features) {
    const totalFeatures = features.length;
    if (totalFeatures < 3) {
        return {
            generatedAt: new Date().toISOString(),
            insufficientData: true,
            observations: [],
            summary: `Not enough data for insights yet (${totalFeatures}/3 completed features).`,
            aggregates: { totalFeatures },
        };
    }

    const recent = features.slice(-5);

    const costValues = recent.map(f => f.costUsd).filter(v => v !== null);
    const costTrend = movingTrend(costValues);

    const efficiencyValues = recent.map(f => f.tokensPerLineChanged).filter(v => v !== null);
    const efficiencyTrend = movingTrend(efficiencyValues);

    const featuresWithReworkSignals = features.filter(f => (
        f.reworkThrashing === true || f.reworkFixCascade === true || f.reworkScopeCreep === true ||
        f.reworkThrashing === false || f.reworkFixCascade === false || f.reworkScopeCreep === false
    ));
    const reworkRate = featuresWithReworkSignals.length > 0
        ? featuresWithReworkSignals.filter(f => f.hasRework).length / featuresWithReworkSignals.length
        : null;

    const autonomyCounts = { fullAutonomy: 0, thrashing: 0, other: 0 };
    features.forEach(feature => {
        const label = (feature.autonomyLabel || '').toLowerCase();
        if (!label) return;
        if (label.includes('full autonomy')) autonomyCounts.fullAutonomy += 1;
        else if (label.includes('thrashing')) autonomyCounts.thrashing += 1;
        else autonomyCounts.other += 1;
    });

    const { outliers, avgCost, avgTokens } = computeOutliers(features);

    const observations = [];

    observations.push({
        id: 'cost-trend',
        title: 'Cost trend (last 5 features)',
        severity: !costTrend ? 'info' : (costTrend.direction === 'up' ? 'warn' : 'good'),
        observation: !costTrend
            ? 'Not enough cost telemetry to establish a trend.'
            : `Average cost moved ${formatSignedPct(costTrend.deltaPct)} (${costTrend.olderAvg.toFixed(3)} -> ${costTrend.recentAvg.toFixed(3)} USD).`,
        action: !costTrend
            ? 'Ensure cost telemetry is captured on feature-close.'
            : (costTrend.direction === 'up'
                ? 'Review prompt size and model selection on recent costly features.'
                : 'Keep current prompting approach; cost trend is stable or improving.'),
    });

    observations.push({
        id: 'token-efficiency-trend',
        title: 'Token efficiency trend (tokens per line changed)',
        severity: !efficiencyTrend ? 'info' : (efficiencyTrend.direction === 'up' ? 'warn' : 'good'),
        observation: !efficiencyTrend
            ? 'Not enough tokens_per_line_changed data to establish a trend.'
            : `Efficiency moved ${formatSignedPct(efficiencyTrend.deltaPct)} (${efficiencyTrend.olderAvg.toFixed(1)} -> ${efficiencyTrend.recentAvg.toFixed(1)} tokens/line).`,
        action: !efficiencyTrend
            ? 'Capture total_tokens and lines_changed for each completed feature.'
            : (efficiencyTrend.direction === 'up'
                ? 'Investigate high-token edits: break work into smaller scoped features.'
                : 'Efficiency is improving; preserve current implementation cadence.'),
    });

    observations.push({
        id: 'rework-frequency',
        title: 'Rework frequency',
        severity: reworkRate === null ? 'info' : (reworkRate >= 0.35 ? 'warn' : 'good'),
        observation: reworkRate === null
            ? 'No rework flags found in recent feature logs.'
            : `${Math.round(reworkRate * 100)}% of features triggered rework flags.`,
        action: reworkRate === null
            ? 'Enable git signal capture during feature-close to unlock rework insights.'
            : (reworkRate >= 0.35
                ? 'Raise acceptance-criteria specificity before implementation begins.'
                : 'Current rework rate is healthy; keep spec quality consistent.'),
    });

    observations.push({
        id: 'autonomy-distribution',
        title: 'Autonomy distribution',
        severity: autonomyCounts.thrashing > autonomyCounts.fullAutonomy ? 'warn' : 'good',
        observation: `Full Autonomy: ${autonomyCounts.fullAutonomy}, Thrashing: ${autonomyCounts.thrashing}, Other: ${autonomyCounts.other}.`,
        action: autonomyCounts.thrashing > autonomyCounts.fullAutonomy
            ? 'When thrashing spikes, reduce batch size and validate after each criterion.'
            : 'Autonomy profile is healthy; consider expanding autonomous loops where safe.',
    });

    observations.push({
        id: 'outlier-detection',
        title: 'Cost/token outliers (3x baseline)',
        severity: outliers.length > 0 ? 'warn' : 'good',
        observation: outliers.length === 0
            ? 'No 3x cost or token outliers detected.'
            : outliers.map(o => `#${o.featureId} ${o.name} (${o.metric}: ${o.metric === 'cost' ? `$${o.value.toFixed(3)}` : Math.round(o.value)})`).join(' | '),
        action: outliers.length === 0
            ? 'Keep monitoring for sudden spikes as volume grows.'
            : 'Review outlier specs/logs to identify prompt bloat, scope creep, or retries.',
    });

    return {
        generatedAt: new Date().toISOString(),
        insufficientData: false,
        observations,
        summary: 'Rule-based insights generated successfully.',
        aggregates: {
            totalFeatures,
            reworkRate,
            autonomyCounts,
            avgCost,
            avgTokens,
        },
    };
}

function resolveTier(projectConfig = {}) {
    const candidates = [
        projectConfig.tier,
        projectConfig.license && projectConfig.license.tier,
        projectConfig.aade && projectConfig.aade.tier,
    ];
    const tier = candidates.find(Boolean);
    return String(tier || 'free').toLowerCase();
}

async function generateCoaching({ report, projectConfig = {}, apiKey = process.env.ANTHROPIC_API_KEY }) {
    if (!apiKey) {
        return { ok: false, error: 'ANTHROPIC_API_KEY is not set. Set it to enable --coach.' };
    }

    const model = String(projectConfig.insights && projectConfig.insights.coachModel || DEFAULT_MODEL);
    const payload = {
        model,
        max_tokens: 450,
        temperature: 0.2,
        system: [
            'You are a developer workflow coach.',
            'Given aggregated AI development metrics, return 3-5 concrete recommendations.',
            'Focus on actionable, specific, low-ambiguity guidance.',
            'Each recommendation must begin with a verb.',
        ].join(' '),
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Generate coaching recommendations from this AADE summary:\n${JSON.stringify(report, null, 2)}`,
                    },
                ],
            },
        ],
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, error: `Claude API request failed (${response.status}): ${errorText.slice(0, 240)}` };
    }

    const data = await response.json();
    const text = Array.isArray(data.content)
        ? data.content.filter(item => item && item.type === 'text').map(item => item.text).join('\n').trim()
        : '';

    const recommendations = text
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 5);

    return {
        ok: true,
        model,
        recommendations,
        rawText: text,
    };
}

function getCachePath(repoPath = process.cwd()) {
    return path.join(repoPath, CACHE_RELATIVE_PATH);
}

function readInsightsCache(repoPath = process.cwd()) {
    const cachePath = getCachePath(repoPath);
    if (!fs.existsSync(cachePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeInsightsCache(cachePayload, repoPath = process.cwd()) {
    const cachePath = getCachePath(repoPath);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(cachePayload, null, 2)}\n`);
}

/**
 * Generate insights and write to cache.
 * @param {object} options
 * @param {string} options.repoPath - Path to the repo
 * @param {boolean} options.includeCoaching - Whether to include AI coaching
 * @param {function} options.loadProjectConfig - Config loader (injected by host)
 */
async function generateAndCacheInsights({ repoPath = process.cwd(), includeCoaching = false, loadProjectConfig } = {}) {
    const projectConfig = loadProjectConfig ? loadProjectConfig() : {};
    const tier = resolveTier(projectConfig);

    const features = collectAadeFeatures(repoPath);
    const report = buildDeterministicInsights(features);

    const cachePayload = {
        generatedAt: new Date().toISOString(),
        source: 'aigon-insights',
        tier,
        report,
        coaching: null,
    };

    if (includeCoaching) {
        if (tier !== 'pro') {
            cachePayload.coaching = {
                ok: false,
                gated: true,
                error: 'AI coaching requires tier "pro" in .aigon/config.json.',
            };
        } else {
            cachePayload.coaching = await generateCoaching({ report, projectConfig });
        }
    }

    writeInsightsCache(cachePayload, repoPath);
    return cachePayload;
}

function getCostCap(projectConfig = {}) {
    const configured = toNumber(projectConfig.insights && projectConfig.insights.costCapUsd);
    return configured !== null && configured > 0 ? configured : DEFAULT_COST_CAP_USD;
}

function formatInsightsForCli(cachePayload, { includeCoaching = false } = {}) {
    if (!cachePayload || !cachePayload.report) {
        return 'No insights available.';
    }

    const lines = [];
    lines.push('AADE Insights');
    lines.push('');
    lines.push(`Generated: ${cachePayload.generatedAt || new Date().toISOString()}`);
    lines.push(`Tier: ${cachePayload.tier || 'free'}`);
    lines.push('');

    if (cachePayload.report.insufficientData) {
        lines.push(cachePayload.report.summary);
        return lines.join('\n');
    }

    (cachePayload.report.observations || []).forEach((obs, index) => {
        const severity = (obs.severity || 'info').toUpperCase();
        lines.push(`${index + 1}. [${severity}] ${obs.title}`);
        lines.push(`   ${obs.observation}`);
        lines.push(`   Action: ${obs.action}`);
    });

    if (includeCoaching) {
        lines.push('');
        lines.push('AI Coaching');
        const coaching = cachePayload.coaching || {};
        if (coaching.gated) {
            lines.push(`- ${coaching.error}`);
        } else if (!coaching.ok) {
            lines.push(`- ${coaching.error || 'Coaching unavailable.'}`);
        } else if (Array.isArray(coaching.recommendations) && coaching.recommendations.length > 0) {
            coaching.recommendations.slice(0, 5).forEach((rec, idx) => {
                lines.push(`${idx + 1}. ${rec}`);
            });
        } else {
            lines.push('- No coaching recommendations returned.');
        }
    }

    return lines.join('\n');
}

module.exports = {
    CACHE_RELATIVE_PATH,
    DEFAULT_COST_CAP_USD,
    collectAadeFeatures,
    buildDeterministicInsights,
    resolveTier,
    generateCoaching,
    getCachePath,
    readInsightsCache,
    writeInsightsCache,
    generateAndCacheInsights,
    getCostCap,
    formatInsightsForCli,
};
