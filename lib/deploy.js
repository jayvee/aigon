'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveDeployCommand(isPreview) {
    const key = isPreview ? 'preview' : 'deploy';

    // 1. Check .aigon/config.json → commands.deploy / commands.preview
    const { loadProjectConfig } = require('./config');
    const projectConfig = loadProjectConfig();
    if (projectConfig?.commands?.[key]) {
        return projectConfig.commands[key];
    }

    // 2. Fall back to package.json scripts.deploy / scripts.preview
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg?.scripts?.[key]) {
                return `npm run ${key}`;
            }
        } catch (e) { /* ignore parse errors */ }
    }

    return null;
}

function runDeployCommand(isPreview) {
    const cmd = resolveDeployCommand(isPreview);
    const label = isPreview ? 'preview' : 'deploy';

    if (!cmd) {
        console.error(`❌ No ${label} command configured.`);
        console.error(`\nTo configure, add to .aigon/config.json:`);
        console.error(`  {`);
        console.error(`    "commands": {`);
        if (isPreview) {
            console.error(`      "preview": "vercel"`);
        } else {
            console.error(`      "deploy": "vercel --prod"`);
        }
        console.error(`    }`);
        console.error(`  }`);
        console.error(`\nOr add a "${label}" script to package.json.`);
        return 1;
    }

    console.log(`🚀 Running ${label}: ${cmd}`);
    const result = spawnSync(cmd, { stdio: 'inherit', shell: true }); // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true,javascript.lang.security.detect-child-process.detect-child-process

    if (result.error) {
        console.error(`❌ Failed to run deploy command: ${result.error.message}`);
        return 1;
    }
    return result.status ?? 0;
}

module.exports = { resolveDeployCommand, runDeployCommand };
