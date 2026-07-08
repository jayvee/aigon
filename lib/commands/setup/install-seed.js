'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { SEED_REGISTRY, WORKING_REPO_REGISTRY } = require('./seed-registry');

module.exports = function installSeedCommand(_ctx, getCommand) {
    return async (args) => {
        const name = args.find(a => !a.startsWith('--'));
        if (!name) {
            console.error('Usage: aigon install-seed <name>');
            console.error('\nClones a known seed repo to ~/src/<name>, runs `aigon apply`, and registers it with the dashboard.');
            console.error(`\nKnown seeds: ${Object.keys(SEED_REGISTRY).join(', ')}`);
            console.error('\nExample:');
            console.error('  aigon install-seed brewboard');
            console.error('\nTo wipe and re-clone an existing seed: aigon seed-reset <name>');
            process.exitCode = 1;
            return;
        }

        const seedUrl = SEED_REGISTRY[name];
        if (!seedUrl) {
            console.error(`❌ Unknown seed: ${name}`);
            console.error(`   Known seeds: ${Object.keys(SEED_REGISTRY).join(', ')}`);
            process.exitCode = 1;
            return;
        }

        const targetDir = path.join(os.homedir(), 'src', name);
        if (fs.existsSync(targetDir)) {
            console.log(`ℹ️  ${targetDir} already exists.`);
            console.log('   If Aigon is already applied there, you\'re done — open http://localhost:4100.');
            console.log(`   To wipe and re-clone: aigon seed-reset ${name}`);
            return;
        }

        console.log(`📥 Cloning ${seedUrl} → ${targetDir}`);
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        const clone = spawnSync('git', ['clone', seedUrl, targetDir], { stdio: 'inherit' });
        if (clone.status !== 0) {
            console.error('❌ git clone failed.');
            process.exitCode = 1;
            return;
        }

        spawnSync('git', ['remote', 'remove', 'origin'], { cwd: targetDir, stdio: 'ignore' });

        if (fs.existsSync(path.join(targetDir, 'package.json'))) {
            console.log('📦 Running npm install…');
            const npm = spawnSync('npm', ['install'], { cwd: targetDir, stdio: 'inherit' });
            if (npm.status !== 0) {
                console.error('⚠️  npm install failed — run it manually in the cloned repo.');
            }
        }

        console.log('🚀 Running aigon apply…');
        const prevCwd = process.cwd();
        try {
            process.chdir(targetDir);
            await getCommand('apply')([]);
        } catch (e) {
            console.error(`⚠️  aigon apply failed: ${e.message}`);
        } finally {
            process.chdir(prevCwd);
        }

        console.log('🗂️  Registering with dashboard…');
        const aigonBin = path.join(__dirname, '..', '..', '..', 'aigon-cli.js');
        const reg = spawnSync(process.execPath, [aigonBin, 'server', 'add', targetDir], { stdio: 'inherit' });
        if (reg.status !== 0) {
            console.error(`⚠️  Registration failed — add it manually: aigon server add ${targetDir}`);
        }

        console.log(`\n✅ ${name} installed at ${targetDir}`);
        console.log('   Open http://localhost:4100 — it should appear on the dashboard.');
    };
};
