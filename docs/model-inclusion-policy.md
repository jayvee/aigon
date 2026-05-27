# Model Inclusion Policy

This document is the **single source of truth** for what models may appear in `templates/agents/<id>.json` `cli.modelOptions` — the picker users see in the agent matrix and the start-modal Model override dropdown.

It exists because every Aigon role (spec, spec-review, implement, review, research) is an **agentic coding loop**: the model is invoked inside an interactive CLI session that reads files, edits files, and runs shell commands across multi-turn tool use. Any model that cannot do that — or can do that but for a non-coding domain — does not belong in `modelOptions`.

The policy is enforced by maintainer tooling outside the OSS CLI and gated by a human before curated registry updates are published back to this repo. Adding a model that violates this policy in a manual OSS edit is a bug.

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
| `-thinking`, `-thinking-\d`, `:thinking`, `-r1`, `deepseek-r1`, `thinking-2507` | Reasoning-mode variants where the model spends arbitrary tokens before responding. Agentic tool-use loops with reasoning mode rarely complete inside the wall-time budget and burn through quota even when they do. *Exception:* an explicit maintainer score may add one with a manual `notes.implement` warning. |
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
- "Custom tools" / "tool-variants" of an existing base model (e.g. `gemini-3.1-pro-preview-customtools`). Treat as a separate row only if maintainer qualification produces a meaningfully different score from the base; otherwise prefer the base ID and use config to opt into the variant.
- Provider-published score (Terminal-Bench, SWE-bench, etc.) without maintainer qualification. Acceptable to add with `score.implement: null` and a `notes.implement` describing the published number, but the agent's `cli.complexityDefaults` must **not** route to it until maintainer qualification produces a score.

## 5. Lifecycle requirements

Every entry in `cli.modelOptions` must have:

- `value` — the literal model ID the provider's CLI accepts. **Pinned** (no aliases).
- `label` — human-readable name as the provider markets it. No marketing fluff.
- `lastRefreshAt` — ISO timestamp of when discovery confirmed the model exists. Updated on every refresh sweep.
- `score: { <role>: number | null }` — one entry per role this model is eligible for. `null` is acceptable for a new model; *missing* is not.
- `pricing: { input, output }` in USD per MTok — required for paid SKUs. Omitted for plan-bundled SKUs (cc, gg with Google AI Pro).
- `notes: { <role>: string }` — one paragraph per role. **Required** for any model promoted into a `cli.complexityDefaults` slot. Optional otherwise — but encouraged at addition time so the next reviewer doesn't have to re-derive the rationale.
- `quarantined: { since, reason, evidence, supersededBy }` — added when a probe / sweep reveals the model is broken. **Never delete a quarantined entry** — the record is the audit trail. Un-quarantine only when a clean re-probe passes.

## 6. Approval flow

There is **one** way for a model to enter OSS `cli.modelOptions`: a maintainer publishes a curated registry update from Pro/internal tooling after human review. The OSS CLI intentionally does not ship model discovery, benchmark sweeps, pending-model queues, or registry mutation commands.

This means the public catalog can never grow as a side effect of an end-user command. There is no OSS "auto-approve suitable models" flag and no config switch to add one.

## 7. Removal flow

To remove a model from `cli.modelOptions`:

1. **If broken** — add a `quarantined: {...}` block with `since`, `reason`, `evidence`, `supersededBy`. Do not delete the entry.
2. **If superseded by a better model with equivalent role coverage** — keep both entries for at least one minor version. Delete only after no `cli.complexityDefaults` slot references the older ID and no `.aigon/benchmarks/*.json` from the last 90 days references it.
3. **If added in error** — delete outright; the audit trail lives in git history. Reference this policy file in the commit message.

## 8. Bypass paths — there are none

Any OSS code path that mutates `cli.modelOptions` as a user command is a bug. Specifically prohibited:

- Reintroducing `model-refresh`, `bench-refresh`, `perf-bench`, `matrix-apply`, `agent-quarantine`, or model-qualification command dispatch in OSS.
- Adding entries by hand in `templates/agents/*.json` PRs without maintainer review context.
- Setting `benchConfig.autoAddModels: true` — the config key is removed; the OSS writer is gone.

The discovery-time filter belongs in the maintainer tooling that generates curated updates, not in OSS user workflows.

### Known limitations

- OSS users see curated score, pricing, notes, refresh timestamps, and quarantine status, but not the raw maintainer machinery that generated them.

---

## Appendix — the 2026-05-22 incident (why this document exists)

On 2026-05-20 a maintainer benchmark run with `autoAddModels: true` discovered 19 new Gemini models from the v1beta `models?key=...` endpoint and wrote all 19 into `gg.json` directly, without invoking the modality filter or any human prompt. The dropdown in the Choose-agent modal grew to 30+ entries including TTS variants, robotics-ER, computer-use, image-gen ("Nano Banana"), and four `-latest` alias pointers — none of which can drive a coding loop.

Root cause: the discovery filter and the human-approval prompt lived on only one maintainer path. A benchmark discovery path had two doors and no lock on the second one.

The fix in OSS: keep only curated read-only metadata in `templates/agents/*.json`; move discovery, qualification, refresh, and registry mutation to Pro/internal maintainer tooling.

The fix in process: this document.
