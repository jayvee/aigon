# Feature: Terminal Demo Section

## Purpose

The aigon.build homepage currently describes what Aigon does through text, cards, and workflow steps — but it never *shows* it. A developer landing on the site should be able to watch a realistic, scripted CLI session play out in front of them: commands typed character by character, outputs appearing instantly, the full back-and-forth of a real Aigon workflow. This builds immediate credibility with the target audience (developers) who respond to "show me how this actually works" far more than to marketing copy.

Aigon has several distinct modes of use. A single demo cannot represent them all. The solution must therefore support **multiple independently-authored demo scripts**, each showing a different Aigon scenario, surfaced through a tabbed UI above a shared terminal window.

## Target Audience

Developers evaluating Aigon — specifically those who work in the terminal daily and want to see CLI tool interactions before committing to install anything.

## User Story

> As a developer visiting aigon.build for the first time, I want to browse through realistic demos of different Aigon workflows — solo feature, arena mode, research — so I can see exactly what using Aigon feels like for the scenario that matches my use case.

---

## Proposed Solution

Add a new **"See It In Action"** section to `index.html` using [`animated-terminal.js`](https://github.com/atteggiani/animated-terminal.js) — a lightweight (~27KB) Web Components library loaded from CDN.

The section contains:

1. **A tab bar** — one tab per demo scenario
2. **A single shared `<terminal-window>`** — the active script plays inside it
3. **`<template>` elements** — one per scenario, each holding the `<terminal-line>` markup for that script
4. **Minimal vanilla JS** — swaps the active template into the terminal and restarts the animation on tab click

This architecture keeps all demo scripts in the HTML as first-class authored content, requires zero build tooling, and makes adding new demos as simple as adding a new `<template>` block and a corresponding tab button.

### Why animated-terminal.js

- **Declarative HTML** — the demo script lives in HTML markup, not a JS blob
- **Correct terminal behaviour** — input lines type out character by character; output lines appear instantly (like a real terminal)
- **CDN-deliverable** — one `<script>` tag, no build step, no npm
- **Viewport-triggered** — animation starts when the section scrolls into view, rewarding scroll engagement
- **Actively maintained** — v3.1 released October 2024
- **Fits the stack** — zero framework dependencies, works as a plain static file

---

## Demo Scripts

Each scenario is a self-contained authored script. The initial set covers the primary Aigon modes of use.

### Script 1 — Solo Feature

A developer creates a feature spec, assigns it an ID, and sets up a single-agent implementation.

```
> /aigon feature-create login-with-google

  Implement login with Google using OAuth 2.0.
  Support both redirect and popup flows.

  Created: docs/specs/features/01-inbox/feature-login-with-google.md

> /aigon feature-prioritise login-with-google

  Assigned ID: feature-07
  Moved to: 02-backlog ✓

> /aigon feature-setup feature-07 cc

  Creating worktree for 1 agent...
  ✓ cc  →  branch: feature-07-cc

  Open your agent and run: /aigon feature-implement feature-07
```

---

### Script 2 — Solo Research

A developer kicks off a research task for a single agent to investigate.

```
> /aigon research-create "auth strategy for mobile"

  Research topic created.
  File: docs/specs/research/01-inbox/research-auth-strategy-for-mobile.md

> /aigon research-prioritise "auth strategy for mobile"

  Assigned ID: research-03
  Moved to: 02-backlog ✓

> /aigon research-setup research-03 cc

  Creating worktree for 1 agent...
  ✓ cc  →  branch: research-03-cc

  Open your agent and run: /aigon research-conduct research-03
```

---

### Script 3 — Arena Feature

Multiple agents implement the same feature in parallel. The best implementation wins.

```
> /aigon feature-setup feature-07 cc cx cu

  Arena mode: 3 agents on feature-07

  Creating worktrees...
  ✓ cc  →  branch: feature-07-cc
  ✓ cx  →  branch: feature-07-cx
  ✓ cu  →  branch: feature-07-cu

  Launch each agent and run:
    /aigon feature-implement feature-07

> /aigon feature-eval feature-07

  Comparing 3 implementations...

  ● cc   Auth flow complete. 94 lines. Tests passing.
  ● cx   Auth flow complete. 71 lines. Tests passing.
  ● cu   Auth flow complete. 88 lines. Tests passing.

  Winner: cx  (most concise, full coverage)
  Merge when ready: /aigon feature-submit feature-07 cx
```

---

### Script 4 — Arena Research

Multiple agents research the same topic in parallel. Findings are synthesised into a shortlist of features.

```
> /aigon research-setup research-03 cc cx gg

  Arena mode: 3 agents on research-03

  Creating worktrees...
  ✓ cc  →  branch: research-03-cc
  ✓ cx  →  branch: research-03-cx
  ✓ gg  →  branch: research-03-gg

  Open each agent and run: /aigon research-conduct research-03

> /aigon research-synthesize research-03

  Reading findings from 3 agents...

  Consensus features identified:
    1. Passkey / biometric auth (all 3 agents)
    2. Social OAuth — Google + Apple (cc, cx)
    3. Magic link email flow (cx, gg)

  Spec drafts created in: 01-inbox/
```

---

### Script 5 — Feature with Ralph

A developer delegates feature implementation entirely to Ralph (an autonomous coding agent), with Aigon orchestrating the workflow.

```
> /aigon feature-now dark-mode

  Fast-tracking feature: dark-mode

  Creating spec...  ✓
  Prioritising...   feature-08 ✓
  Setting up...     ✓ ralph  →  branch: feature-08-ralph

  Handing off to Ralph.
  Ralph is implementing feature-08...

  ✓  CSS custom properties updated
  ✓  prefers-color-scheme media query added
  ✓  Toggle component built
  ✓  Tests passing

  Ready for review: /aigon feature-eval feature-08
```

---

## Technical Approach

### 1. CDN Script

Add a single deferred script tag to `<head>`:

```html
<script
  src="https://cdn.jsdelivr.net/gh/atteggiani/animated-terminal@3.1/animated-terminal.min.js"
  defer>
</script>
```

### 2. Section Structure

```html
<section class="section reveal" id="demo">
  <div class="container">

    <div class="section-head">
      <p class="eyebrow">In practice</p>
      <h2>See it in action</h2>
    </div>

    <!-- Tab bar -->
    <div class="demo-tabs" role="tablist">
      <button class="demo-tab is-active" data-demo="solo-feature"   role="tab">Solo feature</button>
      <button class="demo-tab"           data-demo="solo-research"   role="tab">Solo research</button>
      <button class="demo-tab"           data-demo="arena-feature"   role="tab">Arena feature</button>
      <button class="demo-tab"           data-demo="arena-research"  role="tab">Arena research</button>
      <button class="demo-tab"           data-demo="ralph"           role="tab">With Ralph</button>
    </div>

    <!-- Shared terminal window -->
    <div class="demo-wrap">
      <terminal-window id="demo-terminal" ps1="> ">
        <!-- Active script is injected here by JS -->
      </terminal-window>
    </div>

  </div>
</section>
```

### 3. Demo Scripts as `<template>` Elements

Each script lives in a `<template>` tag immediately after the section. Templates are inert HTML — they don't render or execute until cloned by JS:

```html
<!-- Solo feature script -->
<template id="demo-solo-feature">
  <terminal-line data="input" startDelay="600">/aigon feature-create login-with-google</terminal-line>
  <terminal-line data="output" lineDelay="300"> </terminal-line>
  <terminal-line data="output">  Implement login with Google using OAuth 2.0.</terminal-line>
  <terminal-line data="output">  Support both redirect and popup flows.</terminal-line>
  <terminal-line data="output"> </terminal-line>
  <terminal-line data="output">  Created: docs/specs/features/01-inbox/feature-login-with-google.md</terminal-line>
  <terminal-line data="input" lineDelay="900">/aigon feature-prioritise login-with-google</terminal-line>
  <terminal-line data="output" lineDelay="400"> </terminal-line>
  <terminal-line data="output">  Assigned ID: feature-07</terminal-line>
  <terminal-line data="output">  Moved to: 02-backlog ✓</terminal-line>
  <terminal-line data="input" lineDelay="900">/aigon feature-setup feature-07 cc</terminal-line>
  <terminal-line data="output" lineDelay="400">  Creating worktree for 1 agent...</terminal-line>
  <terminal-line data="output">  ✓ cc  →  branch: feature-07-cc</terminal-line>
  <terminal-line data="output"> </terminal-line>
  <terminal-line data="output">  Open your agent and run: /aigon feature-implement feature-07</terminal-line>
</template>

<!-- Arena feature script -->
<template id="demo-arena-feature">
  <!-- ... -->
</template>

<!-- etc. -->
```

This pattern means **adding a new demo requires only**:
1. A new `<template id="demo-{slug}">` block
2. A new `<button class="demo-tab" data-demo="{slug}">` in the tab bar

No JS changes needed.

### 4. Tab-Switch JavaScript

A small inline `<script>` at the end of `<body>` handles tab switching and animation restart:

```js
(function () {
  const terminal = document.getElementById('demo-terminal');
  const tabs = document.querySelectorAll('.demo-tab');

  function loadDemo(slug) {
    const tpl = document.getElementById('demo-' + slug);
    if (!tpl) return;
    // Replace terminal contents with the cloned template
    terminal.innerHTML = '';
    terminal.appendChild(tpl.content.cloneNode(true));
    // Re-initialise the animated-terminal.js Web Component
    terminal.init?.();
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('is-active'); });
      tab.classList.add('is-active');
      loadDemo(tab.dataset.demo);
    });
  });

  // Load first demo on page ready
  loadDemo('solo-feature');
})();
```

> **Note for implementer:** `animated-terminal.js` Web Components re-run their animation when their content changes via a MutationObserver. Verify this behaviour and, if needed, replace the `<terminal-window>` element entirely (remove + re-insert) to guarantee a clean reinitialisation.

### 5. `<terminal-line>` Attribute Reference

| Attribute | Effect |
|---|---|
| `data="input"` | Typed character-by-character with blinking cursor |
| `data="output"` | Appears instantly (real terminal behaviour) |
| `lineDelay="N"` | Wait N ms before this line starts (default 400ms) |
| `typingDelay="N"` | Ms per character (default 35ms) |
| `startDelay="N"` | Initial delay before the first line (on the `<terminal-window>`) |

### 6. Styling

The `<terminal-window>` Web Component renders its own dark chrome. Override to match the site's design tokens:

```css
/* demo-tabs */
.demo-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.demo-tab {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.8rem;
  padding: 0.35em 0.85em;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 180ms;
}

.demo-tab:hover,
.demo-tab.is-active {
  border-color: var(--accent-2);
  color: var(--accent-2);
  background: rgba(15, 119, 117, 0.06);
}

/* terminal container */
.demo-wrap {
  max-width: 740px;
  margin: 0 auto;
  box-shadow: var(--shadow-soft);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
```

Use `::part(terminal)` CSS selectors to align the component's internal background and text colours with `--terminal` (`#16181d`) and `--terminal-text` (`#d2f4e5`) where the library exposes them.

### 7. Section Placement

Insert the new section between the existing **Workflow** (`#workflow`) and **Docs** (`#docs`) sections — after the step-by-step conceptual guide, before the documentation links.

### 8. Navigation

Add a `Demo` link to the sticky `<nav>` pointing to `#demo`.

### 9. Fallback / No-JS

`<template>` elements and Web Components degrade silently with no JS. Add a `<noscript>` block inside `.demo-wrap` with a static `<pre>` showing the solo-feature script as plain text.

---

## Adding New Demo Scripts (Author's Guide)

To add a new scenario in future:

1. **Write the script** in the demo script format (see §Demo Scripts above)
2. **Add a `<template>`** immediately after the `#demo` section:
   ```html
   <template id="demo-{slug}">
     <terminal-line data="input">/aigon your-command</terminal-line>
     <terminal-line data="output">Your output here</terminal-line>
   </template>
   ```
3. **Add a tab button**:
   ```html
   <button class="demo-tab" data-demo="{slug}" role="tab">Label</button>
   ```
4. No JS changes required.

Scripts should:
- Show 3–6 commands maximum (keep each demo under ~45 seconds of animation)
- Use realistic Aigon command syntax (match actual CLI flags and output format)
- End on a clear, positive outcome (not mid-flow)
- Use `lineDelay="900"` between distinct commands to give breathing room

---

## Files to Change

| File | Change |
|---|---|
| `index.html` | Add `<script>` CDN tag; new `#demo` section with tab bar and terminal; `<template>` blocks for all 5 scripts; tab-switch JS; nav link |
| `css/style.css` | `.demo-tabs`, `.demo-tab`, `.demo-tab.is-active`, `.demo-wrap` styles; `::part()` overrides |

---

## Dependencies

- **`animated-terminal.js` v3.1** — CDN only, no local install
  - jsDelivr: `https://cdn.jsdelivr.net/gh/atteggiani/animated-terminal@3.1/animated-terminal.min.js`
  - Size: ~27KB minified · License: MIT
- **No other new dependencies**

---

## Acceptance Criteria

- [ ] A "See it in action" section appears between Workflow and Docs
- [ ] A tab bar shows all 5 scenario labels: Solo feature, Solo research, Arena feature, Arena research, With Ralph
- [ ] Clicking a tab replaces the terminal content and restarts the animation from the beginning
- [ ] Commands type out character by character; outputs appear instantly
- [ ] Each demo script plays a realistic, complete Aigon workflow
- [ ] The active tab is visually distinct (teal border/colour using `--accent-2`)
- [ ] The terminal window is visually consistent with the site's card aesthetic
- [ ] The section is responsive — tabs wrap on mobile, terminal has no horizontal scroll
- [ ] Adding a new demo requires only a new `<template>` and a new tab `<button>` — no JS changes
- [ ] The nav includes a link to `#demo`
- [ ] The page degrades gracefully if JS is disabled
- [ ] No new npm/build dependencies introduced
- [ ] Lighthouse performance score does not regress (CDN script is deferred)

---

## Out of Scope

- Interactive/real terminal (users cannot type commands)
- Looping animation (single playthrough per tab selection)
- Recording real Aigon sessions (scripts are hand-authored for clarity and polish)
- More than 5 initial demo scripts (add via the Author's Guide post-launch)
