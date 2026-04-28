const assert = require('assert');

const judge = require('../../lib/benchmark-judge');

const result = {
    seed: 'brewboard',
    featureId: '07',
    agent: 'cx',
    model: 'gpt-5.4',
    totalMs: 42000,
    tokenUsage: {
        inputTokens: 1000,
        cachedInputTokens: 400,
        freshInputTokens: 600,
        outputTokens: 80,
    },
    implementationArtifact: {
        changedFiles: ['src/app/page.tsx'],
        diffStat: '1 file changed, 2 insertions(+)',
        diffText: 'diff --git a/src/app/page.tsx b/src/app/page.tsx',
        specBody: '# Feature: Add Footer',
    },
};

const prompt = judge.buildImplementationJudgePrompt(result);
assert.ok(prompt.includes('requirements'), 'prompt should list rubric criteria');
assert.ok(prompt.includes('"changedFiles"'), 'prompt should embed implementation artifact');

const score = judge.finalizeWeightedScore({
    requirements: { score: 8 },
    correctness: { score: 9 },
    minimality: { score: 10 },
    code_quality: { score: 8 },
    risk: { score: 7 },
});
assert.strictEqual(score, 8.45);

const enriched = judge.attachImplementationAssessment(result, {
    summary: 'Good implementation.',
    criteria: {
        requirements: { score: 8, notes: 'Meets the task.' },
        correctness: { score: 9, notes: 'Looks correct.' },
        minimality: { score: 10, notes: 'Very small change.' },
        code_quality: { score: 8, notes: 'Clear enough.' },
        risk: { score: 7, notes: 'Low risk.' },
    },
});
assert.strictEqual(enriched.quality.score, 8.45);
assert.strictEqual(enriched.quality.rubricId, judge.IMPLEMENTATION_RUBRIC_V1.id);

// extractJsonObject pulls a JSON object out of fenced or noisy LLM output
const fenced = '```json\n{ "score": 7, "summary": "ok", "criteria": {} }\n```';
assert.deepStrictEqual(judge.extractJsonObject(fenced), { score: 7, summary: 'ok', criteria: {} });

const noisy = 'Here is my judgment.\n\n{"score": 6, "summary": "fine", "criteria": {}}\n\nThanks!';
assert.deepStrictEqual(judge.extractJsonObject(noisy), { score: 6, summary: 'fine', criteria: {} });

assert.strictEqual(judge.extractJsonObject('no json here'), null);
assert.strictEqual(judge.extractJsonObject(''), null);

// runImplementationJudge with an injected runner: no real CLI invoked
(async () => {
    const fakeRunner = (prompt) => {
        assert.ok(prompt.includes('Score each criterion'), 'runner receives the rubric prompt');
        return Promise.resolve(JSON.stringify({
            score: 7.5,
            summary: 'Acceptable.',
            criteria: {
                requirements: { score: 8, notes: '' },
                correctness: { score: 7, notes: '' },
                minimality: { score: 8, notes: '' },
                code_quality: { score: 7, notes: '' },
                risk: { score: 7, notes: '' },
            },
            judge: { agentId: 'cx', model: 'gpt-5.4' },
        }));
    };
    const judged = await judge.runImplementationJudge(result, { runner: fakeRunner });
    assert.strictEqual(judged.quality.score, 7.5);
    assert.strictEqual(judged.quality.rubricId, judge.IMPLEMENTATION_RUBRIC_V1.id);
    assert.strictEqual(judged.quality.judge.agentId, 'cx');

    let threw = false;
    try {
        await judge.runImplementationJudge(result, { runner: () => Promise.resolve('no json here') });
    } catch (err) {
        threw = /parseable JSON/.test(err.message);
    }
    assert.ok(threw, 'runImplementationJudge throws when output has no JSON');

    console.log('benchmark-judge tests: ok');
})().catch((err) => {
    console.error('benchmark-judge tests failed:', err);
    process.exit(1);
});
