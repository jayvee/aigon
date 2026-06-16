'use strict';

const fs = require('fs');
const cfg = require('../../config');
const { runPrerequisiteChecks, printPrerequisiteResults } = require('../../prerequisite-checks');
const { selectTerminal, saveTerminalPreference } = require('../../onboarding/terminal');

module.exports = function globalSetupCommand() {
    return async (args = []) => {
        const forceFlag = args.includes('--force');
        const nonInteractiveFlag = args.includes('--non-interactive');
        const quietFlag = args.includes('--quiet');
        const isInteractive = !nonInteractiveFlag && process.stdin.isTTY && process.stdout.isTTY;

        const prereqs = await runPrerequisiteChecks();
        if (prereqs.errors.length > 0) {
            console.error('\n⚠️  Aigon prerequisite check failed:');
            printPrerequisiteResults(prereqs, { verbose: true, prefix: '   ' });
            console.error('\n   Run `aigon check-prerequisites` for details and remediation steps.');
            if (!quietFlag) process.exit(1);
        } else if (!quietFlag && prereqs.warnings.length > 0) {
            console.log('\nPrerequisite warnings:');
            printPrerequisiteResults(prereqs, { verbose: false, prefix: '  ' });
        }

        if (fs.existsSync(cfg.GLOBAL_CONFIG_PATH) && !forceFlag) {
            if (!quietFlag) {
                console.log(`✅ Aigon global config already exists.`);
                console.log(`   ${cfg.GLOBAL_CONFIG_PATH}`);
                console.log(`   Run \`aigon global-setup --force\` to reconfigure.`);
            }
            return;
        }

        let rawConfig = {};
        if (forceFlag && fs.existsSync(cfg.GLOBAL_CONFIG_PATH)) {
            try {
                rawConfig = JSON.parse(fs.readFileSync(cfg.GLOBAL_CONFIG_PATH, 'utf8'));
            } catch (_) { /* ignore — use empty */ }
        }

        const platformDefault = process.platform === 'darwin' ? 'apple-terminal' : null;
        let terminalApp = rawConfig.terminalApp || platformDefault;

        if (isInteractive) {
            console.log('');
            console.log('🚀 Welcome to Aigon! Let\'s configure your global preferences.');
            const terminalAppChoice = await selectTerminal(false);
            if (terminalAppChoice) {
                saveTerminalPreference(terminalAppChoice);
                terminalApp = terminalAppChoice;
            }
        } else if (!quietFlag) {
            console.log(`🔧 Aigon: writing default global config (non-interactive)`);
            saveTerminalPreference(terminalApp);
        }

        if (isInteractive && !quietFlag) {
            console.log('');
            console.log(`✅ Global config saved:`);
            console.log(`   ${cfg.GLOBAL_CONFIG_PATH}`);
            console.log(`   terminal: ${terminalApp || 'auto-detect'}`);
            console.log('');
            console.log('💡 Next steps:');
            console.log('   cd <your-project>');
            console.log('   aigon apply             # initialize and sync a project');
            console.log('   aigon install-agent cc  # install an AI agent');
            console.log('');
        } else if (!quietFlag) {
            console.log(`   Config: ${cfg.GLOBAL_CONFIG_PATH}`);
            console.log(`   Terminal: ${terminalApp || 'auto-detect'}`);
        }
    };
};
