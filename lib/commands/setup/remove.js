'use strict';

const fs = require('fs');
const path = require('path');
const { createInterface } = require('readline');
const installManifestLib = require('../../install-manifest');
const { readConductorReposFromGlobalConfig, writeRepoRegistry } = require('../../config');

module.exports = function removeCommand() {
    return async (args = []) => {
        if (args.includes('--help')) {
            console.log('Usage: aigon remove [--dry-run] [--force] [--purge]');
            console.log('');
            console.log('Removes Aigon-managed files from the current Git repository.');
            console.log('');
            console.log('Flags:');
            console.log('  --dry-run   Print what would be removed without making any changes');
            console.log('  --force     Skip the confirmation prompt and modified-file warning');
            console.log('  --purge     Also remove all of .aigon/ (workflows, state, sessions, config)');
            console.log('');
            console.log('Note: docs/specs/, AGENTS.md, CLAUDE.md, and README.md are never touched.');
            console.log('');
            console.log('To uninstall the Aigon CLI globally, run:');
            console.log('  npm uninstall -g @senlabsai/aigon');
            console.log('  See "Uninstalling Aigon completely" in the docs.');
            return;
        }

        const dryRun = args.includes('--dry-run');
        const force = args.includes('--force');
        const purge = args.includes('--purge');
        const removeRepoRoot = process.cwd();

        const worktreeMarkerPath = path.join(removeRepoRoot, '.aigon', 'worktree.json');
        if (fs.existsSync(worktreeMarkerPath)) {
            let mainRepo = removeRepoRoot;
            try {
                const wt = JSON.parse(fs.readFileSync(worktreeMarkerPath, 'utf8'));
                if (wt.mainRepo) mainRepo = wt.mainRepo;
            } catch (_) {}
            console.error('Refusing to remove from a worktree — would affect the main repo.');
            console.error(`Run \`aigon remove\` in the main repo (${mainRepo}).`);
            process.exit(1);
        }

        const aigonDirExists = fs.existsSync(path.join(removeRepoRoot, '.aigon'));
        const isRegistered = (() => {
            try {
                const abs = path.resolve(removeRepoRoot);
                return readConductorReposFromGlobalConfig()
                    .map(r => path.resolve(r))
                    .includes(abs);
            } catch (_) { return false; }
        })();
        if (!aigonDirExists && !isRegistered) {
            console.error('❌ This is not an Aigon repository (no .aigon/ directory, not in registry).');
            return;
        }

        let manifest = null;
        try {
            manifest = installManifestLib.readManifest(removeRepoRoot);
        } catch (e) {
            console.warn(`⚠ Could not read install manifest: ${e.message}`);
        }

        const files = (manifest && manifest.files) || [];
        const modified = manifest ? installManifestLib.getModifiedFiles(manifest, removeRepoRoot) : [];
        const modifiedPaths = new Set(modified.map(m => m.path));

        if (files.length > 0) {
            console.log('\nFiles that would be removed:');
            files.forEach(entry => {
                const exists = fs.existsSync(path.join(removeRepoRoot, entry.path));
                const modFlag = modifiedPaths.has(entry.path) ? ' [modified]' : '';
                const existsFlag = !exists ? ' [missing]' : '';
                console.log(`  - ${entry.path}${modFlag}${existsFlag}`);
            });
        } else {
            console.log('\nℹ️  No tracked Aigon files to delete (no install manifest, or empty).');
        }

        if (dryRun) {
            if (isRegistered) {
                console.log(`\n  Registry entry that would be removed: ${path.resolve(removeRepoRoot)}`);
            }
            if (purge && aigonDirExists) {
                console.log(`  Directory that would be purged: .aigon/`);
            }
            console.log('\n(--dry-run: no changes were made)');
            return;
        }

        if (modified.length > 0 && !force) {
            console.warn(`\n⚠ ${modified.length} file(s) have been modified outside install. Use --force to delete them anyway.`);
            modified.forEach(m => console.warn(`  - ${m.path}`));
            console.error('Remove aborted. Pass --force to override.');
            return;
        }

        const removeNonInteractive = !!process.env.AIGON_NONINTERACTIVE || !process.stdin.isTTY;
        if (!force && !removeNonInteractive) {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise(resolve => rl.question('\nProceed with remove? [y/N] ', resolve));
            rl.close();
            if (answer.trim().toLowerCase() !== 'y') {
                console.log('Remove aborted.');
                return;
            }
        }

        let deleted = 0;
        let skipped = 0;
        for (const entry of files) {
            const absPath = path.join(removeRepoRoot, entry.path);
            if (!fs.existsSync(absPath)) { skipped++; continue; }
            if (modifiedPaths.has(entry.path) && !force) { skipped++; continue; }
            try {
                fs.unlinkSync(absPath);
                deleted++;
                let dir = path.dirname(absPath);
                while (dir !== removeRepoRoot && dir.startsWith(removeRepoRoot)) {
                    try {
                        const remaining = fs.readdirSync(dir);
                        if (remaining.length === 0) {
                            fs.rmdirSync(dir);
                            dir = path.dirname(dir);
                        } else {
                            break;
                        }
                    } catch (_) { break; }
                }
            } catch (e) {
                console.warn(`  ⚠ Could not delete ${entry.path}: ${e.message}`);
            }
        }

        const manifestAbsPath = path.join(removeRepoRoot, installManifestLib.MANIFEST_PATH);
        try {
            if (fs.existsSync(manifestAbsPath)) fs.unlinkSync(manifestAbsPath);
        } catch (_) { /* best-effort */ }

        try {
            const repos = readConductorReposFromGlobalConfig().filter(r => path.resolve(r) !== path.resolve(removeRepoRoot));
            writeRepoRegistry(repos);
        } catch (_) { /* best-effort */ }

        if (purge && fs.existsSync(path.join(removeRepoRoot, '.aigon'))) {
            fs.rmSync(path.join(removeRepoRoot, '.aigon'), { recursive: true, force: true });
            console.log('   ↳ --purge: removed .aigon/ runtime state');
        }

        console.log(`\n✅ Removed: ${deleted} file(s) removed, ${skipped} skipped.`);
        if (!purge) {
            console.log('ℹ️  Runtime state preserved: .aigon/workflows/, .aigon/state/, .aigon/sessions/, .aigon/config.json');
        }
        console.log('Aigon removed. Your `AGENTS.md`, `CLAUDE.md`, `README.md`, and project files were not touched.');
    };
};
