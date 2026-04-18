'use strict';

const utils = require('./utils');

module.exports = {
    sanitizeForDns: utils.sanitizeForDns,
    getAppId: utils.getAppId,
    isPortAvailable: utils.isPortAvailable,
    allocatePort: utils.allocatePort,
    isProxyAvailable: utils.isProxyAvailable,
    isCaddyInstalled: utils.isCaddyInstalled,
    parseCaddyRoutes: utils.parseCaddyRoutes,
    addCaddyRoute: utils.addCaddyRoute,
    removeCaddyRoute: utils.removeCaddyRoute,
    buildCaddyHostname: utils.buildCaddyHostname,
    loadPortRegistry: utils.loadPortRegistry,
    savePortRegistry: utils.savePortRegistry,
    registerPort: utils.registerPort,
    deregisterPort: utils.deregisterPort,
    scanPortsFromFilesystem: utils.scanPortsFromFilesystem,
    detectDevServerContext: utils.detectDevServerContext,
    getDevProxyUrl: utils.getDevProxyUrl,
    getDevServerLogPath: utils.getDevServerLogPath,
    spawnDevServer: utils.spawnDevServer,
    waitForHealthy: utils.waitForHealthy,
    openInBrowser: utils.openInBrowser,
    resolveDevServerUrl: utils.resolveDevServerUrl,
    detectDashboardContext: utils.detectDashboardContext,
    isProcessAlive: utils.isProcessAlive,
    isPortInUseSync: utils.isPortInUseSync,
};
