# Evaluation: Feature 126 - docs-site-build

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-126-docs-site-build.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-126-cc-docs-site-build`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-126-cx-docs-site-build`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 8/10 | 7/10 |
| Spec Compliance | 9/10 | 8/10 |
| Performance | 8/10 | 7/10 |
| Maintainability | 8/10 | 7/10 |
| **Total** | **33/40** | **29/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | +7165 / -3217 | 33/40 |
| cx | +11795 / -3207 | 29/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - **Rich, complete landing page** — 541-line page.tsx with all spec sections: hero, problem statement, CLI demo, value proposition, workflow overview with lifecycle diagram, all four modes (Drive/Fleet/Autopilot/Swarm), dashboard gallery with tabbed views (5 tabs), docs quickstart with install commands, philosophy section, community/footer
  - **Interactive terminal animation** — Full typing-effect component with per-character delays, cursor blink, scrolling, and three tabbed demos (Claude Code, Fleet Setup, Gemini CLI) showcasing different workflows
  - **Interactive dashboard gallery** — Tabbed component showing 5 dashboard views (Pipeline, Monitor, Statistics, Logs, Console) instead of static grid
  - **Well-structured Fumadocs theme** — Custom CSS variables for both light and dark mode using HSL values, Aigon brand colors defined via `@theme` block, landing gradient backgrounds
  - **Complete metadata** — OpenGraph tags, favicon configuration, metadataBase for aigon.build
  - **Data-driven components** — Problem cards, value cards, mode cards all extracted as arrays, making content easy to edit
  - **Smaller bundle** — 108 kB first load JS for landing vs cx's larger output
- Weaknesses:
  - **Sora font deferred** — Defined in CSS `--font-heading` variable but not loaded via `next/font`; falls back to Geist
  - **Version compatibility hack** — `lib/source.ts` casts `files` as a function to bridge fumadocs-mdx@11 / fumadocs-core@15 mismatch
  - **Uses `<img>` tags** — Landing page images use raw `<img>` instead of `next/image`
  - **No llms.txt or OG image routes** — Missing AI/LLM-friendly content endpoints

#### cx (Codex)
- Strengths:
  - **Sora font properly loaded** — Uses `next/font/google` to load Sora, applied as CSS variable
  - **Fumadocs extras** — llms.txt routes, llms-full.txt, per-page `.mdx` rewrite endpoints, OG image generation with `@takumi-rs/image-response`
  - **Shared layout config** — `lib/layout.shared.tsx` centralises nav options and git config for reuse across layouts
  - **MDX components registered** — `components/mdx.tsx` properly exports `useMDXComponents` with TerminalWindow exposed to MDX
  - **Turbopack root configured** — `turbopack.root` in next.config avoids workspace lockfile warnings
  - **Uses `next/image`** — Dashboard screenshots use optimised Image component
  - **More complete Fumadocs setup** — Lucide icons plugin, schema validation, processed markdown for LLM endpoints
- Weaknesses:
  - **Minimal landing page** — Only ~120 lines, covers hero + modes + dashboard screenshots. Missing: problem section, value proposition, workflow lifecycle, CLI quickstart, philosophy, community, footer
  - **No terminal typing animation** — TerminalWindow uses CSS `line-in` animation (fade + slide) but no character-by-character typing effect
  - **Hardcoded CSS classes** — `.eyebrow`, `.hero-title`, `.cta-primary` etc. defined in global.css rather than using Tailwind utilities or component-level styles
  - **Landing page content sparse** — Doesn't convey Aigon's full story or differentiation
  - **Larger package-lock** — 10,922 lines vs cc's 5,781 (extra deps for OG images, icons plugin)
  - **Missing spec sections** — No fleet showcase GIFs, no docs quickstart code block, no philosophy section

## Recommendation

**Winner:** cc (Claude)

**Rationale:** The landing page is the primary deliverable of this feature, and cc's implementation is dramatically more complete. It ports all the content sections from the original static site (hero, problem, CLI demo, value proposition, workflow with lifecycle diagram, four modes, dashboard gallery, quickstart, philosophy, community, footer) while cx's landing is a bare skeleton with just hero, modes, and screenshots. cc's interactive terminal with three agent demos and the tabbed dashboard gallery are polished, production-quality components. Both implementations build successfully and have proper Fumadocs/docs structure, but cc delivers what the spec actually asks for.

**Cross-pollination:** Before merging, consider adopting from cx: (1) the Sora font loading via `next/font/google` — cc deferred this, (2) the `llms.txt` / `llms-full.txt` / OG image routes — these are Fumadocs best practices for discoverability, and (3) the `components/mdx.tsx` with `useMDXComponents` pattern for exposing TerminalWindow to MDX content pages.
