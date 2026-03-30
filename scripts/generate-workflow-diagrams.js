#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
    FEATURE_ENGINE_STATES,
    getFeatureStageTransitions,
    getFeatureStageActions,
} = require('../lib/feature-workflow-rules');
const stateQueries = require('../lib/state-queries');

const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'generated', 'workflow');
const CARD_WIDTH = 220;
const CARD_HEIGHT = 64;
const CARD_RX = 14;
const H_GAP = 48;
const V_GAP = 120;
const ACTION_LINE_HEIGHT = 18;
const ACTION_HEADER_HEIGHT = 26;
const FONT_STACK = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function wrapText(text, maxLen = 34) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    words.forEach(word => {
        const next = current ? `${current} ${word}` : word;
        if (next.length > maxLen && current) {
            lines.push(current);
            current = word;
        } else {
            current = next;
        }
    });
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
}

function svgHeader(width, height) {
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
        '<defs>',
        '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">',
        '<path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/>',
        '</marker>',
        '</defs>',
        `<rect width="${width}" height="${height}" fill="#f8fafc"/>`,
    ].join('');
}

function renderNode(node, x, y, tone = 'state') {
    const fills = {
        state: '#ffffff',
        stage: '#fefce8',
    };
    const strokes = {
        state: '#1e293b',
        stage: '#92400e',
    };
    return [
        `<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="${CARD_RX}" fill="${fills[tone] || fills.state}" stroke="${strokes[tone] || strokes.state}" stroke-width="2"/>`,
        `<text x="${x + 16}" y="${y + 28}" font-family="${FONT_STACK}" font-size="22" font-weight="700" fill="#0f172a">${escapeXml(node)}</text>`,
    ].join('');
}

function renderActionPanel(title, items, x, y, width) {
    const height = ACTION_HEADER_HEIGHT + Math.max(items.length, 1) * ACTION_LINE_HEIGHT + 18;
    const lines = items.length > 0 ? items : ['(none)'];
    const rendered = [
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>`,
        `<text x="${x + 14}" y="${y + 20}" font-family="${FONT_STACK}" font-size="14" font-weight="700" fill="#e2e8f0">${escapeXml(title)}</text>`,
    ];
    lines.forEach((line, idx) => {
        rendered.push(`<text x="${x + 14}" y="${y + ACTION_HEADER_HEIGHT + 14 + idx * ACTION_LINE_HEIGHT}" font-family="${FONT_STACK}" font-size="13" fill="#cbd5e1">${escapeXml(line)}</text>`);
    });
    return { svg: rendered.join(''), height };
}

function renderEdge(from, to, labelLines, curved = 0) {
    const x1 = from.x + CARD_WIDTH;
    const y1 = from.y + CARD_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + CARD_HEIGHT / 2;
    const midX = (x1 + x2) / 2;
    const path = curved === 0
        ? `M ${x1} ${y1} L ${x2} ${y2}`
        : `M ${x1} ${y1} C ${midX} ${y1 + curved}, ${midX} ${y2 + curved}, ${x2} ${y2}`;
    const labelX = midX;
    const labelY = ((y1 + y2) / 2) + curved * 0.2;
    const rendered = [
        `<path d="${path}" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#arrow)"/>`,
    ];
    labelLines.forEach((line, idx) => {
        rendered.push(`<text x="${labelX}" y="${labelY - 8 + idx * 15}" text-anchor="middle" font-family="${FONT_STACK}" font-size="12" fill="#334155">${escapeXml(line)}</text>`);
    });
    return rendered.join('');
}

function renderFeatureEngineDiagram() {
    const layout = {
        hydrating: { x: 40, y: 40 },
        implementing: { x: 320, y: 40 },
        paused: { x: 600, y: 40 },
        reviewing: { x: 320, y: 220 },
        evaluating: { x: 320, y: 400 },
        ready_for_review: { x: 600, y: 400 },
        closing: { x: 880, y: 400 },
        done: { x: 1160, y: 400 },
    };
    const width = 1420;
    const height = 760;
    const pieces = [svgHeader(width, height)];
    pieces.push(`<text x="40" y="28" font-family="${FONT_STACK}" font-size="24" font-weight="700" fill="#0f172a">Aigon Feature Engine Workflow</text>`);

    Object.entries(layout).forEach(([state, pos]) => {
        pieces.push(renderNode(state, pos.x, pos.y, 'state'));
    });

    Object.entries(FEATURE_ENGINE_STATES).forEach(([state, transitions]) => {
        const from = layout[state];
        transitions.forEach((transition, index) => {
            if (transition.event === 'hydrate') return;
            const to = layout[transition.to];
            if (!to || !from) return;
            const label = [transition.event];
            if (transition.guard) label.push(`[${transition.guard}]`);
            if (transition.effect) label.push(`/${transition.effect}`);
            const curved = state === transition.to ? -80 : (index % 2 === 0 ? 0 : -24);
            pieces.push(renderEdge(from, to, label, curved));
        });
    });

    const hydrationRules = FEATURE_ENGINE_STATES.hydrating.map(rule => `${rule.guard} -> ${rule.to}`);
    const hydrationPanel = renderActionPanel('Hydration resolution', hydrationRules, 40, 140, 220);
    pieces.push(hydrationPanel.svg);

    const perStatePanels = {
        implementing: ['Optional solo review before close', 'Solo close path available when ready', 'Fleet eval path available when all ready'],
        reviewing: ['Repeat review allowed', 'Close remains available', 'Pause remains available'],
        evaluating: ['Winner selection required for fleet', 'Recovery/drop actions still available'],
        ready_for_review: ['Close triggers durable close effects'],
        closing: ['Effect runner moves spec and writes close note'],
    };
    Object.entries(perStatePanels).forEach(([state, lines]) => {
        const pos = layout[state];
        const panel = renderActionPanel('Notes', lines, pos.x, pos.y + 78, CARD_WIDTH);
        pieces.push(panel.svg);
    });

    pieces.push('</svg>');
    return pieces.join('');
}

function buildStageDiagram(title, stages, transitions, actionsByStage) {
    const width = Math.max(1200, 60 + stages.length * (CARD_WIDTH + H_GAP));
    const height = 760;
    const pieces = [svgHeader(width, height)];
    pieces.push(`<text x="40" y="30" font-family="${FONT_STACK}" font-size="24" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>`);
    const positions = {};
    stages.forEach((stage, idx) => {
        positions[stage] = { x: 40 + idx * (CARD_WIDTH + H_GAP), y: 60 };
        pieces.push(renderNode(stage, positions[stage].x, positions[stage].y, 'stage'));
    });

    transitions.forEach((transition, index) => {
        const from = positions[transition.from];
        const to = positions[transition.to];
        if (!from || !to) return;
        const label = [transition.action];
        if (transition.guardName) label.push(`[${transition.guardName}]`);
        if (transition.requiresInput) label.push(`input:${transition.requiresInput}`);
        pieces.push(renderEdge(from, to, label, index % 2 === 0 ? 0 : -18));
    });

    stages.forEach((stage) => {
        const stageActions = (actionsByStage[stage] || []).map((action) => {
            const extras = [
                action.perAgent ? 'per-agent' : null,
                action.guardName ? `[${action.guardName}]` : null,
                action.requiresInput ? `input:${action.requiresInput}` : null,
            ].filter(Boolean);
            return `${action.action}${extras.length ? ` ${extras.join(' ')}` : ''}`;
        });
        const panel = renderActionPanel('Available actions', stageActions, positions[stage].x, 180, CARD_WIDTH);
        pieces.push(panel.svg);
    });

    pieces.push('</svg>');
    return pieces.join('');
}

function groupByStage(actions) {
    return actions.reduce((acc, action) => {
        if (!acc[action.stage]) acc[action.stage] = [];
        acc[action.stage].push(action);
        return acc;
    }, {});
}

function buildArtifacts() {
    return {
        'feature-engine.svg': renderFeatureEngineDiagram(),
        'feature-readside.svg': buildStageDiagram(
            'Aigon Feature Read-Side Workflow',
            stateQueries.FEATURE_STAGES,
            getFeatureStageTransitions(),
            groupByStage(getFeatureStageActions()),
        ),
        'research-readside.svg': buildStageDiagram(
            'Aigon Research Workflow',
            stateQueries.RESEARCH_STAGES,
            stateQueries.RESEARCH_TRANSITIONS.map((transition) => ({
                from: transition.from,
                to: transition.to,
                action: transition.action,
                guardName: transition.guard && transition.guard.name ? transition.guard.name : null,
                requiresInput: transition.requiresInput || null,
            })),
            groupByStage(stateQueries.RESEARCH_ACTIONS.map((action) => ({
                stage: action.stage,
                action: action.action,
                perAgent: action.perAgent,
                requiresInput: action.requiresInput || null,
                guardName: action.guard && action.guard.name ? action.guard.name : null,
            }))),
        ),
        'feedback-readside.svg': buildStageDiagram(
            'Aigon Feedback Workflow',
            stateQueries.FEEDBACK_STAGES,
            stateQueries.FEEDBACK_TRANSITIONS.map((transition) => ({
                from: transition.from,
                to: transition.to,
                action: transition.action,
                guardName: transition.guard && transition.guard.name ? transition.guard.name : null,
                requiresInput: transition.requiresInput || null,
            })),
            groupByStage([]),
        ),
    };
}

function main() {
    const check = process.argv.includes('--check');
    ensureDir(OUTPUT_DIR);
    const artifacts = buildArtifacts();
    const stale = [];

    Object.entries(artifacts).forEach(([fileName, content]) => {
        const outputPath = path.join(OUTPUT_DIR, fileName);
        if (check) {
            const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
            if (current !== content) stale.push(fileName);
            return;
        }
        fs.writeFileSync(outputPath, content);
        process.stdout.write(`generated ${path.relative(process.cwd(), outputPath)}\n`);
    });

    if (check && stale.length > 0) {
        process.stderr.write(`Workflow diagrams are stale: ${stale.join(', ')}\n`);
        process.stderr.write('Run: node scripts/generate-workflow-diagrams.js\n');
        process.exit(1);
    }
}

main();
