# Model Inclusion Policy

This document is the **single source of truth** for what models may appear in `templates/agents/<id>.json` `cli.modelOptions` — the picker users see in the agent matrix and the start-modal Model override dropdown.

It exists because every Aigon role (spec, spec-review, implement, review, research) is an **agentic coding loop**: the model is invoked inside an interactive CLI session that reads files, edits files, and runs shell commands across multi-turn tool use. Any model that cannot do that — or can do that but for a non-coding domain — does not belong in `modelOptions`.

The policy is **enforced in code** (see `lib/commands/bench.js` `isIrrelevantForCoding` + `assessModel`) and **gated by a human** (see `lib/commands/bench.js` `promptIncludeExclude`). Adding a model that violates this policy in a manual edit is a bug; the catalog refresh path will never persist a violation on its own.

---

## 1. Hard exclusions — modality / domain

A model is **never** eligible if its primary modality or domain is not "text-in, text-out agentic coding". The following ID patterns are auto-rejected at discovery time:

| Pattern (substring match on lower-cased model ID) | Rejected because |
|---|---|
| `-tts`, `tts-preview`, `speech`, `audio`, `voice`, `voxtral` | Speech / audio synthesis or recognition — cannot drive a coding loop. |
| `robotics`, `computer-use` | Embodied / GUI-control agents — different tool surface, different prompt contract. |
| `-vl-`, `-vl$`, `vl-max`, `vl-plus`, `flash-image`, `pro-image`, `pro-image-preview` | Vision-language / image-generation variants. We do not benchmark vision; sending coding prompts to these wastes tokens. |
| `-image\b`, `-image-preview`, `nano-banana`, `imagen` | Image generation pipelines. |
| `/glm-[0-9.]+v` | z-ai vision variants. |
| `-latest`, `-current` (alias suffixes) | Provider-side mutable pointers. Aigon's benchmark-and-score model is **per-version**; aliases drift under us and corrupt the score table. Pin to the dated/numeric ID instead. |
| `-thinking`, `-thinking-\d`, `:thinking`, `-r1`, `deepseek-r1`, `thinking-2507` | Reasoning-mode variants where the model spends arbitrary tokens before responding. Agentic tool-use loops with reasoning mode rarely complete inside the wall-time budget and burn through quota even when they do. *Exception:* an explicit opt-in score from `aigon eval`; only then may a thinking model be added with a manual `notes.implement` warning. |
| Single-digit-B (non-MoE) parameter counts (`\b[1-9]b\b` without a `\d{2,}b` or `-a\d` marker) | Too weak for multi-file edits. Empirically below the threshold where Aigon's review/eval steps return useful signal. |

If a future provider invents a new non-coding modality (e.g. `-video-`, `-music-`, `-3d-`), add a pattern here in the **same PR** that adds the discovery filter — do not let one slip in unfiltered.

## 2. Hard exclusions — economics

A model is rejected at discovery time if:

- **Output price > $5.00 / MTok and not yet hand-scored.** A hung agentic session at this price drains credits faster than the kill-switch catches it. Models above this bar may still be added, but only by a human on the approval prompt, after acknowledging the risk explicitly. The `assessModel` helper flags this as a `risk:` so the human sees the cost band.
- **Pricing missing AND provider is paid (not bundled with a plan).** We refuse to score a model whose cost we don't know — telemetry would record `costUsd: null` and corrupt the cost dashboard.

## 3. Hard exclusions — capability

A model is rejected if:

- **No `generateContent` (or provider equivalent) support.** Discovery already filters this for Gemini; equivalent checks live in `discoverOpModels` for OpenRouter (`supported_parameters.includes('tools')`).
- **Provider serves the model only on a `:free` tier.** Free tiers rate-limit aggressively and produce false-positive quota errors during evals. Pin to a paid SKU or skip.
- **Model is announced but not yet generally available** (Gemini "Discovery API lists it but `generateContent` returns 404", OpenRouter "preview waitlist", etc.). Add a `quarantined: {...}` block with `reason` and `evidence` instead of including the model live; un-quarantine after the next clean `aigon agent-probe` pass.

## 4. Soft signals — the human decides

The following are **flagged but not auto-rejected**. The approval prompt surfaces them so the human can decide:

- Suffix `-preview` / `-beta` / `-rc` — provider may yank or change the model. Acceptable for a single benchmark sweep, but un-suitable for a default in `complexityDefaults` until promoted.
- "Custom tools" / "tool-variants" of an existing base model (e.g. `gemini-3.1-pro-preview-customtools`). Treat as a separate row only if `aigon eval` produces a meaningfully different score from the base; otherwise prefer the base ID and use config to opt into the variant.
- Provider-published score (Terminal-Bench, SWE-bench, etc.) without an `aigon eval` sweep. Acceptable to add with `score.implement: null` and a `notes.implement` describing the published number, but the agent's `cli.complexityDefaults` must **not** route to it until `aigon eval --agent <id> --model <model>` produces a brewboard score.

## 5. Lifecycle requirements

Every entry in `cli.modelOptions` must have:

- `value` — the literal model ID the provider's CLI accepts. **Pinned** (no aliases).
- `label` — human-readable name as the provider markets it. No marketing fluff.
- `lastRefreshAt` — ISO timestamp of when discovery confirmed the model exists. Updated on every refresh sweep.
- `score: { <role>: number | null }` — one entry per role this model is eligible for. `null` is acceptable for a new model; *missing* is not.
- `pricing: { input, output }` in USD per MTok — required for paid SKUs. Omitted for plan-bundled SKUs (cc, gg with Google AI Pro).
- `notes: { <role>: string }` — one paragraph per role. **Required** for any model promoted into a `cli.complexityDefaults` slot. Optional otherwise — but encouraged at addition time so the next reviewer doesn't have to re-derive the rationale.
- `quarantined: { since, reason, evidence, supersededBy }` — added when a probe / sweep reveals the model is broken. **Never delete a quarantined entry** — the record is the audit trail. Un-quarantine only when a clean re-probe passes.

## 6. Approval flow — no exceptions

There is **one** way for a model to enter `cli.modelOptions`: through `aigon model-refresh`, with a human on the approval prompt. This holds even for "obviously good" candidates.

```
aigon model-refresh                 # interactive: discover → assess → prompt human → write
aigon model-refresh --dry-run       # discover → assess → print, write nothing
aigon model-refresh --approve-pending  # interactive review of the pending queue
```

**Non-interactive contexts** (scheduled jobs, CI, autonomous mode) write candidates to `.aigon/pending-models.json`. They do **not** write to `templates/agents/<id>.json` directly. The pending file accumulates until a human runs `aigon model-refresh --approve-pending` to drain it.

`aigon perf-bench` may **discover** new models as a side-effect of a benchmark sweep, but it must **not** persist them. Discovery results from a perf-bench run land in the same pending queue and require the same approval flow.

This means the catalog can never grow without a human reading the candidate IDs and pricing on a terminal prompt. There is no "auto-approve suitable models" flag and no config switch to add one.

## 7. Removal flow

To remove a model from `cli.modelOptions`:

1. **If broken** — add a `quarantined: {...}` block with `since`, `reason`, `evidence`, `supersededBy`. Do not delete the entry.
2. **If superseded by a better model with equivalent role coverage** — keep both entries for at least one minor version. Delete only after no `cli.complexityDefaults` slot references the older ID and no `.aigon/benchmarks/*.json` from the last 90 days references it.
3. **If added in error** — delete outright; the audit trail lives in git history. Reference this policy file in the commit message.

## 8. Bypass paths — there are none

Any code path that mutates `cli.modelOptions` outside the `aigon model-refresh` flow is a bug. Specifically prohibited:

- Direct `JSON.stringify(modelOptions)` writes in any file other than `lib/commands/bench.js` (and its tests).
- Adding entries by hand in `templates/agents/*.json` PRs without a paired `aigon model-refresh` audit line in the commit message.
- Setting `benchConfig.autoAddModels: true` — the config key is removed; the perf-bench writer is gone.

The discovery-time filter (`isIrrelevantForCoding`) is invoked **inside** `discoverGgModels` / `discoverOpModels`, not at the prompt boundary. Any caller — interactive, non-interactive, future — sees an already-filtered candidate list.

### Known limitations

- **Concurrent writes to `.aigon/pending-models.json`** are not locked. Aigon expects a single human operator per repo; two simultaneous `aigon perf-bench` runs on the same workstation could race and lose entries. If this ever bites, add a `proper-lockfile`-style file lock around `writePendingModels`. Out of scope today.
- **Latency and historical reliability** from `aigon eval` runs are not yet folded into `assessModel`. A model that benchmarks slow but otherwise looks suitable will pass the prompt; the human is expected to read the score and notes columns in `templates/agents/<id>.json` before promoting it into a `cli.complexityDefaults` slot. Folding eval data into the approval prompt is a future improvement.

---

## Appendix — the 2026-05-22 incident (why this document exists)

On 2026-05-20 a `aigon perf-bench --all` run with `autoAddModels: true` (the default) discovered 19 new Gemini models from the v1beta `models?key=…` endpoint and wrote all 19 into `gg.json` directly, without invoking the modality filter or any human prompt. The dropdown in the Choose-agent modal grew to 30+ entries including TTS variants, robotics-ER, computer-use, image-gen ("Nano Banana"), and four `-latest` alias pointers — none of which can drive a coding loop.

Root cause: the `isIrrelevantForCoding` filter and the `promptIncludeExclude` human-approval prompt both lived **only** on the `aigon model-refresh` path. The `aigon perf-bench` discovery path had two doors and no lock on the second one.

The fix in code: collapse the writer paths into one, push the filter into discovery itself, and replace the non-interactive "auto-approve suitable" mode with a pending-models queue that requires a human to drain.

The fix in process: this document.
