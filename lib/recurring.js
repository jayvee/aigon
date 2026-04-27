'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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

/** Calendar quarter in UTC, e.g. `2026-Q2` (Q1 = Jan–Mar). */
function getISOQuarter(date) {
    const d = date ? new Date(date) : new Date();
    const y = d.getUTCFullYear();
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `${y}-Q${q}`;
}

function getISODateUTC(date) {
    const d = date ? new Date(date) : new Date();
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

/** Calendar month in UTC, e.g. `2026-04`. */
function getISOMonth(date) {
    const d = date ? new Date(date) : new Date();
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${mo}`;
}

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function renderTemplateString(str, ctx = {}) {
    let out = str;
    if (ctx.isoWeek !== undefined) out = out.replace(/\{\{YYYY-WW\}\}/g, ctx.isoWeek);
    if (ctx.isoQuarter !== undefined) out = out.replace(/\{\{YYYY-Q\}\}/g, ctx.isoQuarter);
    if (ctx.isoMonth !== undefined) out = out.replace(/\{\{YYYY-MM\}\}/g, ctx.isoMonth);
    if (ctx.isoDate !== undefined) out = out.replace(/\{\{YYYY-MM-DD\}\}/g, ctx.isoDate);
    return out;
}

/** Replaces `{{YYYY-WW}}` only. Use `renderTemplateString` for `{{YYYY-Q}}` or `{{YYYY-MM-DD}}`. */
function renderPattern(pattern, isoWeek, isoMonth) {
    return renderTemplateString(pattern, { isoWeek, isoMonth });
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
        if (data.schedule !== 'weekly' && data.schedule !== 'quarterly' && data.schedule !== 'monthly') {
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

        const placeholders = data.name_pattern.match(/\{\{[^}]+\}\}/g) || [];
        const allowed = {
            'weekly': ['{{YYYY-WW}}'],
            'quarterly': ['{{YYYY-Q}}'],
            'monthly': ['{{YYYY-MM}}'],
        }[data.schedule];
        const unsupported = placeholders.filter(p => !allowed.includes(p));
        if (unsupported.length > 0) {
            console.warn(`⚠️  [recurring] ${file}: unsupported name_pattern placeholders for schedule=${data.schedule}: ${unsupported.join(', ')}, skipping`);
            continue;
        }
        if (placeholders.length === 0) {
            console.warn(`⚠️  [recurring] ${file}: name_pattern has no supported placeholders, skipping`);
            continue;
        }

        slugsSeen.add(data.recurring_slug);
        templates.push({
            file,
            filePath,
            schedule: /** @type {'weekly' | 'quarterly' | 'monthly'} */ (data.schedule),
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

function createAndPrioritiseFromTemplate(repoPath, template, featureName, periodCtx) {
    const featurePaths = buildFeaturePaths(repoPath);
    const slug = slugify(featureName);
    const inboxFilename = `feature-${slug}.md`;
    const inboxDir = path.join(featurePaths.root, '01-inbox');
    const inboxPath = path.join(inboxDir, inboxFilename);

    const { data, body: tmplBody } = parseFrontMatter(template.rawContent);
    const templateOnly = new Set(['schedule', 'name_pattern']);
    const carryOver = Object.entries(data || {}).filter(([k]) => !templateOnly.has(k));
    const instanceFmLines = ['---'];
    for (const [key, value] of carryOver) {
        instanceFmLines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
    if (template.schedule === 'weekly') {
        instanceFmLines.push(`recurring_week: ${periodCtx.isoWeek}`);
    } else if (template.schedule === 'monthly') {
        instanceFmLines.push(`recurring_month: ${periodCtx.isoMonth}`);
    } else {
        instanceFmLines.push(`recurring_quarter: ${periodCtx.isoQuarter}`);
    }
    instanceFmLines.push(`recurring_template: ${template.file}`);
    instanceFmLines.push('---');
    const instanceFrontmatter = instanceFmLines.join('\n');

    // Replace the first heading with the rendered feature name
    let instanceBody = (tmplBody || '').replace(/^# .+$/m, `# ${featureName}`);
    if (!/^# /m.test(instanceBody)) {
        instanceBody = `# ${featureName}\n\n${instanceBody.trim()}`;
    }
    // Body may use {{YYYY-WW}}, {{YYYY-Q}}, {{YYYY-MM-DD}}; see docs site recurring-features
    instanceBody = renderTemplateString(instanceBody, periodCtx);

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

    execFileSync('git', ['add', 'docs/specs/features/'], { cwd: repoPath, stdio: 'inherit' });
    execFileSync('git', ['commit', '-m', `chore: recurring feature ${paddedId} - ${featureName}`], { cwd: repoPath, stdio: 'inherit' });

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

function _isInsideWorktree(repoPath) {
    try {
        const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoPath, stdio: 'pipe' }).toString().trim();
        const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, stdio: 'pipe' }).toString().trim();
        return path.resolve(repoPath, commonDir) !== path.resolve(repoPath, gitDir);
    } catch (_) {
        return false;
    }
}

function _runCheck(repoPath) {
    if (_isInsideWorktree(repoPath)) {
        console.log('[recurring] Skipping: running inside a feature worktree. Recurring tasks run from the main repo only.');
        return { skipped: true, reason: 'worktree' };
    }

    const recurringDir = path.join(repoPath, 'docs', 'specs', 'recurring');
    const currentWeek = getISOWeek();
    const currentQuarter = getISOQuarter();
    const currentMonth = getISOMonth();
    const currentDate = getISODateUTC();
    const periodCtx = { isoWeek: currentWeek, isoQuarter: currentQuarter, isoMonth: currentMonth, isoDate: currentDate };
    const templates = scanTemplates(recurringDir);
    const state = readRecurringState(repoPath);

    const results = {
        week: currentWeek,
        quarter: currentQuarter,
        month: currentMonth,
        found: templates.length,
        due: 0,
        created: 0,
        skipped: [],
    };

    console.log(`[recurring] Week ${currentWeek} quarter ${currentQuarter} month ${currentMonth}: ${templates.length} template(s) found`);

    for (const template of templates) {
        if (hasOpenInstance(repoPath, template.recurringSlug)) {
            console.log(`[recurring] ${template.recurringSlug}: open instance exists, skipping`);
            results.skipped.push({ slug: template.recurringSlug, reason: 'open instance exists' });
            continue;
        }
        let periodKey;
        let lastRun;
        if (template.schedule === 'weekly') {
            periodKey = currentWeek;
            lastRun = state[template.recurringSlug]?.lastWeek;
        } else if (template.schedule === 'monthly') {
            periodKey = currentMonth;
            lastRun = state[template.recurringSlug]?.lastMonth;
        } else {
            periodKey = currentQuarter;
            lastRun = state[template.recurringSlug]?.lastQuarter;
        }
        if (lastRun === periodKey) {
            const reason = template.schedule === 'weekly'
                ? 'already created this week'
                : template.schedule === 'monthly'
                    ? 'already created this month'
                    : 'already created this quarter';
            console.log(`[recurring] ${template.recurringSlug}: ${reason}, skipping`);
            results.skipped.push({ slug: template.recurringSlug, reason });
            continue;
        }

        results.due++;
        const featureName = renderTemplateString(template.namePattern, periodCtx);

        try {
            const created = createAndPrioritiseFromTemplate(repoPath, template, featureName, periodCtx);
            const stamp = { createdAt: new Date().toISOString() };
            if (template.schedule === 'weekly') {
                state[template.recurringSlug] = { ...state[template.recurringSlug], lastWeek: currentWeek, ...stamp };
            } else if (template.schedule === 'monthly') {
                state[template.recurringSlug] = { ...state[template.recurringSlug], lastMonth: currentMonth, ...stamp };
            } else {
                state[template.recurringSlug] = { ...state[template.recurringSlug], lastQuarter: currentQuarter, ...stamp };
            }
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
    const currentQuarter = getISOQuarter();
    const currentMonth = getISOMonth();
    const templates = scanTemplates(recurringDir);
    const state = readRecurringState(repoPath);

    return templates.map(t => {
        const openExists = hasOpenInstance(repoPath, t.recurringSlug);
        let periodKey;
        let lastRun;
        if (t.schedule === 'weekly') {
            periodKey = currentWeek;
            lastRun = state[t.recurringSlug]?.lastWeek;
        } else if (t.schedule === 'monthly') {
            periodKey = currentMonth;
            lastRun = state[t.recurringSlug]?.lastMonth;
        } else {
            periodKey = currentQuarter;
            lastRun = state[t.recurringSlug]?.lastQuarter;
        }
        const createdThisPeriod = lastRun === periodKey;
        const isDue = !openExists && !createdThisPeriod;
        return {
            recurringSlug: t.recurringSlug,
            schedule: t.schedule,
            namePattern: t.namePattern,
            lastWeek: state[t.recurringSlug] ? state[t.recurringSlug].lastWeek : null,
            lastQuarter: state[t.recurringSlug] ? state[t.recurringSlug].lastQuarter : null,
            lastMonth: state[t.recurringSlug] ? state[t.recurringSlug].lastMonth : null,
            currentWeek,
            currentQuarter,
            currentMonth,
            isDue,
            reason: openExists
                ? 'open instance exists'
                : createdThisPeriod
                    ? (t.schedule === 'weekly'
                        ? 'already created this week'
                        : t.schedule === 'monthly'
                            ? 'already created this month'
                            : 'already created this quarter')
                    : null,
        };
    });
}

module.exports = {
    checkRecurringFeatures,
    listRecurringStatus,
    getISOWeek,
    getISOQuarter,
    getISOMonth,
    getISODateUTC,
    scanTemplates,
    renderPattern,
    renderTemplateString,
};
