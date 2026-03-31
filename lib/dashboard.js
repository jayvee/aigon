'use strict';

const utils = require('./utils');

module.exports = {
    readConductorReposFromGlobalConfig: utils.readConductorReposFromGlobalConfig,
    normalizeDashboardStatus: utils.normalizeDashboardStatus,
    parseFeatureSpecFileName: utils.parseFeatureSpecFileName,
    getSessionAction: utils.getSessionAction,
    safeTmuxSessionExists: utils.safeTmuxSessionExists,
    collectDashboardStatusData: utils.collectDashboardStatusData,
    escapeForHtmlScript: utils.escapeForHtmlScript,
    buildDashboardHtml: utils.buildDashboardHtml,
    escapeAppleScriptString: utils.escapeAppleScriptString,
    captureDashboardScreenshot: utils.captureDashboardScreenshot,
    writeRepoRegistry: utils.writeRepoRegistry,
    sendMacNotification: utils.sendMacNotification,
    DASHBOARD_INTERACTIVE_ACTIONS: utils.DASHBOARD_INTERACTIVE_ACTIONS,
    resolveDashboardActionRepoPath: utils.resolveDashboardActionRepoPath,
    parseDashboardActionRequest: utils.parseDashboardActionRequest,
    buildDashboardActionCommandArgs: utils.buildDashboardActionCommandArgs,
    runDashboardInteractiveAction: utils.runDashboardInteractiveAction,
    collectAnalyticsData: utils.collectAnalyticsData,
};
