'use strict';

const utils = require('./utils');

module.exports = {
    normalizeFeedbackStatus: utils.normalizeFeedbackStatus,
    getFeedbackFolderFromStatus: utils.getFeedbackFolderFromStatus,
    normalizeFeedbackSeverity: utils.normalizeFeedbackSeverity,
    normalizeTag: utils.normalizeTag,
    parseTagListValue: utils.parseTagListValue,
    normalizeTagList: utils.normalizeTagList,
    serializeFeedbackFrontMatter: utils.serializeFeedbackFrontMatter,
    extractFeedbackSummary: utils.extractFeedbackSummary,
    normalizeFeedbackMetadata: utils.normalizeFeedbackMetadata,
    buildFeedbackDocumentContent: utils.buildFeedbackDocumentContent,
    readFeedbackDocument: utils.readFeedbackDocument,
    collectFeedbackItems: utils.collectFeedbackItems,
    findDuplicateFeedbackCandidates: utils.findDuplicateFeedbackCandidates,
    buildFeedbackTriageRecommendation: utils.buildFeedbackTriageRecommendation,
    formatFeedbackFieldValue: utils.formatFeedbackFieldValue,
};
