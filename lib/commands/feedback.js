'use strict';

const fs = require('fs');
const path = require('path');
const { reconcileEntitySpec } = require('../spec-reconciliation');
// Action scope: feedback commands are scope 'any' — no branch gating needed.

module.exports = function feedbackCommands(ctx) {
    const u = ctx.utils;
    const fb = ctx.feedback;

    const {
        PATHS,
        SPECS_ROOT,
        FEEDBACK_STATUS_TO_FOLDER,
        FEEDBACK_STATUS_FLAG_TO_FOLDER,
        FEEDBACK_DEFAULT_LIST_FOLDERS,
        FEEDBACK_ACTION_TO_STATUS,
        parseCliOptions,
        getOptionValue,
        getOptionValues,
        parseFrontMatter,
        getNextId,
        slugify,
        readTemplate,
        createSpecFile,
        findFile,
        moveFile,
        modifySpecFile,
    } = u;

    const {
        normalizeFeedbackStatus,
        getFeedbackFolderFromStatus,
        normalizeFeedbackSeverity,
        parseTagListValue,
        normalizeTagList,
        serializeFeedbackFrontMatter,
        extractFeedbackSummary,
        normalizeFeedbackMetadata,
        buildFeedbackDocumentContent,
        readFeedbackDocument,
        collectFeedbackItems,
        tokenizeText,
        jaccardSimilarity,
        findDuplicateFeedbackCandidates,
        buildFeedbackTriageRecommendation,
        formatFeedbackFieldValue,
    } = fb;

    return {
        'feedback-create': (args) => {
            const title = args[0];
            const created = createSpecFile({
                input: title,
                usage: 'aigon feedback-create <title>',
                example: 'aigon feedback-create "Login fails on Safari"',
                inboxDir: path.join(PATHS.feedback.root, FEEDBACK_STATUS_TO_FOLDER['inbox']),
                existsLabel: 'Feedback',
                build: (value) => {
                    const nextId = getNextId(PATHS.feedback);
                    const slug = slugify(value);
                    const filename = `feedback-${nextId}-${slug}.md`;
                    const filePath = path.join(PATHS.feedback.root, FEEDBACK_STATUS_TO_FOLDER['inbox'], filename);
                    const projectTemplatePath = path.join(SPECS_ROOT, 'templates', 'feedback-template.md');
                    const template = fs.existsSync(projectTemplatePath)
                        ? fs.readFileSync(projectTemplatePath, 'utf8')
                        : readTemplate('specs/feedback-template.md');
                    const parsedTemplate = parseFrontMatter(template);

                    const metadata = normalizeFeedbackMetadata(parsedTemplate.data, {
                        id: nextId,
                        title: value,
                        status: 'inbox',
                        type: 'bug',
                        reporter: { name: '', identifier: '' },
                        source: { channel: '', reference: '' }
                    });
                    metadata.id = nextId;
                    metadata.title = value;
                    metadata.status = 'inbox';

                    return {
                        filename,
                        filePath,
                        content: buildFeedbackDocumentContent(metadata, parsedTemplate.body),
                        nextMessage: `📝 Next: fill in summary/evidence, then triage with: aigon feedback-triage ${nextId}`
                    };
                }
            });
            if (!created) return;
        },

        'feedback-list': (args) => {
            const options = parseCliOptions(args);
            const includeAll = options.all !== undefined;

            const explicitStatusFlags = Object.keys(FEEDBACK_STATUS_FLAG_TO_FOLDER)
                .filter(flag => options[flag] !== undefined);
            const targetStatuses = includeAll
                ? null
                : explicitStatusFlags.length > 0
                    ? explicitStatusFlags.map(flag => normalizeFeedbackStatus(flag)).filter(Boolean)
                    : FEEDBACK_DEFAULT_LIST_FOLDERS
                        .map(folder => normalizeFeedbackStatus(folder.replace(/^\d+-/, '')))
                        .filter(Boolean);

            const typeFilterRaw = getOptionValue(options, 'type');
            const typeFilter = typeFilterRaw ? String(typeFilterRaw).trim().toLowerCase() : null;
            const severityFilter = normalizeFeedbackSeverity(getOptionValue(options, 'severity'));

            const tagFilters = [...new Set([
                ...normalizeTagList(getOptionValue(options, 'tags')),
                ...normalizeTagList(options.tag !== undefined ? getOptionValues(options, 'tag') : [])
            ])];

            let allItems = collectFeedbackItems({ repoPath: process.cwd(), folders: PATHS.feedback.folders });
            let reconciliationMoved = false;
            allItems.forEach(item => {
                if (!Number.isFinite(item.metadata.id) || item.metadata.id <= 0) return;
                const result = reconcileEntitySpec(process.cwd(), 'feedback', item.metadata.id);
                if (result && result.moved) {
                    reconciliationMoved = true;
                }
            });
            if (reconciliationMoved) {
                allItems = collectFeedbackItems({ repoPath: process.cwd(), folders: PATHS.feedback.folders });
            }

            const items = allItems.filter(item => {
                const itemStatus = normalizeFeedbackStatus(item.metadata.status) || 'inbox';
                const itemType = String(item.metadata.type || '').toLowerCase();
                const itemSeverity = normalizeFeedbackSeverity(item.metadata.severity);
                const itemTags = normalizeTagList(item.metadata.tags);

                if (targetStatuses && !targetStatuses.includes(itemStatus)) return false;
                if (typeFilter && itemType !== typeFilter) return false;
                if (severityFilter && itemSeverity !== severityFilter) return false;
                if (tagFilters.length > 0 && !tagFilters.every(tag => itemTags.includes(tag))) return false;
                return true;
            });

            const filterParts = [];
            if (includeAll) {
                filterParts.push('status=all');
            } else if (explicitStatusFlags.length > 0) {
                filterParts.push(`status=${explicitStatusFlags.join(',')}`);
            } else {
                filterParts.push('status=inbox,triaged,actionable');
            }
            if (typeFilter) filterParts.push(`type=${typeFilter}`);
            if (severityFilter) filterParts.push(`severity=${severityFilter}`);
            if (tagFilters.length > 0) filterParts.push(`tag=${tagFilters.join(',')}`);

            if (items.length === 0) {
                console.log('\nNo feedback items matched the current filters.');
                console.log(`   Filters: ${filterParts.join(' | ')}`);
                return;
            }

            console.log(`\n📬 Feedback items (${items.length})`);
            console.log(`   Filters: ${filterParts.join(' | ')}`);

            items.forEach(item => {
                const idLabel = item.metadata.id > 0 ? `#${item.metadata.id}` : '#?';
                const typeLabel = item.metadata.type || 'unknown';
                const severityLabel = item.metadata.severity || '-';
                const tagsLabel = item.metadata.tags && item.metadata.tags.length > 0
                    ? item.metadata.tags.join(', ')
                    : '-';
                const relPath = `./${path.relative(process.cwd(), item.fullPath)}`;

                console.log(`\n- ${idLabel} [${item.metadata.status}] ${item.metadata.title}`);
                console.log(`  type=${typeLabel}  severity=${severityLabel}  tags=${tagsLabel}`);
                if (item.metadata.duplicate_of) {
                    console.log(`  duplicate_of=#${item.metadata.duplicate_of}`);
                }
                console.log(`  path=${relPath}`);
            });
        },

        'feedback-triage': (args) => {
            const id = args[0];
            if (!id) {
                return console.error(
                    "Usage: aigon feedback-triage <ID> [--type <type>] [--severity <severity|none>] [--tags <csv|none>] [--tag <tag>] [--status <status>] [--duplicate-of <ID|none>] [--action <keep|mark-duplicate|promote-feature|promote-research|wont-fix>] [--apply] [--yes]"
                );
            }

            const options = parseCliOptions(args.slice(1));
            const found = findFile(PATHS.feedback, id, PATHS.feedback.folders);
            if (!found) return console.error(`❌ Could not find feedback "${id}" in docs/specs/feedback/.`);

            const item = readFeedbackDocument(found);
            const allItems = collectFeedbackItems(PATHS.feedback.folders);
            const duplicateCandidates = findDuplicateFeedbackCandidates(item, allItems, 5);

            const proposed = JSON.parse(JSON.stringify(item.metadata));

            const typeOption = getOptionValue(options, 'type');
            if (typeOption !== undefined) {
                const normalizedType = String(typeOption).trim().toLowerCase();
                if (!normalizedType) {
                    return console.error('❌ --type cannot be empty.');
                }
                proposed.type = normalizedType;
            }

            const severityOption = getOptionValue(options, 'severity');
            if (severityOption !== undefined) {
                const normalizedSeverity = normalizeFeedbackSeverity(severityOption);
                if (normalizedSeverity) {
                    proposed.severity = normalizedSeverity;
                } else {
                    delete proposed.severity;
                }
            }

            let clearTags = false;
            const collectedTags = [];
            if (options.tags !== undefined) {
                const tags = parseTagListValue(getOptionValue(options, 'tags'));
                if (Array.isArray(tags) && tags.length === 0) clearTags = true;
                if (Array.isArray(tags) && tags.length > 0) collectedTags.push(...tags);
            }
            if (options.tag !== undefined) {
                const tags = parseTagListValue(getOptionValues(options, 'tag'));
                if (Array.isArray(tags) && tags.length === 0) clearTags = true;
                if (Array.isArray(tags) && tags.length > 0) collectedTags.push(...tags);
            }
            if (options.tags !== undefined || options.tag !== undefined) {
                if (clearTags) {
                    delete proposed.tags;
                } else {
                    const uniqueTags = [...new Set(collectedTags)];
                    if (uniqueTags.length > 0) {
                        proposed.tags = uniqueTags;
                    } else {
                        delete proposed.tags;
                    }
                }
            }

            const duplicateOption = getOptionValue(options, 'duplicate-of');
            if (duplicateOption !== undefined) {
                const duplicateText = String(duplicateOption).trim().toLowerCase();
                if (duplicateText === 'none' || duplicateText === 'null') {
                    delete proposed.duplicate_of;
                } else {
                    const duplicateId = parseInt(duplicateText, 10);
                    if (!Number.isFinite(duplicateId) || duplicateId <= 0) {
                        return console.error('❌ --duplicate-of must be a positive numeric ID or "none".');
                    }
                    if (duplicateId === proposed.id) {
                        return console.error('❌ --duplicate-of cannot reference the same feedback ID.');
                    }
                    proposed.duplicate_of = duplicateId;
                }
            }

            const statusRaw = getOptionValue(options, 'status');
            const statusOption = statusRaw !== undefined ? normalizeFeedbackStatus(statusRaw) : null;
            if (statusRaw !== undefined && !statusOption) {
                return console.error('❌ Invalid --status. Use: inbox, triaged, actionable, done, wont-fix, duplicate');
            }

            const actionAliases = {
                'keep': 'keep',
                'mark-duplicate': 'mark-duplicate',
                'mark_duplicate': 'mark-duplicate',
                'duplicate': 'duplicate',
                'promote-feature': 'promote-feature',
                'promote_feature': 'promote-feature',
                'promote-research': 'promote-research',
                'promote_research': 'promote-research',
                'wont-fix': 'wont-fix',
                'wontfix': 'wont-fix'
            };
            const actionRaw = getOptionValue(options, 'action');
            const actionOption = actionRaw !== undefined
                ? actionAliases[String(actionRaw).trim().toLowerCase()]
                : null;
            if (actionRaw !== undefined && !actionOption) {
                return console.error('❌ Invalid --action. Use: keep, mark-duplicate, promote-feature, promote-research, wont-fix');
            }

            let nextStatus = statusOption;
            if (!nextStatus && actionOption) {
                nextStatus = FEEDBACK_ACTION_TO_STATUS[actionOption];
            }
            if (!nextStatus) {
                nextStatus = item.metadata.status === 'inbox' ? 'triaged' : (item.metadata.status || 'triaged');
            }
            proposed.status = nextStatus;

            if (proposed.duplicate_of && statusRaw === undefined && actionRaw === undefined) {
                proposed.status = 'duplicate';
            }
            if (proposed.status === 'duplicate' && !proposed.duplicate_of && duplicateCandidates.length > 0) {
                proposed.duplicate_of = duplicateCandidates[0].id;
            }
            if (proposed.status !== 'duplicate') {
                delete proposed.duplicate_of;
            }

            const recommendation = buildFeedbackTriageRecommendation(proposed, duplicateCandidates);
            const targetFolder = getFeedbackFolderFromStatus(proposed.status) || found.folder;

            const changedFields = [];
            const trackedFields = ['type', 'severity', 'status', 'duplicate_of'];
            trackedFields.forEach(field => {
                const currentValue = item.metadata[field];
                const nextValue = proposed[field];
                if (JSON.stringify(currentValue) !== JSON.stringify(nextValue)) {
                    changedFields.push(`${field}: ${formatFeedbackFieldValue(currentValue)} -> ${formatFeedbackFieldValue(nextValue)}`);
                }
            });
            const currentTags = normalizeTagList(item.metadata.tags);
            const nextTags = normalizeTagList(proposed.tags);
            if (JSON.stringify(currentTags) !== JSON.stringify(nextTags)) {
                changedFields.push(`tags: ${formatFeedbackFieldValue(currentTags)} -> ${formatFeedbackFieldValue(nextTags)}`);
            }
            if (found.folder !== targetFolder) {
                changedFields.push(`folder: ${found.folder} -> ${targetFolder}`);
            }

            console.log(`\n📋 Feedback #${item.metadata.id}: ${item.metadata.title}`);
            console.log(`   Path: ./${path.relative(process.cwd(), found.fullPath)}`);
            console.log(`   Current: status=${item.metadata.status}, type=${item.metadata.type}, severity=${item.metadata.severity || 'unset'}, tags=${formatFeedbackFieldValue(item.metadata.tags)}`);
            console.log(`   Proposed: status=${proposed.status}, type=${proposed.type}, severity=${proposed.severity || 'unset'}, tags=${formatFeedbackFieldValue(proposed.tags)}`);
            if (proposed.duplicate_of) {
                console.log(`   Proposed duplicate_of: #${proposed.duplicate_of}`);
            }

            if (duplicateCandidates.length > 0) {
                console.log('\n🔎 Duplicate candidates:');
                duplicateCandidates.forEach(candidate => {
                    console.log(`   #${candidate.id} (${Math.round(candidate.score * 100)}%) [${candidate.status}] ${candidate.title}`);
                });
            } else {
                console.log('\n🔎 Duplicate candidates: none found');
            }

            console.log(`\n🤖 Suggested next action: ${recommendation.action}`);
            console.log(`   Reason: ${recommendation.reason}`);

            if (changedFields.length === 0) {
                console.log('\nℹ️  No metadata changes are proposed.');
            } else {
                console.log('\n🛠️  Proposed changes:');
                changedFields.forEach(change => console.log(`   - ${change}`));
            }

            const applyRequested = options.apply !== undefined;
            const confirmed = options.yes !== undefined;
            const replayArgs = args
                .slice(1)
                .filter(arg => arg !== '--apply' && arg !== '--yes');

            if (!applyRequested) {
                console.log('\n🔒 Preview only. No changes written.');
                console.log(`   To apply: aigon feedback-triage ${id}${replayArgs.length ? ` ${replayArgs.join(' ')}` : ''} --apply --yes`);
                return;
            }

            if (!confirmed) {
                console.log('\n⚠️  Confirmation required. Re-run with --yes to apply these changes.');
                return;
            }

            if (proposed.status === 'duplicate' && !proposed.duplicate_of) {
                return console.error('❌ Duplicate status requires duplicate_of. Pass --duplicate-of <ID>.');
            }

            if (changedFields.length === 0) {
                console.log('\n✅ Nothing to apply.');
                return;
            }

            modifySpecFile(found.fullPath, ({ body }) => buildFeedbackDocumentContent(proposed, body));

            if (targetFolder !== found.folder) {
                moveFile(found, targetFolder, null, { actor: 'cli/feedback-triage' });
            } else {
                console.log(`✅ Updated: ./${path.relative(process.cwd(), found.fullPath)}`);
            }

            console.log(`✅ Applied triage for feedback #${proposed.id}.`);
        },
    };
};

// Backward-compat wrapper
function createFeedbackCommands(overrides = {}) {
    const utils = require('../utils');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const stateMachine = require('../state-queries');

    const ctx = {
        utils: { ...utils, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = module.exports(ctx);
    const names = ['feedback-create', 'feedback-list', 'feedback-triage'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createFeedbackCommands = createFeedbackCommands;
