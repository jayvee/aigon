'use strict';

const path = require('path');
const feedbackLib = require('../feedback');
const stateMachine = require('../state-queries');
const { reconcileEntitySpec } = require('../spec-reconciliation');
const { computeCardHeadline } = require('../card-headline');
const { buildCardPresentation } = require('../card-presentation');
const { safeStatIsoTimes } = require('./safe-reads');

function collectFeedback(absRepoPath) {
    let items = feedbackLib.collectFeedbackItems({ repoPath: absRepoPath });
    let reconciliationMoved = false;
    items.forEach(item => {
        if (!Number.isFinite(item.metadata.id) || item.metadata.id <= 0) return;
        const result = reconcileEntitySpec(absRepoPath, 'feedback', item.metadata.id);
        if (result && result.moved) {
            reconciliationMoved = true;
        }
    });
    if (reconciliationMoved) {
        items = feedbackLib.collectFeedbackItems({ repoPath: absRepoPath });
    }

    const feedback = [];
    items.forEach(item => {
        const stage = feedbackLib.normalizeFeedbackStatus(item.metadata.status) || 'inbox';
        const specPath = item.fullPath;
        const { updatedAt, createdAt } = safeStatIsoTimes(specPath);
        const feedbackSmContext = {
            mode: 'solo',
            agents: [],
            agentStatuses: {},
            tmuxSessionStates: {},
            currentStage: stage,
            entityType: 'feedback'
        };
        const headline = computeCardHeadline({}, null, [], null, stage, { entityType: 'feedback' });
        const row = {
            id: item.metadata.id > 0 ? String(item.metadata.id) : null,
            name: item.metadata.title || path.basename(item.file, '.md'),
            stage,
            specPath,
            updatedAt,
            createdAt,
            agents: [],
            validActions: stateMachine.getAvailableActions('feedback', stage, feedbackSmContext),
            cardHeadline: headline,
        };
        row.cardPresentation = buildCardPresentation(row, { entityType: 'feedback' });
        feedback.push(row);
    });

    return {
        feedback,
        feedbackDoneTotal: items.filter(item => (feedbackLib.normalizeFeedbackStatus(item.metadata.status) || 'inbox') === 'done').length,
    };
}

module.exports = {
    collectFeedback,
};
