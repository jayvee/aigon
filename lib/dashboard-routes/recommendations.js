'use strict';

const fs = require('fs');
const path = require('path');

module.exports = [
    {
        method: 'POST',
        path: '/api/spec/create',
        handler(req, res, ctx) {
            ctx.readJsonBody().then(payload => {
                try {
                    const repoPath = String(payload.repoPath || '').trim();
                    const type = String(payload.type || '').trim();
                    const name = String(payload.name || '').trim();
                    if (!repoPath || !type || !name) {
                        ctx.sendJson(400, { error: 'Missing repoPath, type, or name' });
                        return;
                    }
                    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    if (!slug) {
                        ctx.sendJson(400, { error: 'Invalid name' });
                        return;
                    }
                    let inboxDir;
                    let fileName;
                    let template;
                    const titleName = name;
                    if (type === 'features') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'features', '01-inbox');
                        fileName = `feature-${slug}.md`;
                        template = `# Feature: ${titleName}\n\n## Summary\n\nDescribe the feature here.\n\n## User Stories\n\n- [ ] As a user, I can ...\n\n## Acceptance Criteria\n\n- [ ] ...\n\n## Technical Approach\n\n...\n\n## Validation\n\n...\n\n## Dependencies\n\n- None\n\n## Out of Scope\n\n- ...\n`;
                    } else if (type === 'research') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'research-topics', '01-inbox');
                        fileName = `research-${slug}.md`;
                        template = `# Research: ${titleName}\n\n## Context\n\nDescribe the research question or problem here.\n\n## Questions to Answer\n\n1. ...\n\n## Approach\n\n...\n\n## Success Criteria\n\nWhat does a good answer look like?\n`;
                    } else if (type === 'feedback') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'feedback', '01-inbox');
                        fileName = `feedback-${slug}.md`;
                        template = `---\ntitle: "${name}"\nstatus: "inbox"\ntype: "bug"\nreporter:\n  name: ""\n  identifier: ""\nsource:\n  channel: "dashboard"\n  reference: ""\n---\n\n## Summary\n\nDescribe the feedback here.\n\n## Steps to Reproduce\n\n1. ...\n\n## Expected Behaviour\n\n...\n\n## Actual Behaviour\n\n...\n`;
                    } else {
                        ctx.sendJson(400, { error: 'Invalid type: ' + type });
                        return;
                    }
                    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
                    const filePath = path.join(inboxDir, fileName);
                    if (fs.existsSync(filePath)) {
                        ctx.sendJson(409, { error: 'File already exists: ' + fileName });
                        return;
                    }
                    fs.writeFileSync(filePath, template, 'utf8');
                    ctx.helpers.log(`Created ${type} spec via dashboard: ${filePath}`);
                    ctx.sendJson(200, { ok: true, path: filePath, name: slug });
                } catch (e) {
                    ctx.sendJson(500, { error: e.message });
                }
            }).catch(() => ctx.sendJson(400, { error: 'Invalid JSON body' }));
        }
    },
    {
        method: 'GET',
        path: /^\/api\/recommendation\/(feature|research)\/(\d+)$/,
        handler(req, res, ctx, match) {
            const type = match[1];
            const id = match[2];
            const url = new URL(req.url, `http://${req.headers.host}`);
            const repoPathHint = String(url.searchParams.get('repoPath') || '').trim();
            const registered = ctx.routes.readConductorReposFromGlobalConfig();
            const resolvedRepo = ctx.routes.resolveDetailRepoPath(registered, {
                repoPath: repoPathHint,
                type,
                id,
            });
            if (!resolvedRepo) {
                ctx.sendJson(404, { error: 'Could not resolve repository' });
                return;
            }
            try {
                const specRec = require('../spec-recommendation');
                const resolver = require('../feature-spec-resolver');
                const resolved = resolver.resolveEntitySpec(resolvedRepo, type, id);
                const recommendation = resolved && resolved.path
                    ? specRec.readSpecRecommendation(resolved.path)
                    : null;
                const complexity = recommendation && recommendation.complexity;
                const ranked = complexity
                    ? specRec.applyRankBadges(specRec.rankAgentsForOperation('implement', complexity, { repoPath: resolvedRepo }))
                    : [];
                ctx.sendJson(200, {
                    specPath: resolved ? resolved.path : null,
                    raw: recommendation,
                    resolved: specRec.buildRecommendationPayload(recommendation),
                    ranked,
                });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        }
    },
    {
        method: 'GET',
        path: /^\/api\/feature-status\/(\d+)$/,
        handler(req, res, ctx, match) {
            const id = match[1];
            const url = new URL(req.url, `http://${req.headers.host}`);
            const repoPathHint = String(url.searchParams.get('repoPath') || '').trim();
            const entityType = String(url.searchParams.get('type') || 'feature').trim();
            const registered = ctx.routes.readConductorReposFromGlobalConfig();
            const resolvedRepo = ctx.routes.resolveDetailRepoPath(registered, {
                repoPath: repoPathHint,
                type: entityType,
                id,
            });
            if (!resolvedRepo) {
                ctx.sendJson(404, { error: 'Could not resolve repository' });
                return;
            }
            try {
                const deepStatus = ctx.routes.collectFeatureDeepStatus(resolvedRepo, id, { entityType });
                ctx.sendJson(200, deepStatus);
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        }
    },
    {
        method: 'GET',
        path: reqPath => {
            let match = reqPath.match(/^\/api\/detail\/(feature|research)\/(\d+)$/);
            if (match) return match;
            match = reqPath.match(/^\/api\/features\/(\d+)\/details$/);
            if (match) return [match[0], 'feature', match[1]];
            match = reqPath.match(/^\/api\/research\/(\d+)\/details$/);
            if (match) return [match[0], 'research', match[1]];
            return null;
        },
        handler(req, res, ctx, match) {
            const type = match[1];
            const id = match[2];
            const perfEnabled = process.env.AIGON_DASH_TIMING === '1';
            const reqStart = perfEnabled ? Date.now() : 0;
            const url = new URL(req.url, `http://${req.headers.host}`);
            const repoPathHint = String(url.searchParams.get('repoPath') || '').trim();
            const specPathHint = String(url.searchParams.get('specPath') || '').trim();
            const registered = ctx.routes.readConductorReposFromGlobalConfig();
            const resolvedRepo = ctx.routes.resolveDetailRepoPath(registered, {
                repoPath: repoPathHint,
                specPath: specPathHint,
                type,
                id
            });
            if (!resolvedRepo) {
                ctx.sendJson(404, { error: 'Could not resolve repository for detail request' });
                return;
            }
            try {
                const payload = ctx.routes.buildDetailPayload(resolvedRepo, type, id, specPathHint, {
                    onPerf(perf) {
                        if (!perfEnabled) return;
                        const stepSummary = (perf.steps || [])
                            .map(s => `${s.step}=${s.ms}ms`)
                            .join(' ');
                        ctx.helpers.log(
                            `[perf] detail ${type}#${id} total=${perf.totalMs}ms agents=${perf.agentCount} events=${perf.workflowEventCount}` +
                            (stepSummary ? ` steps: ${stepSummary}` : '')
                        );
                    },
                });
                if (perfEnabled) {
                    ctx.helpers.log(`[perf] detail-request ${type}#${id} end-to-end=${Date.now() - reqStart}ms`);
                }
                ctx.sendJson(200, payload);
            } catch (e) {
                ctx.sendJson(e.statusCode || 500, { error: e.message });
            }
        }
    },
    {
        method: 'GET',
        path: reqPath => reqPath.startsWith('/api/spec') ? [reqPath] : null,
        handler(req, res, ctx) {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const filePath = url.searchParams.get('path') || '';
            if (!filePath || !filePath.endsWith('.md') || !fs.existsSync(filePath)) {
                ctx.sendJson(400, { error: 'File not found' });
                return;
            }
            try {
                let content = fs.readFileSync(filePath, 'utf8');
                content = ctx.routes.appendDependencyGraph(filePath, content);
                ctx.sendJson(200, { content, path: filePath });
            } catch (e) {
                ctx.sendJson(500, { error: e.message });
            }
        }
    },
];
