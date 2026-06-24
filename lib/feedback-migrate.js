'use strict';

const fs = require('fs');
const path = require('path');
const feedbackLib = require('./feedback');
const { getNextId } = require('./spec-crud');
const {
    parseFrontMatter,
    serializeYamlScalar,
    slugify,
    extractMarkdownSection,
} = require('./cli-parse');
const { STAGE_FOLDERS } = require('./workflow-core/paths');
const workflowEngine = require('./workflow-core');

const FEEDBACK_DEPRECATION_NOTICE =
    '⚠️  Deprecated: feedback is now captured as research with origin: customer-feedback. Use `aigon research-create` (or `aigon feedback-migrate` to convert existing files).';

/** Feedback lifecycle → research folder (stage projection). */
const FEEDBACK_STATUS_TO_RESEARCH_FOLDER = Object.freeze({
    inbox: STAGE_FOLDERS.INBOX,
    triaged: STAGE_FOLDERS.BACKLOG,
    actionable: STAGE_FOLDERS.BACKLOG,
    done: STAGE_FOLDERS.DONE,
    'wont-fix': STAGE_FOLDERS.DONE,
    duplicate: STAGE_FOLDERS.DONE,
});

const RESEARCH_FOLDER_TO_LIFECYCLE = Object.freeze({
    [STAGE_FOLDERS.INBOX]: 'inbox',
    [STAGE_FOLDERS.BACKLOG]: 'backlog',
    [STAGE_FOLDERS.IN_PROGRESS]: 'implementing',
    [STAGE_FOLDERS.IN_EVALUATION]: 'evaluating',
    [STAGE_FOLDERS.DONE]: 'done',
    [STAGE_FOLDERS.PAUSED]: 'paused',
});

function researchPathConfig(repoPath) {
    return {
        root: path.join(repoPath, 'docs', 'specs', 'research-topics'),
        folders: Object.values(STAGE_FOLDERS),
        prefix: 'research',
    };
}

function feedbackRefId(feedbackId) {
    return `feedback:${feedbackId}`;
}

function buildFeedbackRefPath(relativePath) {
    return String(relativePath || '').replace(/^\.\//, '');
}

function listResearchSpecFiles(repoPath) {
    const root = path.join(repoPath, 'docs', 'specs', 'research-topics');
    if (!fs.existsSync(root)) return [];
    const files = [];
    fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^\d{2}-/.test(entry.name))
        .forEach(dir => {
            fs.readdirSync(path.join(root, dir.name))
                .filter(file => file.startsWith('research-') && file.endsWith('.md'))
                .forEach(file => files.push(path.join(root, dir.name, file)));
        });
    return files;
}

function normalizeFeedbackRefs(value) {
    if (value === undefined || value === null) return [];
    const raw = Array.isArray(value) ? value : [value];
    return raw.map(v => String(v).trim()).filter(Boolean);
}

function findMigratedResearchPath(repoPath, feedbackId, sourceRelPath) {
    const idRef = feedbackRefId(feedbackId);
    const pathRef = buildFeedbackRefPath(sourceRelPath);
    for (const specPath of listResearchSpecFiles(repoPath)) {
        try {
            const content = fs.readFileSync(specPath, 'utf8');
            const { data } = parseFrontMatter(content);
            const refs = normalizeFeedbackRefs(data.feedback_refs);
            if (refs.includes(idRef) || (pathRef && refs.includes(pathRef))) {
                return specPath;
            }
        } catch (_) {
            // skip unreadable specs
        }
    }
    return null;
}

function serializeResearchOriginFrontMatter(fields) {
    const lines = ['---', `complexity: ${serializeYamlScalar(fields.complexity || 'medium')}`];

    if (fields.origin) {
        lines.push(`origin: ${serializeYamlScalar(fields.origin)}`);
    }

    const reporter = fields.reporter || {};
    lines.push('reporter:');
    lines.push(`  name: ${serializeYamlScalar(reporter.name || '')}`);
    lines.push(`  identifier: ${serializeYamlScalar(reporter.identifier || '')}`);

    const source = fields.source || {};
    lines.push('source:');
    lines.push(`  channel: ${serializeYamlScalar(source.channel || '')}`);
    lines.push(`  reference: ${serializeYamlScalar(source.reference || '')}`);
    if (source.url) {
        lines.push(`  url: ${serializeYamlScalar(source.url)}`);
    }

    if (Array.isArray(fields.feedback_refs) && fields.feedback_refs.length > 0) {
        lines.push('feedback_refs:');
        fields.feedback_refs.forEach(ref => lines.push(`  - ${serializeYamlScalar(ref)}`));
    }

    if (fields.type) {
        lines.push(`type: ${serializeYamlScalar(fields.type)}`);
    }
    if (fields.severity) {
        lines.push(`severity: ${serializeYamlScalar(fields.severity)}`);
    }
    if (Array.isArray(fields.tags) && fields.tags.length > 0) {
        lines.push(`tags: ${serializeYamlScalar(fields.tags)}`);
    }
    if (Number.isFinite(fields.votes)) {
        lines.push(`votes: ${fields.votes}`);
    }
    if (Number.isFinite(fields.duplicate_of) && fields.duplicate_of > 0) {
        lines.push(`duplicate_of: ${fields.duplicate_of}`);
    }
    if (Array.isArray(fields.linked_features) && fields.linked_features.length > 0) {
        lines.push(`linked_features: ${serializeYamlScalar(fields.linked_features)}`);
    }
    if (Array.isArray(fields.linked_research) && fields.linked_research.length > 0) {
        lines.push(`linked_research: ${serializeYamlScalar(fields.linked_research)}`);
    }

    lines.push('---');
    return lines.join('\n');
}

function buildMigratedResearchBody(feedbackItem, originalStatus) {
    const sections = [];
    const summary = extractMarkdownSection(feedbackItem.body, 'Summary');
    const evidence = extractMarkdownSection(feedbackItem.body, 'Evidence');
    const triageNotes = extractMarkdownSection(feedbackItem.body, 'Triage Notes');
    const proposed = extractMarkdownSection(feedbackItem.body, 'Proposed Next Action');

    sections.push(`# Research: ${feedbackItem.metadata.title}`);
    sections.push('');
    sections.push('## Context');
    sections.push('');
    if (summary) {
        sections.push(summary);
    } else {
        sections.push('Migrated from customer feedback.');
    }
    sections.push('');

    if (evidence) {
        sections.push('## Evidence');
        sections.push('');
        sections.push(evidence.trim());
        sections.push('');
    }

    if (triageNotes) {
        sections.push('## Triage Notes');
        sections.push('');
        sections.push(triageNotes.trim());
        sections.push('');
    }

    if (proposed) {
        sections.push('## Proposed Next Action');
        sections.push('');
        sections.push(proposed.trim());
        sections.push('');
    }

    if (originalStatus === 'wont-fix' || originalStatus === 'duplicate') {
        sections.push('## Original Feedback Disposition');
        sections.push('');
        sections.push(`Status: ${originalStatus}`);
        if (originalStatus === 'duplicate' && feedbackItem.metadata.duplicate_of) {
            sections.push(`Duplicate of feedback #${feedbackItem.metadata.duplicate_of}`);
        }
        sections.push('');
    }

    sections.push('## Questions to Answer');
    sections.push('');
    sections.push('- [ ] What should we recommend based on this feedback?');
    sections.push('');
    sections.push('## Scope');
    sections.push('');
    sections.push('### In Scope');
    sections.push('-');
    sections.push('');
    sections.push('### Out of Scope');
    sections.push('-');
    sections.push('');
    sections.push('## Findings');
    sections.push('');
    sections.push('## Recommendation');
    sections.push('');
    sections.push('## Output');
    sections.push('- [ ] Feature:');

    return sections.join('\n');
}

function countFeedbackFiles(repoPath) {
    return feedbackLib.collectFeedbackItems({ repoPath }).length;
}

function hasUnmigratedFeedback(repoPath) {
    const items = feedbackLib.collectFeedbackItems({ repoPath });
    return items.some(item => {
        if (!Number.isFinite(item.metadata.id) || item.metadata.id <= 0) return false;
        const rel = path.relative(repoPath, item.fullPath);
        return !findMigratedResearchPath(repoPath, item.metadata.id, rel);
    });
}

function migrateFeedbackToResearch(repoPath, options = {}) {
    const log = options.log || (() => {});
    const dryRun = options.dryRun === true;
    const items = feedbackLib.collectFeedbackItems({ repoPath });
    const result = { migrated: 0, skipped: 0, errors: [], paths: [] };

    if (items.length === 0) {
        return result;
    }

    const researchRoot = path.join(repoPath, 'docs', 'specs', 'research-topics');

    for (const item of items) {
        const feedbackId = item.metadata.id;
        if (!Number.isFinite(feedbackId) || feedbackId <= 0) {
            result.errors.push(`Skipped ${item.file}: missing numeric id`);
            continue;
        }

        const sourceRelPath = buildFeedbackRefPath(path.relative(repoPath, item.fullPath));
        const existing = findMigratedResearchPath(repoPath, feedbackId, sourceRelPath);
        if (existing) {
            result.skipped += 1;
            log(`feedback-migrate: skip #${feedbackId} (already migrated → ${path.relative(repoPath, existing)})`);
            continue;
        }

        const originalStatus = feedbackLib.normalizeFeedbackStatus(item.metadata.status) || 'inbox';
        const targetFolder = FEEDBACK_STATUS_TO_RESEARCH_FOLDER[originalStatus] || STAGE_FOLDERS.INBOX;
        const targetDir = path.join(researchRoot, targetFolder);
        const nextId = getNextId(researchPathConfig(repoPath));
        const slug = slugify(item.metadata.title || item.file);
        const filename = `research-${String(nextId).padStart(2, '0')}-${slug}.md`;
        const targetPath = path.join(targetDir, filename);

        const frontmatter = serializeResearchOriginFrontMatter({
            complexity: 'medium',
            origin: 'customer-feedback',
            reporter: item.metadata.reporter,
            source: item.metadata.source,
            feedback_refs: [feedbackRefId(feedbackId), sourceRelPath],
            type: item.metadata.type,
            severity: item.metadata.severity,
            tags: item.metadata.tags,
            votes: item.metadata.votes,
            duplicate_of: item.metadata.duplicate_of,
            linked_features: item.metadata.linked_features,
            linked_research: item.metadata.linked_research,
        });
        const body = buildMigratedResearchBody(item, originalStatus);
        const content = `${frontmatter}\n\n${body}`;

        if (dryRun) {
            result.migrated += 1;
            result.paths.push(targetPath);
            log(`feedback-migrate: [dry-run] would create ${path.relative(repoPath, targetPath)}`);
            continue;
        }

        let createdPath = false;
        try {
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(targetPath, content, { encoding: 'utf8', flag: 'wx' });
            createdPath = true;
            workflowEngine.ensureEntityBootstrappedSync(
                repoPath,
                'research',
                String(nextId).padStart(2, '0'),
                RESEARCH_FOLDER_TO_LIFECYCLE[targetFolder] || 'inbox',
                targetPath
            );
            result.migrated += 1;
            result.paths.push(targetPath);
            log(`feedback-migrate: created ${path.relative(repoPath, targetPath)} from feedback #${feedbackId}`);
        } catch (err) {
            if (createdPath) {
                try {
                    fs.rmSync(targetPath, { force: true });
                } catch (_) { /* best-effort rollback */ }
            }
            result.errors.push(`feedback #${feedbackId}: ${err.message}`);
        }
    }

    return result;
}

module.exports = {
    FEEDBACK_DEPRECATION_NOTICE,
    FEEDBACK_STATUS_TO_RESEARCH_FOLDER,
    feedbackRefId,
    findMigratedResearchPath,
    hasUnmigratedFeedback,
    countFeedbackFiles,
    migrateFeedbackToResearch,
    // testing helpers
    buildMigratedResearchBody,
    serializeResearchOriginFrontMatter,
};
