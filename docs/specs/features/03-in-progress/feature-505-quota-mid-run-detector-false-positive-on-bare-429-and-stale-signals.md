---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T12:41:57.462Z", actor: "cli/feature-prioritise" }
---

# Feature: quota-mid-run-detector-false-positive-on-bare-429-and-stale-signals

## Summary

The mid-run quota detector fires false-positive `anthropic-rate-limit` paused signals on any agent whose tmux pane happens to contain the substring `429` — diff hunk line numbers, version strings (`v4.29.x`), file sizes (`429K`), or even fragments of the regex pattern itself when an agent reads `templates/agents/*.json`. The current `cc.json` quota.errorPatterns regex is `rate.{0,3}limit|429|too many requests|you.?ve hit your limit` with no word boundaries and no HTTP/status context — bare `429` on any line matches.

Once a false signal lands on a feature snapshot's `quotaSignals[]`, it persists. There is no auto-clear when subsequent heartbeats prove the agent is alive — the dashboard keeps rendering the "Quota — resets …" Resume/Skip banner indefinitely until somebody manually intervenes.

Concrete incident (2026-05-10): F502 (template-install-drift-guard) was actively implementing — `lifecycle: implementing`, `agents.cc.status: running`, tmux pane scrolling fresh tokens — but the dashboard showed Quota Paused. Pane history line: `429 +                                // F502: snapshot upstream template sha so drift` — a diff hunk header for line 429 of `lib/commands/setup.js`. The detector regex matched `429` and emitted `kind: paused, patternId: anthropic-rate-limit`. The signal stayed on the snapshot for 13+ minutes after the agent's last heartbeat continued.

This feature tightens the regex to require boundaries + status context, and adds a heartbeat-based auto-clear so a stale paused signal evaporates when the agent demonstrably keeps working.

## User Stories
- [ ] As an agent editing diff hunks, version strings, or quota-related code, I do not get falsely flagged as rate-limited because my pane happens to contain a bare `429`.
- [ ] As a maintainer watching the dashboard, when the agent is clearly still emitting heartbeats and tokens, the Quota Paused banner does not stay up indefinitely from a stale signal.
- [ ] As an agent that genuinely hits an Anthropic 429, I am still detected and paused (no regression).

## Acceptance Criteria

### Regex tightening
- [ ] `templates/agents/cc.json` quota.errorPatterns `match` is rewritten with word boundaries and contextual anchors. Proposed value: `(?:^|[^A-Za-z0-9])(?:HTTP|status|code)?\\s*429\\b(?!\\.\\d)|\\brate[\\s\\-_]?limit(?:ed|ing)?\\b|\\btoo[\\s\\-_]many[\\s\\-_]requests\\b|you[\\s']?ve\\s+hit\\s+your\\s+limit`. Rationale: bare `429` matches only when it isn't part of a longer number/identifier (excludes `v4.29.x`, `4290`, `s429abc`); `rate-limit` requires a real word boundary; multiword phrases require whitespace.
- [ ] Same tightening for any other agent JSON whose `errorPatterns` contains the same loose `429` alternative (`gg.json`, `cx.json`, `cu.json`, `km.json` — sweep the lot).
- [ ] New test `tests/integration/quota-classifier-false-positive.test.js` asserts the tightened regex does **not** match these strings: `429 +`, `v4.29.0`, `4290`, `429K`, `s429abc`, `429.test.js`, a JSON line `"id": "anthropic-rate-limit"`, the regex source itself when read out of `cc.json`. And **does** match: `HTTP 429`, `status 429`, `429 Too Many Requests`, `Error: 429`, `rate-limit exceeded`, `rate limited`, `You've hit your limit`.
- [ ] Test loaded into `npm run test:core` (and therefore the iterate gate when relevant files change).

### Stale-signal auto-clear
- [ ] `lib/quota-mid-run-detector.js` (or the projector path that consumes its events) gains an auto-clear rule: when a snapshot has a `kind: paused` quotaSignal and the agent has emitted ≥2 heartbeats *after* `signal.detectedAt`, the projector emits a synthetic `quota.signal_cleared` event and removes the signal from `quotaSignals[]`. The threshold is configurable; default 2 heartbeats or 60s, whichever is later.
- [ ] When the agent is genuinely depleted, the heartbeat process stops (because the agent itself is paused), so the auto-clear never fires for real pauses. Test asserts this: a fixture with no post-detection heartbeat keeps the signal.
- [ ] Auto-clear emits a `console.warn`-level log line so a maintainer can grep for `quota.signal_cleared` if they're investigating false-pause rates.

### Pane-sample exclusions (defence in depth)
- [ ] The mid-run detector should not match its own pattern definitions. Add a sanitiser pass: before classifying a pane sample, strip any line containing the literal `errorPatterns` JSON key, the literal regex source, or the agent JSON file paths. This prevents the recursive case where an agent reading `cc.json` triggers its own detector.
- [ ] Test: a pane sample containing the full `cc.json` errorPatterns block does not classify as `depleted`.

### Dashboard read-path
- [ ] Confirm the dashboard's quota banner consults the snapshot's `quotaSignals[]` and clears immediately when it's empty. (Already true by inspection; just verify with a Playwright smoke test that toggling the snapshot makes the banner appear/disappear within the next dashboard tick.)

## Validation

```bash
node -c lib/quota-mid-run-detector.js
node -c lib/quota-probe.js
node tests/integration/quota-classifier-false-positive.test.js
npm run test:iterate
# Smoke: edit a feature spec, ensure no quotaSignal appears mid-edit.
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets. Playwright still runs at the pre-push gate.
- May modify all five agent JSONs (`cc.json`, `gg.json`, `cx.json`, `cu.json`, `km.json`) in a single mechanical sweep without separate sign-off — the regex tightening is uniform.

## Technical Approach

**The fix is the regex.** The detector machinery is fine; the pattern is too loose. Tighten it once and the false-positive class evaporates for every agent.

**The auto-clear is the safety net** for any future regex regression: even if a pattern over-matches, an agent that keeps heartbeating shakes off a stale paused signal in <60s instead of holding the dashboard hostage indefinitely.

**The sanitiser is paranoia, but cheap.** The cost is a single `String#includes` check per sample line; the benefit is making the detector immune to its own inputs.

**Design constraint — do not raise false negatives.** The whole point of mid-run detection is catching real rate limits early. Every regex tightening must be paired with a positive test asserting the genuine-rate-limit strings still match. The new test file enforces this with paired must/must-not arrays.

## Dependencies
- None. Independent of F501 (which is done) and F502 (currently in progress).

## Out of Scope
- Replacing the regex-based classifier with a structured Anthropic error-payload parser. Out of scope because pane scraping is the only signal in tmux mode; structured parsing requires a different transport.
- Renaming the `paused` quotaSignal kind, or restructuring `quotaSignals[]`. Schema-stable.
- Detecting *Anthropic-specific* rate-limit messages vs other providers — the agent JSON is already per-agent, so each provider's pattern can evolve independently. Just fix the cc one (and the sweep).

## Open Questions
- Auto-clear threshold: 2 heartbeats vs 60s vs both. Recommendation: both (whichever is later), so a slow-tick heartbeat still gets the time floor and a fast-tick agent doesn't clear after one stray sample.
- Should auto-clear also fire on `kind: depleted` signals, or only `kind: paused`? Recommendation: only `paused` for now. `depleted` is a stronger verdict and we'd rather have the maintainer manually Resume.

## Related
- Incident: F502 implementer falsely paused at `2026-05-10T12:22:16Z` on `paneSampleHash 52ae00b0a366b020`. Pane line: diff hunk `429 +` for line 429 of `lib/commands/setup.js`. Cleared manually by zeroing `quotaSignals[]` in `.aigon/workflows/features/502/snapshot.json`.
- Sibling: F501 (recently done) — established that engine state changes propagate cleanly via projector. Same projector path is the right place for auto-clear.
- Companion: F502 (template install drift guard) — currently running; not a dependency, but it was the unlucky sample.
