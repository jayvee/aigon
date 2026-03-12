'use strict';

const utils = require('./utils');

module.exports = {
    readTemplate: utils.readTemplate,
    loadAgentConfig: utils.loadAgentConfig,
    getAvailableAgents: utils.getAvailableAgents,
    buildAgentAliasMap: utils.buildAgentAliasMap,
    processTemplate: utils.processTemplate,
    readGenericTemplate: utils.readGenericTemplate,
    extractDescription: utils.extractDescription,
    formatCommandOutput: utils.formatCommandOutput,
    getScaffoldContent: utils.getScaffoldContent,
    getRootFileContent: utils.getRootFileContent,
    syncAgentsMdFile: utils.syncAgentsMdFile,
    removeDeprecatedCommands: utils.removeDeprecatedCommands,
    migrateOldFlatCommands: utils.migrateOldFlatCommands,
    upsertMarkedContent: utils.upsertMarkedContent,
};
