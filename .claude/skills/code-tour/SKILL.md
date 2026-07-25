---
name: code-tour
description: Maintain docs/code-tour.md — the annotated guided reading of Aigon's core logic. Use when you have changed code the tour quotes, added a subsystem a new reader would need, or the user says "update the code tour", "the tour is stale", "add X to the code tour", or asks to review/refresh the code examples doc.
---

# code-tour

`docs/code-tour.md` is the annotated guided reading of Aigon's core logic — 25 core
sections built around verbatim source excerpts, in the order the machinery runs, each
with commentary on what it does and why it is shaped that way. Its reader is someone who
does **not** routinely read the code and wants an accurate mental model of the system.

You are its maintainer. It is part of the internal doc set, alongside `docs/architecture.md`.

> This file is plain markdown and agent-agnostic. Non-Claude agents: read and follow it
> directly; there is nothing Claude-specific below.

---

## When to act

**Update the tour when:**

- You changed a file the tour quotes — even a whitespace edit above the excerpt shifts the
  line anchor.
- You changed the *behaviour* of a quoted function, whether or not the lines moved.
- You added or substantially reworked a subsystem that a new reader would need to
  understand the system (see [Adding a section](#adding-a-section) — the bar is high).
- You removed or renamed something the tour references.

**Do not touch it when:**

- Your change is in a file the tour doesn't quote and doesn't alter any pattern it teaches.
- You "improved the prose". The commentary is deliberate; don't churn it.
- You want to document a bugfix. That belongs in the spec's implementation log, not here.

**Check first, always:**

```bash
node scripts/check-code-tour.js
```

Validates that every JavaScript excerpt has a dedicated, aligned `file:line` anchor and
that every retained excerpt segment is byte-identical to its source. It also checks all
inline anchors for missing files and out-of-range lines. Run this before you decide
whether there is work to do — often there isn't.

---

## The rules

These are what make the document trustworthy. Breaking them silently is worse than leaving
the tour stale, because a reader who can't trust one excerpt can't trust any of them.

**1. Excerpts are verbatim.** Copy the real bytes out of the real file. Never retype from
memory, never tidy, never rename a variable to read better, never fix a typo in a comment.
If the code is ugly, the tour shows ugly code. Elision is the *only* permitted edit, and
only as a standalone `// …` line where you dropped something.

**2. Every excerpt carries a resolving anchor.** The format is a bold inline code span with
a **repo-root-relative** path:

```markdown
**`lib/workflow-core/engine.js:1117`**
```

Bare basenames (`engine.js:1117`) do not resolve and will fail the checker. Prose mentions
use the same full-path form so they're checked too.

**3. The anchor points at the declaration the excerpt opens with.** Not the docblock above
it, not the file top. For a deliberately partial or comment-only excerpt, anchor the first
retained statement. The checker enforces this alignment.

**4. Commentary explains the *why*, not the *what*.** A reader can see that a function
loops over events. What they cannot see is that the loop has two paths because seeding
events must go through the projector, or that a `.sort()` exists because non-determinism
would make sets untestable. Prefer the reason over the restatement.

**5. Prefer the code's own comments.** This codebase carries excellent incident-driven
comments. When one explains the design better than you would, quote it inside the excerpt
and say so, rather than paraphrasing it in your own words above.

**6. Keep the running order.** The tour follows the flow of execution: entry → engine →
identity/storage → agents/sessions → orchestration → read side → install. A new section
goes where it belongs in that flow, not at the end.

**7. The freshness stamp is not optional.** Update the line near the top after any edit:

```markdown
> Last verified against `main` @ `<short-sha>` (`<YYYY-MM-DD>`).
```

Use the commit you verified against — `git rev-parse --short HEAD`.

---

## Updating an existing section

1. Run `node scripts/check-code-tour.js` and note which anchors or excerpts drifted.
2. Open the source file and locate the excerpt's opening declaration.
3. **Re-copy the excerpt from source**, even if it looks unchanged — this is the step that
   catches behaviour changes the checker cannot see. Do not hand-patch a line.
4. Update the anchor to the new line number.
5. Re-read your commentary against the new code. If the behaviour changed, the commentary
   is now wrong; rewrite it, don't leave it.
6. If the excerpt grew past ~45 lines, elide the middle with `// …` rather than shipping a
   wall of code. The tour is for reading.
7. Update the freshness stamp.
8. Re-run the checker and confirm it reports every excerpt as verbatim and aligned.

---

## Adding a section

The bar is **"a reader who understood everything else would still be missing this."** Not
"this is interesting" or "I just worked on it." The tour is a mental model, not a changelog
and not an index — twenty-five well-chosen examples beat fifty.

Good reasons to add: a new subsystem with its own persistence model; a new cross-cutting
decision point every other module has to route through; a pattern that now appears in five
places and is invisible in any one of them.

Bad reasons: a helper you're proud of; a bugfix; a module that is genuinely just CRUD.

**Section format** — match it exactly:

````markdown
## N. Short imperative title

**`path/to/file.js:LINE`**

One or two sentences: what this does and where it sits in the flow.

```js
<verbatim excerpt>
```

**The pattern:** *named pattern in italics*. Two to four sentences on why the code is
shaped this way — the constraint it satisfies, the failure it prevents, the incident it
came from.

Optional: a short paragraph on a subtlety, a trap, or what a reviewer should watch for.
````

When you add a section you **must** also:

- Renumber every following section, and every `§N` cross-reference in the body.
- Update the Contents list — heading anchors are auto-generated from the title, so the
  link target changes when the number does.
- Consider whether the tour's closing "Cross-cutting patterns" list earns a new entry.
  Usually it does not; five is a memorable number.

---

## Removing a section

Remove when the code is gone, or when the pattern it taught is no longer how the codebase
works. A tour that teaches a superseded pattern is actively harmful — worse than silence.

Renumber, fix `§N` references, fix the Contents list, update the freshness stamp.

---

## Verification before you finish

```bash
node scripts/check-code-tour.js   # anchors resolve; excerpts are verbatim and aligned
```

If you changed the checker itself, also run its focused regression test:

```bash
node tests/unit/check-code-tour.test.js
```

Then by eye:

- [ ] Every excerpt you touched was **re-copied from source**, not hand-patched.
- [ ] Section numbers are contiguous and every `§N` reference points at the right one.
- [ ] The Contents list matches the headings.
- [ ] The freshness stamp names the commit you actually verified against.
- [ ] No excerpt exceeds ~45 lines without elision.

The tour does not need the repository suite unless another touched file requires it. It
does need `git diff` read once before you commit — verbatim excerpts are exactly the thing
that gets silently mangled by an editor's auto-format.
