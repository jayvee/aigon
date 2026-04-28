# Aigon vs — the concise delta

This is the **internal source of truth** for the public comparisons page (`site/content/comparisons.mdx`, not yet written) and for any short-form "how is Aigon different" copy that doesn't fit the chunks in `positioning.md`.

It deliberately refuses to be a 10-axis × 14-tool grid. The full grid lives in `docs/competitive/matrix.md` and serves a different audience (us, when we're maintaining honesty about cells). This doc serves a reader who wants to decide in 30 seconds whether Aigon is for them.

**Last refreshed:** 2026-04-28.
**Companions:** `positioning.md` (narrative chunks), `docs/competitive/` (full landscape, sources, per-tool entries).

---

## The wedge — one sentence

> **Aigon turns the Claude, Gemini, and Codex subscriptions you already pay for into one fleet — racing different vendors when work is hard (reviewer diversity catches bugs no single model sees) and routing around whichever quotas you've burned the rest of the time.**

That's the entire defensible delta. One posture — **cross-vendor orchestration of subscriptions you already own** — yields two payoffs nobody else delivers together: **reviewer diversity** (quality) and **quota arbitrage** (economics). Every other feature — Markdown specs, Kanban lifecycle, git worktrees, slash commands, dashboard, local-first — is **support for that wedge**, not the wedge itself. Public copy must lead with the wedge and treat the rest as evidence.

### Why this is the wedge

The market converged in early 2026. By April 2026, every Tier A peer ships Markdown-specs-in-git, git-worktree isolation, parallel agents, and built-in review. Those are no longer differentiators. The split that remains:

| Posture | Tools | Reviewer diversity? | Quota arbitrage? |
|---|---|:---:|:---:|
| **Single agent** | Cursor, Claude Code (alone), Aider, Codex CLI | — | — |
| **Intra-vendor parallel** | Superpowers, Cursor 3 Agents Window, Cline Kanban, Devin (multiple Devins), GSD | — *(same model racing itself)* | — *(one quota pool)* |
| **Cross-vendor parallel** | **Aigon** | ✓ Claude / Gemini / Codex race; fourth-vendor reviewer picks winner | ✓ Auto-failover on token exhaustion (F308); budget poller (F322); cost-aware recommender (F370–F375) |

### The two payoffs spelled out

**1. Reviewer diversity (quality).** R21 found that different model families catch genuinely different classes of issue; Claude reviewing Claude under-detects compared to Gemini reviewing Claude. Aigon Fleet runs Claude + Gemini + Codex in parallel on the same spec and uses a fourth vendor as the merge reviewer. Nobody else does that.

**2. Quota arbitrage (economics).** Every coding-agent user with a Pro plan hits 5-hour quota walls. Single-vendor tools (Superpowers, GSD, Cursor 3) leave you stuck — you wait for the reset, switch laptops, or pay overage. Aigon polls Claude Code / Codex / Gemini CLI / Kimi quotas every 30 min (`lib/budget-poller.js`, surfaced as `/api/budget` and on the dashboard), shows headroom at feature-start, and **auto-fails over to a different vendor** when one runs out (F308). The recommender (F370–F375) factors in capability *and* cost when picking which agent to assign each spec. You're paying for three subscriptions anyway — Aigon turns them into a single elastic budget.

These are not two unrelated benefits. They flow from the *same* architectural choice: cross-vendor parallelism on subscriptions you already own. Pick that posture and you get both. Pick any other posture and you get neither.

---

## Three buyer questions, three honest answers

The public page should answer these three and nothing else.

### 1. "Why not just use my one favourite tool?"
*(Cursor, Claude Code, Aider, Codex CLI)*

**Short answer (quality):** Because you're betting that one model is right. On routine work, that's fine. On anything ambitious — a tricky migration, a security-sensitive change, a refactor whose blast radius you can't fully predict — you want a second and third opinion *before* you ship, not in code review after.

**Short answer (economics):** Because you've already hit the 5-hour quota wall and stopped working. If you pay for Claude Pro *and* a Gemini key *and* Codex, your one favourite tool only spends one of those budgets while the other two sit idle. Aigon spreads the load — and when Claude's quota is exhausted, work continues on Gemini automatically.

**Aigon's tradeoff:** You set up tmux and configure multiple CLIs instead of one. The payoff only kicks in if you actually have multiple subscriptions and care about either diversity or quota headroom. **For one-off scripts and small fixes with one subscription, your favourite single tool is the right answer.**

### 2. "Why not Superpowers / GSD / Cline Kanban — they have parallel agents too?"

**Short answer (quality):** Their parallelism is **intra-vendor**. Superpowers spawns multiple Claude Codes. Cursor 3 runs multiple Cursors. Cline runs multiple Clines. You get faster execution and isolation, but every parallel agent shares the same model's blind spots. When all three Claudes miss the same edge case, the diff review misses it too.

**Short answer (economics):** Intra-vendor parallelism shares **one quota pool**. Three Claude Codes racing each other burn three times your Claude budget for the same wall-clock window — and when that pool is gone, *all* of them stop. Aigon's three vendors share *zero* quota; one running out doesn't slow the others, and the auto-failover (F308) routes to whichever one has headroom.

**Aigon's posture:** Different vendors race; a *fourth* vendor reviews; the dashboard shows real-time quota for all of them; the recommender (F370–F375) picks the cheapest capable agent per spec. If you don't care about reviewer diversity *and* you only have one subscription, pick Superpowers — it's lighter, has 10× the community, and ships everything else Aigon does.

**Aigon's tradeoff:** Multiple subscriptions, multiple CLIs to keep configured. The setup friction is real. We think it's worth it for teams who already pay for two or three agents and want them working together instead of separately; we ship Solo / Drive mode for the case where you don't, so the tax is opt-in.

### 3. "Why not Devin / Jules — they're fully autonomous?"

**Short answer:** Different shape. Devin is cloud + autonomous + per-task billing. Aigon is local + supervised + uses subscriptions you already pay for. They solve adjacent but distinct problems.

**Pick Devin** if: zero local setup matters more than control; you bill per-ACU happily; your tasks are well-bounded enough that "fire and forget" works; you want a single web app to live in.

**Pick Aigon** if: you want to watch the work happen (tmux attach, dashboard); your existing Claude Pro / Gemini / Codex subscriptions should be the budget; you want the option to escalate to autonomous (Autopilot) without giving up the supervised default.

---

## When *not* to use Aigon — the honest list

Public copy must include this section. It's how readers decide we're not snake oil.

- **You don't have multiple agent subscriptions.** Aigon's headline value is multi-vendor parallelism — *both* payoffs (reviewer diversity and quota arbitrage) require ≥ 2 vendors. With one subscription you get Solo mode, which is fine but isn't what makes Aigon different — you might be happier with Superpowers.
- **You live in your IDE.** Aigon is CLI + web dashboard. No Cursor sidebar, no VS Code panel. If you rarely open a terminal, this isn't the tool.
- **You want zero-setup cloud autonomy.** Devin and Jules exist for that.
- **You prefer one agent in inline-completion mode.** Cursor's Composer is sub-second; nothing in Aigon is.
- **You're allergic to YAML / Markdown spec files.** Aigon centres the Markdown spec. If "agree on what to build before code" feels like overhead instead of leverage, the chat-first tools (Aider, Cline non-Kanban) will fit your hand better.

---

## The grid — minimum viable form

If a grid must appear on the public page, this is the only one we ship. Five columns: the four parallelism postures, plus the second payoff (quota arbitrage) that *only* the cross-vendor row earns.

| | One model races | Multiple of the *same* model race | Multiple **different** models race | Reviewer is a different model | Quotas pool across vendors |
|---|:---:|:---:|:---:|:---:|:---:|
| **Cursor / Claude Code (alone) / Aider** | ✓ | — | — | — | — |
| **Superpowers / GSD / Cline Kanban / Cursor 3** | ✓ | ✓ | — | — | — |
| **Devin (multiple Devins)** | ✓ | ✓ | — | — | — |
| **Aigon Fleet** | ✓ | ✓ | ✓ | ✓ | ✓ |

Note the last column: it's not "Aigon supports more vendors" (everyone does, given enough config). It's "Aigon actively *load-balances* across them via the budget poller and auto-failover." That's a feature claim, not a posture claim — F308 + F322 + F370–F375 are the receipts.

The full 10-axis grid is in `docs/competitive/matrix.md` for readers who want detail. The public page links there with: *"For the full breakdown across 10 axes and ~14 tools, see the competitive matrix."*

---

## Translation rules — turning this into public copy

When `site/content/comparisons.mdx` is written or updated, follow these:

1. **Lead with the wedge sentence verbatim** — both clauses. Reviewer diversity *and* quota arbitrage. Dropping either clause loses half the audience: the quality-first reader and the cost-pressured reader.
2. **Three buyer questions in this order.** Not more, not fewer. Each question must answer both *quality* and *economics* explicitly — those are the two halves of the wedge.
3. **"When not to use Aigon" stays.** Drop it and the page reads like marketing instead of analysis. The honesty *is* the differentiator.
4. **The 5-column grid is the only grid.** The "Quotas pool across vendors" column is non-negotiable — it's where the second payoff visibly lands. If tempted to add a sixth column, put it in `docs/competitive/matrix.md` and link.
5. **Cite specific tools by name.** Vague "other harnesses" loses readers; *"Superpowers parallelises Claude"* lands.
6. **No feature-by-feature comparison** for the quality story (that's the failure mode that produced the 10×14 matrix). **Do** cite specific feature IDs (F308 auto-failover, F322 budget poller, F370–F375 recommender) for the economics story — they're proof the quota claim is real, not aspirational.
7. **Refresh cadence.** This doc updates whenever a new Tier A entrant lands in `landscape.md`, *or* whenever the quota-routing surface changes (new poller target, recommender axis, failover policy). Public surface follows in the same PR.

---

## What this doc is *not*

- It is not the narrative one-liner — that's `positioning.md`.
- It is not the full landscape — that's `docs/competitive/landscape.md`.
- It is not the per-cell sourced grid — that's `docs/competitive/matrix.md`.
- It is not per-competitor wins — that's `docs/competitive/weaknesses.md`.

It is the **bridge** between the matrix (correct but unreadable) and the public page (readable but not yet written). One job: nail the delta clearly enough that the public page writes itself.
