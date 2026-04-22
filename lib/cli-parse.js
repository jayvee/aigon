'use strict';

function slugify(value) {
    const text = String(value || '').trim().toLowerCase();
    const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug || 'untitled';
}

function parseCliOptions(args) {
    const options = { _: [] };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) {
            options._.push(arg);
            continue;
        }

        const eqIndex = arg.indexOf('=');
        let key;
        let value;

        if (eqIndex !== -1) {
            key = arg.slice(2, eqIndex);
            value = arg.slice(eqIndex + 1);
        } else {
            key = arg.slice(2);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('--')) {
                value = nextArg;
                i++;
            } else {
                value = true;
            }
        }

        if (options[key] === undefined) {
            options[key] = value;
        } else if (Array.isArray(options[key])) {
            options[key].push(value);
        } else {
            options[key] = [options[key], value];
        }
    }

    return options;
}

function getOptionValue(options, key) {
    const value = options[key];
    if (Array.isArray(value)) {
        return value[value.length - 1];
    }
    return value;
}

function getOptionValues(options, key) {
    const value = options[key];
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

/**
 * Parse an `agentId=value,agentId=value` string into a plain object. Accepts
 * either a single string or a multi-value array (e.g. `--models cc=x
 * --models cx=y`). An entry whose value is "none" or empty is treated as an
 * explicit null (clears any workflow-stage default). Unknown/garbled pairs
 * are silently dropped.
 */
function parseAgentOverrideMap(raw) {
    if (raw === undefined || raw === null) return {};
    const values = Array.isArray(raw) ? raw : [raw];
    const out = {};
    for (const entry of values) {
        if (typeof entry !== 'string') continue;
        for (const pair of entry.split(',')) {
            const [rawKey, ...rest] = pair.split('=');
            if (!rawKey || rest.length === 0) continue;
            const key = rawKey.trim();
            const value = rest.join('=').trim();
            if (!key) continue;
            if (!value || value.toLowerCase() === 'none' || value.toLowerCase() === 'null') {
                out[key] = null;
                continue;
            }
            out[key] = value;
        }
    }
    return out;
}

function parseNumericArray(value) {
    if (value === undefined || value === null) return [];
    const values = Array.isArray(value) ? value : [value];
    const parsed = values
        .map(v => parseInt(v, 10))
        .filter(v => Number.isFinite(v) && v > 0);
    return [...new Set(parsed)];
}

function stripInlineYamlComment(value) {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === '\'' && !inSingle) {
            inSingle = !inSingle;
            continue;
        }
        if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
            return value.slice(0, i).trimEnd();
        }
    }

    return value.trimEnd();
}

function splitInlineYamlArray(value) {
    const parts = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            current += ch;
            continue;
        }
        if (ch === '\'' && !inDouble) {
            inSingle = !inSingle;
            current += ch;
            continue;
        }
        if (ch === ',' && !inSingle && !inDouble) {
            parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }

    if (current.trim()) {
        parts.push(current.trim());
    }
    return parts;
}

function parseYamlScalar(rawValue) {
    const value = stripInlineYamlComment(String(rawValue)).trim();
    if (value === '') return '';

    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        } catch (e) {
            return value.slice(1, -1);
        }
    }
    if (value.startsWith('\'') && value.endsWith('\'')) {
        return value.slice(1, -1).replace(/\\'/g, '\'');
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];
        return splitInlineYamlArray(inner).map(parseYamlScalar);
    }
    if (value.startsWith('{') && value.endsWith('}')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) return {};
        const obj = {};
        splitInlineYamlArray(inner).forEach(pair => {
            const kv = pair.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
            if (kv) obj[kv[1]] = parseYamlScalar(kv[2]);
        });
        return obj;
    }
    return value;
}

function parseFrontMatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) {
        return { data: {}, body: content, hasFrontMatter: false };
    }

    const data = {};
    let currentObjectKey = null;
    const rawFrontMatter = match[1];

    rawFrontMatter.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const indent = (line.match(/^\s*/) || [''])[0].length;

        // Handle YAML list items (- value) under a parent key
        const listMatch = trimmed.match(/^-\s+(.+)$/);
        if (listMatch && indent > 0 && currentObjectKey) {
            // Convert object to array on first list item
            if (!Array.isArray(data[currentObjectKey])) {
                data[currentObjectKey] = [];
            }
            data[currentObjectKey].push(parseYamlScalar(listMatch[1]));
            return;
        }

        const kvMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!kvMatch) return;
        const [, key, rawValue] = kvMatch;

        if (indent === 0) {
            if (rawValue === '') {
                data[key] = {};
                currentObjectKey = key;
            } else {
                data[key] = parseYamlScalar(rawValue);
                currentObjectKey = null;
            }
            return;
        }

        if (currentObjectKey &&
            typeof data[currentObjectKey] === 'object' &&
            !Array.isArray(data[currentObjectKey])) {
            data[currentObjectKey][key] = parseYamlScalar(rawValue);
        }
    });

    const body = content.slice(match[0].length);
    return { data, body, hasFrontMatter: true };
}

function serializeYamlScalar(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
        return `[${value.map(v => serializeYamlScalar(v)).join(', ')}]`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return JSON.stringify(String(value));
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMarkdownSection(body, heading) {
    const sectionRegex = new RegExp(
        `^##\\s+${escapeRegex(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`,
        'im'
    );
    const match = body.match(sectionRegex);
    if (!match) return '';
    return match[1]
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    slugify,
    parseCliOptions,
    getOptionValue,
    getOptionValues,
    parseAgentOverrideMap,
    parseNumericArray,
    stripInlineYamlComment,
    splitInlineYamlArray,
    parseYamlScalar,
    parseFrontMatter,
    serializeYamlScalar,
    escapeRegex,
    extractMarkdownSection,
};
