'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseFrontMatter } = require('./cli-parse');
const specCrud = require('./spec-crud');

const OPEN_STAGES = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation'];
const ALL_STAGES = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];

function buildFeaturePaths(repoPath) {
    return {
        root: path.join(repoPath, 'docs', 'specs', 'features'),
        folders: ALL_STAGES,
        prefix: 'feature',
    };
}

function getISOWeek(date) {
    const d = date ? new Date(date) : new Date();
    const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function renderPattern(pattern, isoWeek) {
    return pattern.replace('{{YYYY-WW}}', isoWeek);
}

function scanTemplates(recurringDir) {
    if (!fs.existsSync(recurringDir)) return [];
    const templates = [];
    const slugsSeen = new Set();

    const files = fs.readdirSync(recurringDir).filter(f => f.endsWith('.md')).sort();
    for (const file of files) {
        const filePath = path.join(recurringDir, file);
        let content;
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            console.warn(`⚠️  [recurring] Could not read ${file}: ${e.message}`);
            continue;
        }

        const { data } = parseFrontMatter(content);

        if (!data.schedule) {
            console.warn(`⚠️  [recurring] ${file}: missing 'schedule' frontmatter, skipping`);
            continue;
        }
        if (data.schedule !== 'weekly') {
            console.warn(`⚠️  [recurring] ${file}: unsupported schedule '${data.schedule}', skipping`);
            continue;
        }
        if (!data.name_pattern) {
            console.warn(`⚠️  [recurring] ${file}: missing 'name_pattern' frontmatter, skipping`);
            continue;
        }
        if (!data.recurring_slug) {
            console.warn(`⚠️  [recurring] ${file}: missing 'recurring_slug' frontmatter, skipping`);
            continue;
        }
        if (slugsSeen.has(data.recurring_slug)) {
            console.warn(`⚠️  [recurring] ${file}: duplicate recurring_slug '${data.recurring_slug}', skipping`);
            continue;
        }

        const unsupported = (data.name_pattern.match(/\{\{[^}]+\}\}/g) || []).filter(p => p !== '{{YYYY-WW}}');
        if (unsupported.length > 0) {
            console.warn(`⚠️  [recurring] ${file}: unsupported name_pattern placeholders: ${unsupported.join(', ')}, skipping`);
            continue;
        }

        slugsSeen.add(data.recurring_slug);
        templates.push({
            file,
            filePath,
            schedule: data.schedule,
            namePattern: data.name_pattern,
            recurringSlug: data.recurring_slug,
            rawContent: content,
        });
    }
    return templates;
}

function hasOpenInstance(repoPath, recurringSlug) {
    const featuresRoot = path.join(repoPath, 'docs', 'specs', 'features');
    for (const stage of OPEN_STAGES) {
        const dir = path.join(featuresRoot, stage);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.md')) continue;
            try {
                const content = fs.readFileSync(path.join(dir, file), 'utf8');
                const { data } = parseFrontMatter(content);
                if (data.recurring_slug === recurringSlug) return true;
            } catch (_) { /* skip unreadable files */ }
        }
    }
    return false;
}

function readRecurringState(repoPath) {
    const statePath = path.join(repoPath, '.aigon', 'recurring-state.json');
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_) {
        return {};
    }
}

function writeRecurringState(repoPath, state) {
    const statePath = path.join(repoPath, '.aigon', 'recurring-state.json');
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

function createAndPrioritiseFromTemplate(repoPath, template, featureName, currentWeek) {
    const featurePaths = buildFeaturePaths(repoPath);
    const slug = slugify(featureName);
    const inboxFilename = `feature-${slug}.md`;
    const inboxDir = path.join(featurePaths.root, '01-inbox');
    const inboxPath = path.join(inboxDir, inboxFilename);

    // Build instance spec from template body, stripping template-only frontmatter fields
    const { body: tmplBody } = parseFrontMatter(template.rawContent);
    const instanceFrontmatter = [
        '---',
        `recurring_slug: ${template.recurring_slug || template.recurringSlug}`,
        `recurring_week: ${currentWeek}`,
        `recurring_template: ${template.file}`,
        '---',
    ].join('\n');

    // Replace the first heading with the rendered feature name
    let instanceBody = (tmplBody || '').replace(/^# .+$/m, `# ${featureName}`);
    if (!/^# /m.test(instanceBody)) {
        instanceBody = `# ${featureName}\n\n${instanceBody.trim()}`;
    }

    const instanceContent = `${instanceFrontmatter}\n\n${instanceBody.trim()}\n`;

    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(inboxPath, instanceContent);

    // Bootstrap workflow state
    const engine = require('./workflow-core/engine');
    engine.ensureEntityBootstrappedSync(repoPath, 'feature', slug, 'inbox', inboxPath, {});

    // Prioritise: get next ID, migrate workflow, move to backlog
    const nextId = specCrud.getNextId(featurePaths);
    const paddedId = String(nextId).padStart(2, '0');
    const newName = `feature-${paddedId}-${slug}.md`;
    const backlogPath = path.join(featurePaths.root, '02-backlog', newName);

    engine.migrateEntityWorkflowIdSync(repoPath, 'feature', slug, paddedId, backlogPath, 'backlog');

    const found = { file: inboxFilename, folder: '01-inbox', fullPath: inboxPath };
    specCrud.moveFile(found, '02-backlog', newName, { actor: 'recurring/feature-prioritise' });

    execSync(`git add docs/specs/features/`, { cwd: repoPath, stdio: 'inherit' });
    execSync(`git commit -m "chore: recurring feature ${paddedId} - ${featureName}"`, { cwd: repoPath, stdio: 'inherit' });

    return { id: paddedId, name: featureName };
}

// In-memory guard against concurrent runs in the same process
let _running = false;

function checkRecurringFeatures(repoPath) {
    if (_running) {
        console.log('[recurring] Check already in progress, skipping concurrent trigger');
        return { skipped: true };
    }
    _running = true;
    try {
        return _runCheck(repoPath);
    } catch (e) {
        console.error(`[recurring] Unexpected error: ${e.message}`);
        return { error: e.message };
    } finally {
        _running = false;
    }
}

function _runCheck(repoPath) {
    const recurringDir = path.join(repoPath, 'docs', 'specs', 'recurring');
    const currentWeek = getISOWeek();
    const templates = scanTemplates(recurringDir);
    const state = readRecurringState(repoPath);

    const results = {
        week: currentWeek,
        found: templates.length,
        due: 0,
        created: 0,
        skipped: [],
    };

    console.log(`[recurring] Week ${currentWeek}: ${templates.length} template(s) found`);

    for (const template of templates) {
        if (hasOpenInstance(repoPath, template.recurringSlug)) {
            console.log(`[recurring] ${template.recurringSlug}: open instance exists, skipping`);
            results.skipped.push({ slug: template.recurringSlug, reason: 'open instance exists' });
            continue;
        }
        if (state[template.recurringSlug] && state[template.recurringSlug].lastWeek === currentWeek) {
            console.log(`[recurring] ${template.recurringSlug}: already created this week, skipping`);
            results.skipped.push({ slug: template.recurringSlug, reason: 'already created this week' });
            continue;
        }

        results.due++;
        const featureName = renderPattern(template.namePattern, currentWeek);

        try {
            const created = createAndPrioritiseFromTemplate(repoPath, template, featureName, currentWeek);
            state[template.recurringSlug] = { lastWeek: currentWeek, createdAt: new Date().toISOString() };
            results.created++;
            console.log(`[recurring] Created and prioritised: ${created.name} (ID: ${created.id})`);
        } catch (e) {
            console.error(`[recurring] Failed to create ${template.recurringSlug}: ${e.message}`);
            results.skipped.push({ slug: template.recurringSlug, reason: `error: ${e.message}` });
        }
    }

    try {
        writeRecurringState(repoPath, state);
    } catch (e) {
        console.warn(`[recurring] Could not write state: ${e.message}`);
    }

    console.log(`[recurring] Done: ${results.created} created, ${results.skipped.length} skipped`);
    return results;
}

function listRecurringStatus(repoPath) {
    const recurringDir = path.join(repoPath, 'docs', 'specs', 'recurring');
    const currentWeek = getISOWeek();
    const templates = scanTemplates(recurringDir);
    const state = readRecurringState(repoPath);

    return templates.map(t => {
        const openExists = hasOpenInstance(repoPath, t.recurringSlug);
        const createdThisWeek = state[t.recurringSlug] && state[t.recurringSlug].lastWeek === currentWeek;
        const isDue = !openExists && !createdThisWeek;
        return {
            recurringSlug: t.recurringSlug,
            schedule: t.schedule,
            namePattern: t.namePattern,
            lastWeek: state[t.recurringSlug] ? state[t.recurringSlug].lastWeek : null,
            currentWeek,
            isDue,
            reason: openExists ? 'open instance exists' : createdThisWeek ? 'already created this week' : null,
        };
    });
}

module.exports = {
    checkRecurringFeatures,
    listRecurringStatus,
    getISOWeek,
    scanTemplates,
};
