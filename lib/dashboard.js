'use strict';

const utils = require('./utils');

module.exports = {
    readConductorReposFromGlobalConfig: utils.readConductorReposFromGlobalConfig,
    parseSimpleFrontMatter: utils.parseSimpleFrontMatter,
    normalizeDashboardStatus: utils.normalizeDashboardStatus,
    parseFeatureSpecFileName: utils.parseFeatureSpecFileName,
    inferDashboardNextCommand: utils.inferDashboardNextCommand,
    safeTmuxSessionExists: utils.safeTmuxSessionExists,
    collectDashboardStatusData: utils.collectDashboardStatusData,
    escapeForHtmlScript: utils.escapeForHtmlScript,
    buildDashboardHtml: utils.buildDashboardHtml,
    escapeAppleScriptString: utils.escapeAppleScriptString,
    captureDashboardScreenshot: utils.captureDashboardScreenshot,
    writeRepoRegistry: utils.writeRepoRegistry,
    readRadarMeta: utils.readRadarMeta,
    writeRadarMeta: utils.writeRadarMeta,
    removeRadarMeta: utils.removeRadarMeta,
    isRadarAlive: utils.isRadarAlive,
    sendMacNotification: utils.sendMacNotification,
    requestRadarJson: utils.requestRadarJson,
    renderRadarMenubarFromStatus: utils.renderRadarMenubarFromStatus,
    writeRadarLaunchdPlist: utils.writeRadarLaunchdPlist,
    runRadarServiceDaemon: utils.runRadarServiceDaemon,
};
