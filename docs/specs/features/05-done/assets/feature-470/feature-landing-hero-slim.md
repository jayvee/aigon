# Feature: Slim landing hero + restore CTAs + relocate "Why Use Aigon"

**Scope:** `site/public/home.html`, `site/public/css/style.css`
**Type:** Refactor (no new sections, content relocation + copy edits)
**Estimated diff:** ~150 lines HTML moved, ~40 lines CSS adjusted, no new assets

---

## Why

The current hero stacks seven distinct modules: kicker, subtitle, two-paragraph wedge H1, fact pills, four "Why Use Aigon" benefit cards, a full-bleed Kanban screenshot, and a three-step Fleet GIF triptych. The visitor reads ~1500 words before they see what's below the fold, and there is no primary CTA above the fold. The four payoff cards are good copy but they are a section, not a hero element.

This change halves the hero, restores two CTAs, and promotes "Why Use Aigon" to a first-class section directly below.

## Acceptance criteria

- [ ] Hero contains exactly: eyebrow kicker, one-sentence H1, one-sentence subtitle paragraph, agent chip row, two CTA buttons, fact pills, one visual block.
- [ ] The two-paragraph wedge headline (the one ending in "FONUT — Fear Of Not Using Tokens") is removed from the hero.
- [ ] The "FONUT" line is preserved — moved into the body of the "Stop hitting quota walls" payoff card so the joke isn't lost.
- [ ] The four "Why Use Aigon" cards live in their own `<section id="why">` directly under the hero, with eyebrow `Why a multi-agent harness`. Card content is unchanged.
- [ ] The hero visual is the Fleet three-step triptych only. The Kanban screenshot is removed from the hero (it remains the lead image in `#dashboard`).
- [ ] Two CTA buttons sit under the H1:
  1. Primary: `$ npx aigon install` — copy-on-click, with a small "copied" affordance, anchored to `#docs` as fallback link target.
  2. Ghost: `★ Star on GitHub` linking to `https://github.com/jayvee/aigon`.
  3. Note: a follow-up feature will add `npx aigon init` as a second primary CTA — leave space and a code comment marker for it.
- [ ] Sections `#docs` (install + 2 doc tiles) and `#explore-docs` (4 doc tiles) are merged into a single `<section id="get-started">` with eyebrow `Get started`. Install snippet on top, all 6 doc tiles below in one grid.
- [ ] Lighthouse a11y score does not regress; H1 remains exactly one element on the page; `aria-current` nav highlighting still works after section IDs change.
- [ ] No new fonts, colors, or assets introduced. Reuse existing tokens in `:root` of `style.css`.

## Copy changes

| Where | Replace with |
|---|---|
| Hero `<h1>` | "A spec-driven harness that orchestrates Claude Code, Codex, and Gemini CLI — in parallel, on real branches, in real worktrees." |
| Hero subtitle `<p>` | "Write a spec once. Launch competing implementations. Let one agent judge another. Merge the diff that survives review." |
| New `#why` eyebrow | "Why a multi-agent harness" |
| New `#why` H2 | "Four reasons one agent isn't enough." |
| Quota-walls card body | Append the FONUT sentence: "Schedule specs to run when you have quota or while you sleep — no more FONUT (Fear Of Not Using Tokens)." |
| `#get-started` eyebrow | "Get started" |
| `#get-started` H2 | "Install in one command. Read what you need." |

## Tasks (in order)

1. **Extract `#why` section.** Cut the four `.why-card` (or equivalent) elements out of the hero markup, wrap in a new `<section id="why" class="section reveal">` immediately following the hero `</section>`. Move associated CSS selectors out of `.hero ...` scope to top-level. Verify in-page nav highlighting still resolves.
2. **Slim the hero.** Replace the `<h1>` block with the new single-sentence H1. Replace the subtitle `<p>` with the new sentence. Delete the wedge headline element entirely.
3. **Restore CTAs.** Add `.hero-actions` div under the subtitle with two `<a class="button">` elements as specified. Implement copy-on-click for the install command (vanilla JS, no dependency). Leave a `<!-- TODO: add `aigon init` CTA -->` marker for the future addition.
4. **Drop Kanban from hero.** Remove the `.hero-preview` Kanban `<img>`. Keep the Fleet triptych (`.hero-fleet-showcase`). Verify the lightbox still binds correctly with one fewer trigger.
5. **Move FONUT line.** Append the rewritten sentence to the quota-walls payoff card's body copy.
6. **Merge docs sections.** Delete the second "Documentation" section (`#explore-docs`). Move its four doc tiles into the existing `#docs` grid, rename `id` to `get-started`, update eyebrow + H2, update header nav anchor.
7. **Update header nav.** `#docs` → `#get-started`. Add `#why` between `#workflow` and `#dashboard` if it should be navigable; otherwise leave it out (recommendation: leave out, hero scrolls naturally into it).
8. **Update meta description.** Reflect the new H1 sentence — replace any wedge-derived copy.
9. **Smoke test.** Open in browser, click both new CTAs, click each fleet GIF (lightbox), tab through the hero with keyboard, scroll the page top to bottom and confirm no orphaned styles or empty containers.

## Suggested commit sequence

Each task above maps to one commit. Use these messages:

```
refactor(landing): extract Why Use Aigon into its own section
refactor(landing): replace wedge H1 with single-sentence headline
feat(landing): restore install + GitHub CTAs in hero with copy-on-click
refactor(landing): remove Kanban screenshot from hero, keep Fleet triptych
copy(landing): relocate FONUT line into quota-walls payoff card
refactor(landing): merge #docs and #explore-docs into #get-started
chore(landing): update header nav anchors and meta description
```

Keep each commit independently reviewable — do not squash. If any task touches CSS that another task also touches, prefer doing the CSS move in the first commit that needs it and leaving the next commit HTML-only.

## Out of scope

- Adding `npx aigon init` as a second CTA (separate spec, leave a code marker).
- Replacing mode emojis (🚗 🚛 ✈️ 🐝) — separate visual-polish ticket.
- Any changes to `#workflow`, `#dashboard`, `#community`, or the Pro strip beyond nav-anchor updates.
- Mobile-specific redesign — preserve existing breakpoints, just verify they still work after the markup move.

## Reference

Full design rationale and before/after mocks: `Landing Page Review v2.html` at the project root.
