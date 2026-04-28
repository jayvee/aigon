'use strict';

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const IMPLEMENTATION_RUBRIC_V1 = Object.freeze({
    id: 'implementation-v1',
    label: 'Implementation benchmark rubric',
    version: '2026-04-28',
    scale: '0-10',
    criteria: [
        {
            id: 'requirements',
            label: 'Requirements fit',
            weight: 0.35,
            guidance: 'Does the implementation satisfy the spec and acceptance criteria directly, with no major omissions or misunderstandings?',
        },
        {
            id: 'correctness',
            label: 'Technical correctness',
            weight: 0.25,
            guidance: 'Is the code likely to work as written, without obvious logic, JSX, type, or integration mistakes?',
        },
        {
            id: 'minimality',
            label: 'Appropriate scope',
            weight: 0.15,
            guidance: 'Is the change appropriately small and targeted for the requested task, avoiding unnecessary refactors or churn?',
        },
        {
            id: 'code_quality',
            label: 'Code quality',
            weight: 0.15,
            guidance: 'Is the code readable and consistent with the local style, with sensible naming and structure?',
        },
        {
            id: 'risk',
            label: 'Regression risk',
            weight: 0.10,
            guidance: 'Does the patch avoid introducing avoidable UX, accessibility, or maintainability regressions?',
        },
    ],
    anchors: {
        '9-10': 'Excellent. Fully meets the feature intent with clean, correct, low-risk code.',
        '7-8': 'Good. Meets the goal with minor issues or small polish gaps.',
        '5-6': 'Mixed. Partial success, but there are visible requirement gaps, correctness concerns, or unnecessary churn.',
        '3-4': 'Weak. Significant requirement misses or risky/incorrect implementation choices.',
        '0-2': 'Failed. The task is largely unfulfilled or the patch is clearly broken.',
    },
});

const DEFAULT_JUDGE_CONFIG = Object.freeze({
    agentId: 'cx',
    model: 'gpt-5.4',
    rubricId: IMPLEMENTATION_RUBRIC_V1.id,
});

function loadBenchmarkResult(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

function finalizeWeightedScore(criteriaScores, rubric = IMPLEMENTATION_RUBRIC_V1) {
    let totalWeight = 0;
    let weighted = 0;
    for (const criterion of rubric.criteria) {
        const row = criteriaScores[criterion.id];
        if (!row) continue;
        const score = Number(row.score);
        if (!Number.isFinite(score)) continue;
        totalWeight += criterion.weight;
        weighted += score * criterion.weight;
    }
    if (totalWeight <= 0) return null;
    return round2(weighted / totalWeight);
}

function buildImplementationJudgePacket(result, options = {}) {
    const rubric = options.rubric || IMPLEMENTATION_RUBRIC_V1;
    const judge = {
        agentId: options.agentId || DEFAULT_JUDGE_CONFIG.agentId,
        model: options.model || DEFAULT_JUDGE_CONFIG.model,
        rubricId: rubric.id,
    };
    return {
        benchmark: {
            seed: result.seed,
            featureId: result.featureId,
            agent: result.agent,
            model: result.model,
            effort: result.effort,
            timestamp: result.timestamp,
            totalMs: result.totalMs,
            tokenUsage: result.tokenUsage || null,
        },
        rubric,
        judge,
        artifact: result.implementationArtifact || null,
    };
}

function buildImplementationJudgePrompt(result, options = {}) {
    const packet = buildImplementationJudgePacket(result, options);
    const rubric = packet.rubric;
    const criteriaText = rubric.criteria
        .map((criterion) => `- ${criterion.id} (${criterion.weight * 100}%): ${criterion.guidance}`)
        .join('\n');
    return [
        'You are judging a benchmark implementation for Aigon.',
        '',
        `Judge agent: ${packet.judge.agentId}`,
        `Judge model: ${packet.judge.model}`,
        `Rubric: ${rubric.label} (${rubric.version})`,
        '',
        'Score each criterion from 0 to 10, then compute a weighted overall score from 0 to 10.',
        'Use the rubric anchors and be strict about requirement misses or broken code.',
        '',
        'Criteria:',
        criteriaText,
        '',
        'Benchmark metadata:',
        JSON.stringify(packet.benchmark, null, 2),
        '',
        'Implementation artifact:',
        JSON.stringify(packet.artifact, null, 2),
        '',
        'Return JSON with this exact shape:',
        JSON.stringify({
            score: 0,
            summary: '',
            criteria: {
                requirements: { score: 0, notes: '' },
                correctness: { score: 0, notes: '' },
                minimality: { score: 0, notes: '' },
                code_quality: { score: 0, notes: '' },
                risk: { score: 0, notes: '' },
            },
            rubricId: rubric.id,
            judge: packet.judge,
        }, null, 2),
    ].join('\n');
}

function attachImplementationAssessment(result, assessment, options = {}) {
    const rubric = options.rubric || IMPLEMENTATION_RUBRIC_V1;
    const criteria = assessment.criteria || {};
    const score = assessment.score != null
        ? round2(assessment.score)
        : finalizeWeightedScore(criteria, rubric);
    return {
        ...result,
        quality: {
            kind: 'implementation',
            rubricId: rubric.id,
            rubricVersion: rubric.version,
            judge: {
                agentId: assessment.judge?.agentId || options.agentId || DEFAULT_JUDGE_CONFIG.agentId,
                model: assessment.judge?.model || options.model || DEFAULT_JUDGE_CONFIG.model,
            },
            score,
            summary: assessment.summary || '',
            criteria,
            assessedAt: assessment.assessedAt || new Date().toISOString(),
        },
    };
}

function extractJsonObject(text) {
    if (!text || typeof text !== 'string') return null;
    const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    const candidate = fence ? fence[1] : text;
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first < 0 || last < 0 || last <= first) return null;
    try {
        return JSON.parse(candidate.slice(first, last + 1));
    } catch (_) {
        return null;
    }
}

function defaultJudgeRunner(prompt, options = {}) {
    const agentBinary = options.agentBinary || 'claude';
    const timeoutMs = options.timeoutMs || 300_000;
    const which = spawnSync('which', [agentBinary], { encoding: 'utf8' });
    if (which.status !== 0) {
        return Promise.reject(new Error(`${agentBinary} not on PATH; cannot run judge`));
    }
    const args = agentBinary === 'codex' ? ['exec', prompt] : ['-p', prompt];
    return new Promise((resolve, reject) => {
        const child = spawn(agentBinary, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        const killer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
        child.on('close', (code) => {
            clearTimeout(killer);
            if (code !== 0) return reject(new Error(`${agentBinary} exit ${code}: ${stderr.slice(-500)}`));
            resolve(stdout);
        });
        child.on('error', (err) => {
            clearTimeout(killer);
            reject(err);
        });
    });
}

async function runImplementationJudge(result, options = {}) {
    const prompt = buildImplementationJudgePrompt(result, options);
    const runner = options.runner || defaultJudgeRunner;
    const stdout = await runner(prompt, options);
    const assessment = extractJsonObject(stdout);
    if (!assessment) {
        throw new Error('Judge response did not contain a parseable JSON object');
    }
    return attachImplementationAssessment(result, assessment, options);
}

module.exports = {
    IMPLEMENTATION_RUBRIC_V1,
    DEFAULT_JUDGE_CONFIG,
    loadBenchmarkResult,
    finalizeWeightedScore,
    buildImplementationJudgePacket,
    buildImplementationJudgePrompt,
    attachImplementationAssessment,
    extractJsonObject,
    defaultJudgeRunner,
    runImplementationJudge,
};
