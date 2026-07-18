'use strict';

const fs = require('fs');
const path = require('path');
const {
    scanText,
    flattenPlaceholderStrings,
    isInstructionArtifactPath,
} = require('./template-leak-rules');

const ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'templates');
const SCAN_DIRS = ['generic', 'docs', 'specs', 'prompts', 'sections'];
const AGENTS_DIR = path.join(TEMPLATES, 'agents');
const FILE_EXCEPTIONS = new Set();

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile()) out.push(full);
    }
    return out;
}

function scanFile(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    return scanText(text, { file: filePath, allowSuppression: true });
}

function collectTemplateSourceFiles() {
    const files = [];
    for (const sub of SCAN_DIRS) files.push(...walk(path.join(TEMPLATES, sub)));
    return files.filter((f) => {
        const relFromTemplates = path.relative(TEMPLATES, f);
        return !FILE_EXCEPTIONS.has(relFromTemplates);
    });
}

function scanTemplateSourceFiles() {
    const findings = [];
    for (const file of collectTemplateSourceFiles()) {
        findings.push(...scanFile(file));
    }
    return findings;
}

function scanAgentPlaceholderFiles(agentsDir = AGENTS_DIR) {
    const findings = [];
    if (!fs.existsSync(agentsDir)) return findings;
    for (const file of fs.readdirSync(agentsDir).filter((f) => f.endsWith('.json'))) {
        const filePath = path.join(agentsDir, file);
        let config;
        try {
            config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (_) {
            continue;
        }
        const rel = path.relative(ROOT, filePath);
        for (const { key, value } of flattenPlaceholderStrings(config.placeholders || {})) {
            const keyFindings = scanText(value, {
                file: rel,
                allowSuppression: false,
                placeholderKey: key,
            });
            for (const finding of keyFindings) {
                findings.push({ ...finding, placeholderKey: key });
            }
        }
    }
    return findings;
}

/**
 * Scan manifest-tracked instruction artifacts under repoRoot.
 * Every path is resolved and verified to stay inside repoRoot.
 */
function scanRenderedManifestFiles(repoRoot, manifest) {
    const findings = [];
    const root = path.resolve(repoRoot);
    const files = Array.isArray(manifest?.files) ? manifest.files : [];
    for (const entry of files) {
        const rel = String(entry.path || '').replace(/\\/g, '/');
        if (!rel || !isInstructionArtifactPath(rel)) continue;
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root + path.sep) && abs !== root) continue;
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        findings.push(...scanFile(abs).map((f) => ({ ...f, file: rel })));
    }
    return findings;
}

function formatFinding(f, root = ROOT) {
    const rel = path.isAbsolute(f.file) ? path.relative(root, f.file) : f.file;
    const keyPart = f.placeholderKey ? ` placeholder=${f.placeholderKey}` : '';
    return `  ${rel}:${f.lineNo}${keyPart}\n    matched: "${f.match}"  (${f.label})\n    line:    ${f.line}`;
}

function runStaticScan() {
    const sourceFindings = scanTemplateSourceFiles();
    const placeholderFindings = scanAgentPlaceholderFiles();
    return { sourceFindings, placeholderFindings, allFindings: [...sourceFindings, ...placeholderFindings] };
}

module.exports = {
    ROOT,
    TEMPLATES,
    SCAN_DIRS,
    AGENTS_DIR,
    collectTemplateSourceFiles,
    scanTemplateSourceFiles,
    scanAgentPlaceholderFiles,
    scanRenderedManifestFiles,
    formatFinding,
    runStaticScan,
};
