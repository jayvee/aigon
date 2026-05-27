'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { spawnSync } = require('child_process');

const seedReset = require('./setup/seed-reset');

const DEFAULT_STALENESS_DAYS = { gg: 30, op: 30, cc: 60, cx: 60 };
const AGENTS_DIR = path.join(__dirname, '..', '..', 'templates', 'agents');

// --- Helpers ---

function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = new URL(url);
        const req = https.get({
            hostname: options.hostname,
            path: options.pathname + options.search,
            headers: { 'User-Agent': 'aigon-bench-refresh/1.0', ...headers },
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(30_000, () => { req.destroy(new Error('Request timed out')); });
    });
}

function loadAgentJson(agentId) {
    const fpath = path.join(AGENTS_DIR, `${agentId}.json`);
    if (!fs.existsSync(fpath)) return null;
    try { return JSON.parse(fs.readFileSync(fpath, 'utf8')); } catch (_) { return null; }
}

function saveAgentJson(agentId, data) {
    const fpath = path.join(AGENTS_DIR, `${agentId}.json`);
    fs.writeFileSync(fpath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getModelOptions(agentData) {
    return Array.isArray(agentData?.cli?.modelOptions) ? agentData.cli.modelOptions : [];
}

function existingValues(modelOptions) {
    return new Set(modelOptions.map(o => o.value).filter(Boolean));
}

/** Load project config for benchRefresh overrides. */
function loadBenchRefreshConfig(repoPath) {
    const cfgPath = path.join(repoPath, '.aigon', 'config.json');
    if (!fs.existsSync(cfgPath)) return {};
    try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')).benchRefresh || {}; } catch (_) { return {}; }
}

// --- Model discovery ---

/**
 * op registry IDs are stored as "openrouter/{provider}/{model}".
 * OpenRouter API returns bare "{provider}/{model}".
 * These helpers translate between the two forms.
 */
function opApiIdToRegistryId(apiId) { return `openrouter/${apiId}`; }
function opRegistryIdToApiId(registryId) { return registryId.replace(/^openrouter\//, ''); }

/** Get op provider prefixes (in API format, without "openrouter/" prefix). */
function getOpProviderPrefixes(modelOptions, configPrefixes) {
    if (configPrefixes && configPrefixes.length > 0) return configPrefixes;
    const prefixSet = new Set();
    for (const opt of modelOptions) {
        if (!opt.value) continue;
        // Registry value: "openrouter/deepseek/model" → API prefix "deepseek"
        const apiId = opRegistryIdToApiId(opt.value);
        const parts = apiId.split('/');
        if (parts.length >= 2) prefixSet.add(parts[0]);
    }
    return Array.from(prefixSet);
}

/**
 * Discover new op (OpenRouter) models. Returns full API data for each candidate.
 * Fixed: correctly accounts for the "openrouter/" registry prefix vs bare OR API IDs.
 */
async function discoverOpModels(modelOptions, config) {
    const prefixes = getOpProviderPrefixes(modelOptions, config.opProviderPrefixes || []);
    // Existing values in API format for dedup
    const existingApiIds = new Set(
        [...existingValues(modelOptions)].map(opRegistryIdToApiId)
    );

    let data;
    try {
        data = await httpsGet('https://openrouter.ai/api/v1/models');
    } catch (err) {
        process.stdout.write(`⚠️  OpenRouter fetch failed: ${err.message}\n`);
        return [];
    }

    const raw = (data.data || []).filter(m => {
        if (!m.id) return false;
        if (existingApiIds.has(m.id)) return false;
        // Require tool-use support for agentic coding loops
        if (!Array.isArray(m.supported_parameters) || !m.supported_parameters.includes('tools')) return false;
        // Skip free-tier variants — rate-limited, unsuitable for sustained loops
        if (m.id.endsWith(':free')) return false;
        const provider = m.id.split('/')[0];
        return prefixes.includes(provider);
    }).map(m => {
        const pIn = m.pricing ? parseFloat(m.pricing.prompt) * 1e6 : null;
        const pOut = m.pricing ? parseFloat(m.pricing.completion) * 1e6 : null;
        return {
            value: opApiIdToRegistryId(m.id),
            label: m.name || m.id,
            pricing: (pIn != null && pOut != null) ? { input: pIn, output: pOut } : null,
            apiData: m,
        };
    });

    // Policy: apply modality/domain filter at discovery so every caller
    // (interactive, non-interactive, future) sees an already-cleaned list.
    // See docs/model-inclusion-policy.md §1.
    return filterRelevantCandidates('op', raw);
}

async function discoverGgModels(modelOptions) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        process.stdout.write(`⚠️  GEMINI_API_KEY not set — skipping Gemini model discovery\n`);
        return [];
    }
    const existing = existingValues(modelOptions);

    let data;
    try {
        data = await httpsGet(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
    } catch (err) {
        process.stdout.write(`⚠️  Gemini API fetch failed: ${err.message}\n`);
        return [];
    }

    const candidates = (data.models || []).filter(m => {
        if (!m.name || !m.name.startsWith('models/gemini-')) return false;
        if (!Array.isArray(m.supportedGenerationMethods) || !m.supportedGenerationMethods.includes('generateContent')) return false;
        const value = m.name.replace(/^models\//, '');
        return !existing.has(value);
    });

    const raw = candidates.map(m => ({
        value: m.name.replace(/^models\//, ''),
        label: m.displayName || m.name.replace(/^models\//, ''),
        pricing: null,
        apiData: m,
    }));

    // Policy: apply modality/domain filter at discovery so every caller
    // (interactive, non-interactive, future) sees an already-cleaned list.
    // See docs/model-inclusion-policy.md §1.
    return filterRelevantCandidates('gg', raw);
}

// --- Model assessment ---
//
// Inclusion policy lives in docs/model-inclusion-policy.md. Two helpers:
//
//   isIrrelevantForCoding(model)  — modality / domain match (TTS, robotics,
//     image gen, computer-use, version aliases). Hard rejection at discovery.
//
//   assessModel(agentId, model)   — derives suitability flags from metadata
//     (thinking mode, tiny params, expensive output). Soft signals shown to
//     the human on the approval prompt.
//
// Both must stay in sync with docs/model-inclusion-policy.md §1 + §2.

/**
 * Classify a model as irrelevant for agentic coding (TTS, VL-only, robotics, etc.).
 * Returns true if the model should be filtered out before showing to the user.
 */
function isIrrelevantForCoding(model) {
    const id = (model.apiData?.id || model.value || '').toLowerCase();
    // Speech / audio modality
    if (/-tts\b|tts-preview|speech|audio|voice|voxtral/.test(id)) return true;
    // Robotics and computer-use — non-coding agentic categories
    if (/robotics|computer-use/.test(id)) return true;
    // Vision-language variants: explicit -vl- segment or v-suffix on model name
    if (/-vl-|-vl$|vl-max|vl-plus|flash-image|pro-image/.test(id)) return true;
    // Provider-specific vision suffixes: glm-*v models (z-ai)
    if (/\/(glm-[0-9.]+v(-|$))/.test(id)) return true;
    // Image generation/preview models
    if (/-image\b|-image-preview/.test(id)) return true;
    // Alias / "latest" pointers — too vague for benchmarking
    if (/-(latest|current)\b/.test(id)) return true;
    // Superseded Gemini 2.0 lite / experimental
    if (/gemini-2\.0-flash-lite\b/.test(id)) return true;
    // Llama 3.1 — superseded by 3.3 and 4 on OpenRouter
    if (/llama-3\.1-\d/.test(id)) return true;
    // Older Qwen2.5 and non-coding Qwen variants
    if (/qwen-2\.5-\d|qwen-turbo\b|qwen-vl\b|qwen-vl-/.test(id)) return true;
    // Ancient Mistral models superseded by their successors
    if (/mistral-nemo\b|mixtral-8x22b|mistral-large-2407|pixtral-large|mistral-large\b$/.test(id)) return true;
    // Single-digit-B (non-MoE) parameter counts — policy §1 hard exclusion.
    // Empirically too weak for multi-file agentic coding; MoE/active-param
    // models keep their full param count in the ID (e.g. -a3b for MoE) and
    // those are filtered back in by the !/-a\d/ guard.
    if (/\b[1-9]b(-|$)/.test(id) && !/\d{2,}b/.test(id) && !/-a\d/.test(id)) return true;
    return false;
}

/**
 * Suitability flags derived from model metadata without calling an LLM.
 * Returns { suitable: bool, risk: string|null, autoExclude: bool, notes: string }.
 * autoExclude: true means it failed the relevance filter and won't be shown to user.
 */
function assessModel(agentId, model) {
    const id = (model.apiData?.id || model.value || '').toLowerCase();
    const name = (model.label || '').toLowerCase();
    const ctx = model.apiData?.context_length || model.apiData?.top_provider?.context_length || null;
    const pIn = model.pricing?.input ?? null;
    const pOut = model.pricing?.output ?? null;

    if (isIrrelevantForCoding(model)) {
        return { suitable: false, autoExclude: true, risk: 'irrelevant modality (TTS/VL/robotics/computer-use)', notes: '' };
    }

    const risks = [];
    const highlights = [];

    // Reasoning/thinking mode — token runaway on agentic loops
    if (/:thinking$|thinking-\d|thinking-2507|-r1\b|deepseek-r1/.test(id) || /thinking/.test(name)) {
        risks.push('thinking-mode token runaway (agentic loops rarely complete within timeout)');
    }

    // (Single-digit-B param count is now a hard exclusion at discovery — see
    // isIrrelevantForCoding. Never reaches this code path.)

    // Expensive output cost — drain risk from hung sessions
    if (pOut !== null && pOut > 5.0) {
        risks.push(`high output cost ($${pOut.toFixed(2)}/MTok) — hung sessions will drain credits fast`);
    }

    // Code-specialist signals (positive)
    if (/coder|codestral|devstral|starcoder|code-?fast/.test(id)) {
        highlights.push('code-specialist');
    }

    // Large context (positive)
    if (ctx && ctx >= 128_000) {
        highlights.push(`${Math.round(ctx / 1000)}K ctx`);
    }

    const suitable = risks.length === 0;
    const risk = risks.length > 0 ? risks.join('; ') : null;
    const desc = model.apiData?.description;
    const noteParts = [];
    if (highlights.length) noteParts.push(highlights.join(', '));
    if (pIn !== null && pOut !== null) noteParts.push(`$${pIn.toFixed(2)}/$${pOut.toFixed(2)} per MTok`);
    if (desc) noteParts.push(desc.slice(0, 120).replace(/\s+/g, ' ').trim());
    if (risk) noteParts.push(`⚠️  ${risk}`);

    return {
        suitable,
        autoExclude: false,
        risk,
        notes: noteParts.join('. ') || `New ${agentId} model; probe before benchmarking.`,
    };
}

/**
 * Apply the modality / domain filter at discovery time.
 * Returns the kept candidates and logs a one-line notice for any that were dropped.
 * Used by both discoverGgModels and discoverOpModels so every caller — including
 * non-interactive perf-bench runs — sees an already-cleaned candidate list.
 *
 * @param {string} agentId
 * @param {Array<object>} candidates
 * @returns {Array<object>} relevant candidates
 */
function filterRelevantCandidates(agentId, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const kept = [];
    const dropped = [];
    for (const m of candidates) {
        if (isIrrelevantForCoding(m)) dropped.push(m);
        else kept.push(m);
    }
    if (dropped.length > 0) {
        process.stdout.write(`   (filtered ${dropped.length} non-coding model(s) at discovery: TTS/robotics/image/computer-use/-latest aliases)\n`);
    }
    return kept;
}

// --- Pending-models queue (.aigon/pending-models.json) ---
//
// Non-interactive contexts (scheduled jobs, perf-bench discovery, CI) never
// write to templates/agents/<id>.json directly. They append candidates here.
// A human runs `aigon model-refresh --approve-pending` to drain the queue
// through the interactive prompt. See docs/model-inclusion-policy.md §6.

function pendingModelsPath(repoPath) {
    return path.join(repoPath, '.aigon', 'pending-models.json');
}

function readPendingModels(repoPath) {
    const fpath = pendingModelsPath(repoPath);
    if (!fs.existsSync(fpath)) return { queue: [] };
    try {
        const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
        if (!Array.isArray(data.queue)) data.queue = [];
        return data;
    } catch (_) {
        return { queue: [] };
    }
}

function writePendingModels(repoPath, data) {
    const fpath = pendingModelsPath(repoPath);
    fs.mkdirSync(path.dirname(fpath), { recursive: true });
    fs.writeFileSync(fpath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Append discovered candidates to the pending queue.
 * Dedups by `agentId + value`. Returns the count actually appended.
 * Candidates here have already passed isIrrelevantForCoding (the discovery
 * functions enforce that); assessment metadata is recomputed at approval time.
 *
 * We strip the full `apiData` blob (large, provider-specific) but persist the
 * couple of fields assessModel actually reads — context_length and the
 * normalised `id` — so `--approve-pending` produces the same highlights /
 * risks the interactive prompt would have shown at discovery time.
 */
function appendToPendingQueue(repoPath, agentId, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return 0;
    const data = readPendingModels(repoPath);
    const existing = new Set(data.queue.map(e => `${e.agentId}::${e.value}`));
    const now = new Date().toISOString();
    let added = 0;
    for (const c of candidates) {
        const key = `${agentId}::${c.value}`;
        if (existing.has(key)) continue;
        const ctxLen = c.apiData?.context_length || c.apiData?.top_provider?.context_length || null;
        const apiId = c.apiData?.id || null;
        data.queue.push({
            agentId,
            value: c.value,
            label: c.label,
            pricing: c.pricing || null,
            // Minimal apiData footprint — only the fields assessModel reads.
            // Avoids the discover-vs-approve assessment drift Gemini flagged.
            apiData: (ctxLen || apiId) ? { id: apiId, context_length: ctxLen } : null,
            discoveredAt: now,
        });
        existing.add(key);
        added++;
    }
    writePendingModels(repoPath, data);
    return added;
}

// --- Interactive approval ---

function askLine(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
    });
}

function fmtPricing(pricing) {
    if (!pricing) return 'unknown pricing';
    return `$${pricing.input.toFixed(2)}/$${pricing.output.toFixed(2)} per MTok in/out`;
}

/**
 * Present candidates interactively. Discovery has already applied the
 * modality filter (isIrrelevantForCoding) — every candidate here is reviewable.
 *
 * Non-interactive callers MUST NOT use this prompt — they should route
 * candidates to the pending-models queue via appendToPendingQueue instead.
 * Calling this with `nonInteractive: true` returns an empty array and
 * prints a "queue it" hint. See docs/model-inclusion-policy.md §6.
 */
async function promptIncludeExclude(agentId, candidates, opts = {}) {
    const { nonInteractive = false } = opts;

    if (candidates.length === 0) return [];

    // Defense in depth: discovery should have stripped these, but if a caller
    // hands us a raw list, drop irrelevant modality entries before assessing.
    const relevant = candidates.filter(m => !isIrrelevantForCoding(m));
    const droppedCount = candidates.length - relevant.length;
    if (droppedCount > 0) {
        process.stdout.write(`   (filtered ${droppedCount} non-coding model(s) at approval boundary — discovery should have caught these)\n`);
    }
    if (relevant.length === 0) return [];

    const assessed = relevant.map(m => ({ ...m, _a: assessModel(agentId, m) }));
    const suitable = assessed.filter(m => m._a.suitable);
    const risky = assessed.filter(m => !m._a.suitable);

    process.stdout.write(`   ${assessed.length} candidate(s) to review: ${suitable.length} ✅  ${risky.length} ⚠️\n`);

    if (nonInteractive) {
        // Policy §6: never auto-approve. Caller is responsible for queuing.
        process.stdout.write(`   ⚠️  non-interactive mode — no models added. Run 'aigon model-refresh --approve-pending' to review the queue.\n`);
        return [];
    }

    const approved = [];
    // Inline assignments below preserve the existing `reviewable` variable name
    // used by the rest of the function body.
    const reviewable = assessed;

    // Interactive: bulk-approve prompt first
    if (suitable.length > 1) {
        process.stdout.write(`\n   ${suitable.length} ✅ suitable model(s) found.\n`);
        const bulk = await askLine(`   Bulk-approve all ✅ suitable models and only review ⚠️ risky ones? [Y/n] `);
        if (bulk === '' || bulk.toLowerCase().startsWith('y')) {
            for (const m of suitable) approved.push({ ...m, autoNotes: m._a.notes });
            process.stdout.write(`   ✅ Bulk-approved ${suitable.length} model(s).\n`);

            // Only show risky ones individually
            for (const m of risky) {
                process.stdout.write(`\n⚠️  ${m.label}\n`);
                process.stdout.write(`   ID:    ${m.value}\n`);
                process.stdout.write(`   Price: ${fmtPricing(m.pricing)}\n`);
                process.stdout.write(`   Notes: ${m._a.notes}\n`);
                const answer = await askLine(`   Include anyway? [y/N] `);
                if (answer.toLowerCase().startsWith('y')) approved.push({ ...m, autoNotes: m._a.notes });
            }
            return approved;
        }
    }

    // Per-model review
    for (const m of reviewable) {
        const suitTag = m._a.suitable ? '✅' : '⚠️ ';
        process.stdout.write(`\n${suitTag} ${m.label}\n`);
        process.stdout.write(`   ID:    ${m.value}\n`);
        process.stdout.write(`   Price: ${fmtPricing(m.pricing)}\n`);
        process.stdout.write(`   Notes: ${m._a.notes}\n`);
        const defaultAnswer = m._a.suitable ? 'y' : 'n';
        const answer = await askLine(`   Include? [y/n, default=${defaultAnswer}] `);
        const include = answer === '' ? defaultAnswer === 'y' : answer.toLowerCase().startsWith('y');
        if (include) approved.push({ ...m, autoNotes: m._a.notes });
    }
    return approved;
}

// --- model-refresh command ---
//
// Three modes:
//   (no flag)            discover candidates from providers, interactive approval,
//                        write approved models directly into templates/agents/<id>.json
//   --dry-run            discover and print, write nothing (no pending queue write)
//   --approve-pending    drain .aigon/pending-models.json through the interactive prompt
//   --non-interactive    discover candidates and write them to the pending queue.
//                        Never auto-approves. (Policy §6.)
//
// See docs/model-inclusion-policy.md for the full contract.

async function modelRefresh(rawArgs) {
    const args = rawArgs || [];
    const nonInteractive = args.includes('--non-interactive');
    const isDryRun = args.includes('--dry-run');
    const isApprovePending = args.includes('--approve-pending');
    const agentFilter = args.includes('--agents')
        ? args[args.indexOf('--agents') + 1].split(',').map(s => s.trim())
        : [];
    const repoPath = process.cwd();

    // --- Mode: approve queued pending models ---
    if (isApprovePending) {
        return modelRefreshApprovePending(repoPath, { agentFilter });
    }

    process.stdout.write('\n🔍  Probing providers for new models…\n');

    const results = {}; // agentId → { added: [], queued: [], skipped: [] }

    // --- op (OpenRouter) ---
    if (agentFilter.length === 0 || agentFilter.includes('op')) {
        const opData = loadAgentJson('op');
        if (opData) {
            const opOptions = getModelOptions(opData);
            const benchConfig = loadBenchRefreshConfig(repoPath);
            process.stdout.write('\nop (OpenRouter)\n');
            const candidates = await discoverOpModels(opOptions, benchConfig);
            process.stdout.write(`   ${candidates.length} new candidate(s) after policy filter\n`);

            results.op = { added: [], queued: [], skipped: [] };

            if (candidates.length === 0) {
                // nothing to do
            } else if (isDryRun) {
                for (const c of candidates) {
                    const a = assessModel('op', c);
                    process.stdout.write(`   + ${c.value}  (${fmtPricing(c.pricing)})  ${a.suitable ? '✅' : '⚠️ '}\n`);
                }
            } else if (nonInteractive) {
                // Policy §6: write to pending, do not modify agent JSON.
                const queued = appendToPendingQueue(repoPath, 'op', candidates);
                results.op.queued = candidates.slice(0, queued);
                process.stdout.write(`   📥 queued ${queued} candidate(s) → ${pendingModelsPath(repoPath)}\n`);
            } else {
                const approved = await promptIncludeExclude('op', candidates, { nonInteractive });
                results.op.added = approved;
                results.op.skipped = candidates.filter(c => !approved.includes(c));
                for (const m of approved) {
                    opData.cli.modelOptions.push(buildRegistryEntry(m));
                }
                if (approved.length > 0) saveAgentJson('op', opData);
            }
        }
    }

    // --- gg (Gemini) ---
    if (agentFilter.length === 0 || agentFilter.includes('gg')) {
        const ggData = loadAgentJson('gg');
        if (ggData) {
            const ggOptions = getModelOptions(ggData);
            process.stdout.write('\ngg (Gemini)\n');
            const candidates = await discoverGgModels(ggOptions);
            process.stdout.write(`   ${candidates.length} new candidate(s) after policy filter\n`);

            results.gg = { added: [], queued: [], skipped: [] };

            if (candidates.length === 0) {
                // nothing to do
            } else if (isDryRun) {
                for (const c of candidates) {
                    const a = assessModel('gg', c);
                    process.stdout.write(`   + ${c.value}  ${a.suitable ? '✅' : '⚠️ '}\n`);
                }
            } else if (nonInteractive) {
                const queued = appendToPendingQueue(repoPath, 'gg', candidates);
                results.gg.queued = candidates.slice(0, queued);
                process.stdout.write(`   📥 queued ${queued} candidate(s) → ${pendingModelsPath(repoPath)}\n`);
            } else {
                const approved = await promptIncludeExclude('gg', candidates, { nonInteractive });
                results.gg.added = approved;
                results.gg.skipped = candidates.filter(c => !approved.includes(c));
                for (const m of approved) {
                    ggData.cli.modelOptions.push(buildRegistryEntry(m));
                }
                if (approved.length > 0) saveAgentJson('gg', ggData);
            }
        }
    }

    // --- Summary ---
    process.stdout.write('\n');
    const totalAdded = Object.values(results).reduce((n, r) => n + r.added.length, 0);
    const totalQueued = Object.values(results).reduce((n, r) => n + r.queued.length, 0);
    const totalSkipped = Object.values(results).reduce((n, r) => n + r.skipped.length, 0);

    if (isDryRun) {
        process.stdout.write('ℹ️  Dry run — no changes written.\n');
        return;
    }

    if (totalAdded > 0) {
        process.stdout.write(`✅ Added ${totalAdded} model(s) to registry. They will be picked up by the next 'aigon perf-bench --all' run.\n`);
        if (totalSkipped > 0) process.stdout.write(`   Skipped ${totalSkipped} model(s).\n`);
        process.stdout.write('\nRemember to restart the dashboard: aigon server restart\n');
    } else if (totalQueued > 0) {
        process.stdout.write(`📥 Queued ${totalQueued} candidate(s) for review.\n`);
        process.stdout.write(`   Run 'aigon model-refresh --approve-pending' from a terminal to drain the queue.\n`);
    } else if (totalSkipped > 0) {
        process.stdout.write(`ℹ️  No models added. ${totalSkipped} candidate(s) skipped.\n`);
    } else {
        process.stdout.write('✅ All providers up to date — no new candidates found.\n');
    }
}

/**
 * Drain the pending-models queue interactively. Used by --approve-pending mode
 * and by perf-bench discovery (which only writes to pending, never to agent JSON).
 * See docs/model-inclusion-policy.md §6.
 */
async function modelRefreshApprovePending(repoPath, { agentFilter = [] } = {}) {
    const pending = readPendingModels(repoPath);
    const queue = pending.queue || [];
    if (queue.length === 0) {
        process.stdout.write(`✅ Pending queue is empty (${pendingModelsPath(repoPath)})\n`);
        return;
    }

    // Group by agentId
    const byAgent = {};
    for (const entry of queue) {
        const aid = entry.agentId;
        if (agentFilter.length > 0 && !agentFilter.includes(aid)) continue;
        if (!byAgent[aid]) byAgent[aid] = [];
        byAgent[aid].push(entry);
    }

    if (Object.keys(byAgent).length === 0) {
        process.stdout.write(`ℹ️  Queue has ${queue.length} entries but none match --agents filter.\n`);
        return;
    }

    process.stdout.write(`\n📥 Draining pending queue — ${queue.length} total candidate(s)\n`);

    const remaining = []; // entries we couldn't process (agentJson missing) or rejected
    for (const [agentId, entries] of Object.entries(byAgent)) {
        const agentData = loadAgentJson(agentId);
        if (!agentData) {
            process.stdout.write(`\n⚠️  ${agentId}: agent JSON not found — leaving ${entries.length} entry(ies) in queue\n`);
            remaining.push(...entries);
            continue;
        }
        const existing = new Set((agentData.cli?.modelOptions || []).map(o => o.value).filter(Boolean));
        const fresh = entries.filter(e => !existing.has(e.value));
        const alreadyAdded = entries.filter(e => existing.has(e.value));
        if (alreadyAdded.length > 0) {
            process.stdout.write(`   (${alreadyAdded.length} already in ${agentId}.json — dropping from queue)\n`);
        }

        process.stdout.write(`\n${agentId} — ${fresh.length} candidate(s) to review\n`);
        const approved = await promptIncludeExclude(agentId, fresh, { nonInteractive: false });
        for (const m of approved) {
            agentData.cli.modelOptions.push(buildRegistryEntry(m));
        }
        if (approved.length > 0) saveAgentJson(agentId, agentData);

        // Rejected entries stay in queue with a `rejectedAt` so a human can
        // see they've been considered. A future flag (--clear-rejected) can
        // drop them once truly settled.
        const approvedValues = new Set(approved.map(m => m.value));
        for (const entry of fresh) {
            if (!approvedValues.has(entry.value)) {
                remaining.push({ ...entry, rejectedAt: new Date().toISOString() });
            }
        }
    }

    // Re-write queue: include entries not touched (other agents) + remaining
    const touchedAgents = new Set(Object.keys(byAgent));
    const untouched = queue.filter(e => !touchedAgents.has(e.agentId));
    writePendingModels(repoPath, { queue: [...untouched, ...remaining] });

    const totalApproved = queue.length - untouched.length - remaining.length;
    process.stdout.write(`\n✅ Approved ${totalApproved} model(s). ${remaining.length} rejected (kept in queue with rejectedAt).\n`);
    if (totalApproved > 0) {
        process.stdout.write(`Remember to restart the dashboard: aigon server restart\n`);
    }
}

function buildRegistryEntry(m) {
    const entry = {
        value: m.value,
        label: m.label,
        score: { implement: null },
        lastRefreshAt: new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z',
    };
    if (m.pricing) entry.pricing = m.pricing;
    if (m.autoNotes) entry.notes = { implement: m.autoNotes };
    return entry;
}

// --- Staleness filtering ---

/**
 * Read all-{seed}-*.json summary files from .aigon/benchmarks/.
 * Returns a map of `${agentId}::${modelValue}` → lastRunMs.
 */
function buildLastRunMap(repoPath) {
    const benchDir = path.join(repoPath, '.aigon', 'benchmarks');
    if (!fs.existsSync(benchDir)) return {};

    const allFiles = fs.readdirSync(benchDir)
        .filter(f => f.startsWith('all-') && f.endsWith('.json'))
        .sort(); // lexicographic = chronological for ISO timestamps

    const lastRun = {};

    for (const fname of allFiles) {
        let data;
        try { data = JSON.parse(fs.readFileSync(path.join(benchDir, fname), 'utf8')); } catch (_) { continue; }
        const ts = data.timestamp ? new Date(data.timestamp).getTime() : 0;
        if (!ts || Number.isNaN(ts)) continue;

        for (const pair of (data.pairs || [])) {
            const key = `${pair.agentId}::${pair.modelValue}`;
            if (!lastRun[key] || ts > lastRun[key]) {
                lastRun[key] = ts;
            }
        }
    }

    return lastRun;
}

/**
 * Compute stale/fresh split for a set of pairs against staleness thresholds.
 *
 * @param {Array<{agentId, modelValue, modelLabel}>} pairs
 * @param {object} lastRunMap  - key `agentId::modelValue` → lastRunMs
 * @param {object} thresholdDays - agentId → days
 * @returns {{ stale: Array, fresh: Array }}
 */
function splitByStale(pairs, lastRunMap, thresholdDays) {
    const now = Date.now();
    const stale = [];
    const fresh = [];

    for (const pair of pairs) {
        const key = `${pair.agentId}::${pair.modelValue}`;
        const lastMs = lastRunMap[key] ?? 0;
        const ageMs = now - lastMs;
        const threshold = (thresholdDays[pair.agentId] ?? DEFAULT_STALENESS_DAYS[pair.agentId] ?? 30) * 86_400_000;
        if (ageMs >= threshold) {
            stale.push({ ...pair, lastRunMs: lastMs, ageMs });
        } else {
            fresh.push({ ...pair, lastRunMs: lastMs, ageMs });
        }
    }

    return { stale, fresh };
}

function fmtAge(ageMs) {
    if (ageMs === 0) return 'never';
    const days = Math.floor(ageMs / 86_400_000);
    if (days > 0) return `${days}d ago`;
    return `${Math.floor(ageMs / 3_600_000)}h ago`;
}

// --- Main command ---

async function benchRefresh(rawArgs) {
    const args = rawArgs || [];
    const isDryRun = args.includes('--dry-run');
    const isForce = args.includes('--ignore-staleness') || args.includes('--force'); // --force kept as alias but undocumented
    const repoPath = process.cwd();

    // Parse per-agent day flags: --gg-days N, --op-days N, --cc-days N, --cx-days N
    const thresholdDays = { ...DEFAULT_STALENESS_DAYS };
    for (const agentId of ['gg', 'op', 'cc', 'cx']) {
        const flag = `--${agentId}-days`;
        const idx = args.indexOf(flag);
        if (idx !== -1 && args[idx + 1]) {
            const val = parseInt(args[idx + 1], 10);
            if (!Number.isNaN(val) && val > 0) thresholdDays[agentId] = val;
        }
    }

    // Merge config-level threshold overrides
    const benchConfig = loadBenchRefreshConfig(repoPath);
    if (benchConfig.stalenessThresholdDays && typeof benchConfig.stalenessThresholdDays === 'object') {
        Object.assign(thresholdDays, benchConfig.stalenessThresholdDays);
    }
    if (benchConfig.autoAddModels !== undefined) {
        process.stdout.write(`⚠️  benchRefresh.autoAddModels in .aigon/config.json is ignored — perf-bench never writes models directly.\n   See docs/model-inclusion-policy.md §6.\n`);
    }

    // --- Step 1: Model discovery ---
    process.stdout.write('\n🔍 Discovering new models...\n');

    const ggData = loadAgentJson('gg');
    const opData = loadAgentJson('op');

    const ggOptions = ggData ? getModelOptions(ggData) : [];
    const opOptions = opData ? getModelOptions(opData) : [];

    const [ggNew, opNew] = await Promise.all([
        discoverGgModels(ggOptions),
        discoverOpModels(opOptions, benchConfig),
    ]);

    // Print discovery summary
    if (ggNew.length > 0) {
        process.stdout.write(`\ngg (Gemini) — ${ggNew.length} new model(s):\n`);
        for (const m of ggNew) process.stdout.write(`  + would add: ${m.value}\n`);
    } else {
        process.stdout.write('gg (Gemini) — no new models found\n');
    }
    if (opNew.length > 0) {
        process.stdout.write(`op (OpenRouter) — ${opNew.length} new model(s):\n`);
        for (const m of opNew) process.stdout.write(`  + would add: ${m.value}\n`);
    } else {
        process.stdout.write('op (OpenRouter) — no new models found\n');
    }

    // --- Step 2: Collect all active pairs ---
    const { collectAllPairs } = require('../perf-bench');
    const allPairs = collectAllPairs([]); // all agents, all non-quarantined models

    // --- Step 3: Staleness filtering ---
    const lastRunMap = buildLastRunMap(repoPath);

    let stalePairs, freshPairs;
    if (isForce) {
        stalePairs = allPairs.map(p => ({ ...p, lastRunMs: 0, ageMs: Infinity }));
        freshPairs = [];
    } else {
        ({ stale: stalePairs, fresh: freshPairs } = splitByStale(allPairs, lastRunMap, thresholdDays));
    }

    // --- Dry-run output ---
    if (isDryRun) {
        process.stdout.write('\n');
        process.stdout.write('NEW MODELS (would add)\n');
        process.stdout.write('─'.repeat(60) + '\n');
        if (ggNew.length === 0 && opNew.length === 0) {
            process.stdout.write('  (none)\n');
        } else {
            for (const m of ggNew) process.stdout.write(`  gg  ${m.value}\n`);
            for (const m of opNew) process.stdout.write(`  op  ${m.value}\n`);
        }

        process.stdout.write('\nSTALE PAIRS (would run)\n');
        process.stdout.write('─'.repeat(60) + '\n');
        if (stalePairs.length === 0) {
            process.stdout.write('  (none)\n');
        } else {
            for (const p of stalePairs) {
                process.stdout.write(`  ${p.agentId.padEnd(4)}  ${(p.modelValue || '').slice(0, 48).padEnd(48)}  last: ${fmtAge(p.ageMs)}\n`);
            }
        }

        process.stdout.write('\nFRESH PAIRS (skip)\n');
        process.stdout.write('─'.repeat(60) + '\n');
        if (freshPairs.length === 0) {
            process.stdout.write('  (none)\n');
        } else {
            for (const p of freshPairs) {
                process.stdout.write(`  ${p.agentId.padEnd(4)}  ${(p.modelValue || '').slice(0, 48).padEnd(48)}  last: ${fmtAge(p.ageMs)}\n`);
            }
        }

        process.stdout.write('\n');
        return;
    }

    // --- Step 4: Queue new candidates for human approval ---
    // Policy §6: perf-bench never writes to templates/agents/<id>.json directly.
    // Discovered candidates land in .aigon/pending-models.json; a human runs
    // `aigon model-refresh --approve-pending` to review and merge.
    // See docs/model-inclusion-policy.md.
    let queuedTotal = 0;
    if (ggNew.length > 0) {
        const n = appendToPendingQueue(repoPath, 'gg', ggNew);
        queuedTotal += n;
        process.stdout.write(`📥 queued ${n} gg candidate(s) for review → ${pendingModelsPath(repoPath)}\n`);
    }
    if (opNew.length > 0) {
        const n = appendToPendingQueue(repoPath, 'op', opNew);
        queuedTotal += n;
        process.stdout.write(`📥 queued ${n} op candidate(s) for review → ${pendingModelsPath(repoPath)}\n`);
    }
    if (queuedTotal > 0) {
        process.stdout.write(`   Run 'aigon model-refresh --approve-pending' from a terminal to review.\n`);
    }

    // --- Step 5: Run stale pairs ---
    if (stalePairs.length === 0) {
        process.stdout.write('\n✅ All pairs are fresh — nothing to run.\n');
        return;
    }

    process.stdout.write(`\n⏱  ${stalePairs.length} stale pair(s) to run:\n`);
    for (const p of stalePairs) {
        process.stdout.write(`   ${p.agentId.padEnd(4)}  ${p.modelValue}  (last: ${fmtAge(p.ageMs)})\n`);
    }

    const { runAllBenchmarks } = require('../perf-bench');

    // Determine seeds: --all-seeds flag or default to brewboard
    const allSeeds = args.includes('--all-seeds');
    const seeds = allSeeds ? ['brewboard', 'brewboard-review'] : ['brewboard'];

    // Determine judge flag
    const useJudge = args.includes('--judge');

    // Determine skip-baseline: skip when all stale pairs belong to a single agent
    const agentIds = [...new Set(stalePairs.map(p => p.agentId))];
    const skipBaseline = agentIds.length === 1;

    // Build a pairFilter set for runAllBenchmarks
    const pairFilterKeys = new Set(stalePairs.map(p => `${p.agentId}::${p.modelValue}`));

    for (const seedName of seeds) {
        process.stdout.write(`\n🌱 Seed: ${seedName}\n`);
        try {
            await runAllBenchmarks({
                seedName,
                repoPath,
                skipBaseline,
                judge: useJudge,
                pairFilter: pairFilterKeys,
                skipQuotaCheck: isForce,
            });
        } catch (err) {
            process.stdout.write(`❌ Seed ${seedName} failed: ${err.message}\n`);
        }
    }
}

// --- bench-snapshot (F504): gold-image tarball lifecycle ----------------

const SEED_REGISTRY = {
    brewboard: 'https://github.com/jayvee/brewboard-seed.git',
    trailhead: 'https://github.com/jayvee/trailhead-seed.git',
};

const WORKING_REPO_REGISTRY = {
    brewboard: 'https://github.com/jayvee/brewboard.git',
    trailhead: 'https://github.com/jayvee/trailhead.git',
};

function fmtBytes(bytes) {
    if (bytes == null) return '—';
    if (bytes >= 1_000_000_000) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
    if (bytes >= 1_000_000) return `${Math.round(bytes / 1_048_576)} MB`;
    if (bytes >= 1_000) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

function fmtAgeDays(ms) {
    const days = Math.floor(ms / 86_400_000);
    if (days >= 1) return `${days}d`;
    const hours = Math.floor(ms / 3_600_000);
    if (hours >= 1) return `${hours}h`;
    return `${Math.floor(ms / 60_000)}m`;
}

function getInstalledAigonVersion() {
    try {
        return require(path.join(__dirname, '..', '..', 'package.json')).version;
    } catch (_) {
        return 'unknown';
    }
}

async function benchSnapshot(rawArgs) {
    const args = rawArgs || [];
    const seedName = args.find(a => !a.startsWith('--'));
    const isStatus = args.includes('--status');

    if (!seedName) {
        console.error('Usage: aigon bench-snapshot <seed> [--status]');
        console.error('\nKnown seeds: ' + Object.keys(SEED_REGISTRY).join(', '));
        process.exitCode = 1;
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(SEED_REGISTRY, seedName)) {
        console.error(`❌ Unknown seed: ${seedName}`);
        console.error(`   Known seeds: ${Object.keys(SEED_REGISTRY).join(', ')}`);
        process.exitCode = 1;
        return;
    }

    // --- Status mode: report only ---
    if (isStatus) {
        const tarPath = seedReset.goldImagePath(seedName);
        if (!seedReset.goldImageExists(seedName)) {
            process.stdout.write(`📦 Gold image: ${seedName}\n`);
            process.stdout.write(`   status: ❌ not found\n`);
            process.stdout.write(`   path:   ${tarPath}\n`);
            process.stdout.write(`\n   Run 'aigon bench-snapshot ${seedName}' to create.\n`);
            return;
        }
        const meta = seedReset.readGoldMeta(seedName) || {};
        const stat = fs.statSync(tarPath);
        const ageMs = Date.now() - new Date(meta.createdAt || stat.mtime).getTime();
        const currentVersion = getInstalledAigonVersion();
        const versionMatch = meta.aigonVersion === currentVersion;
        process.stdout.write(`📦 Gold image: ${seedName}\n`);
        process.stdout.write(`   status:  ✅ ready${versionMatch ? '' : '  (⚠️  version mismatch)'}\n`);
        process.stdout.write(`   path:    ${tarPath}\n`);
        process.stdout.write(`   size:    ${fmtBytes(stat.size)}\n`);
        process.stdout.write(`   age:     ${fmtAgeDays(ageMs)} (built ${meta.createdAt || stat.mtime.toISOString()})\n`);
        process.stdout.write(`   aigon:   v${meta.aigonVersion || 'unknown'}${versionMatch ? '' : ` (current: v${currentVersion})`}\n`);
        if (meta.seedUrl) process.stdout.write(`   seed:    ${meta.seedUrl}\n`);
        if (meta.workingRepoUrl) process.stdout.write(`   working: ${meta.workingRepoUrl}\n`);
        return;
    }

    // --- Build mode: run full reset, then snapshot ---
    const repoPath = path.join(process.env.HOME || os.homedir(), 'src', seedName);
    const parentDir = path.dirname(repoPath);

    process.stdout.write(`\n🌱 Step 1/2: Running full seed-reset for ${seedName}...\n`);
    process.stdout.write(`   (this is the slow path — required once per aigon version)\n\n`);
    const reset = spawnSync('aigon', ['seed-reset', seedName, '--force'], {
        stdio: 'inherit',
        env: { ...process.env, AIGON_BENCH_MODE: '1' },
    });
    if (reset.status !== 0) {
        process.stderr.write(`\n❌ seed-reset failed (exit ${reset.status}). Aborting snapshot.\n`);
        process.exitCode = 1;
        return;
    }

    if (!fs.existsSync(repoPath)) {
        process.stderr.write(`\n❌ Expected seed repo at ${repoPath} after reset, but it does not exist.\n`);
        process.exitCode = 1;
        return;
    }

    process.stdout.write(`\n📦 Step 2/2: Tarballing ${repoPath}...\n`);
    const t0 = Date.now();
    const result = seedReset.createGoldImage({
        seedName,
        repoPath,
        parentDir,
        repoName: seedName,
    });
    if (!result.ok) {
        process.stderr.write(`❌ Snapshot failed: ${result.error}\n`);
        process.exitCode = 1;
        return;
    }

    const meta = {
        aigonVersion: getInstalledAigonVersion(),
        createdAt: new Date().toISOString(),
        seedUrl: SEED_REGISTRY[seedName],
        workingRepoUrl: WORKING_REPO_REGISTRY[seedName] || null,
    };
    seedReset.writeGoldMeta(seedName, meta);

    const tarPath = seedReset.goldImagePath(seedName);
    process.stdout.write(`\n✅ Snapshot saved: ${tarPath}\n`);
    process.stdout.write(`   size: ${fmtBytes(result.sizeBytes)}\n`);
    process.stdout.write(`   tar:  ${(result.ms / 1000).toFixed(1)}s\n`);
    process.stdout.write(`   total: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    process.stdout.write(`\nNext benchmark runs will use the fast path automatically.\n`);
}

function createBenchCommands() {
    return {
        'bench-refresh': (args) => benchRefresh(args),
        'bench-snapshot': (args) => benchSnapshot(args),
        'model-refresh': (args) => modelRefresh(args),
    };
}

module.exports = {
    createBenchCommands,
    // exported for use by perf-bench fixture-freshness check
    getInstalledAigonVersion,
    // exported for unit testing
    splitByStale,
    buildLastRunMap,
    discoverGgModels,
    discoverOpModels,
    benchSnapshot,
    benchRefresh,
    modelRefresh,
    modelRefreshApprovePending,
    assessModel,
    isIrrelevantForCoding,
    filterRelevantCandidates,
    promptIncludeExclude,
    appendToPendingQueue,
    readPendingModels,
    writePendingModels,
    pendingModelsPath,
    buildRegistryEntry,
    opApiIdToRegistryId,
    opRegistryIdToApiId,
};
