# Evaluation: Feature 210 - analogies-for-landing-page

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-210-analogies-for-landing-page.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/.aigon/worktrees/aigon/feature-210-cc-analogies-for-landing-page`
- [x] **cu** (Cursor): `/Users/jviner/.aigon/worktrees/aigon/feature-210-cu-analogies-for-landing-page`

## Evaluation Criteria

| Criteria | cc | cu |
|---|---|---|
| Code Quality | 6/10 | 8/10 |
| Spec Compliance | 6/10 | 9/10 |
| Performance | 7/10 | 8/10 |
| Maintainability | 6/10 | 8/10 |
| **Total** | **25/40** | **33/40** |

| Agent | Lines | Score |
|---|---|---|
| cc | 649 | 25/40 |
| cu | 799 | 33/40 |

### Strengths & Weaknesses

#### cc
- Strengths:
- Clean, compact vanilla-JS implementation with crossfade, dot navigation, swipe support, and GA4 wiring.
- Delivers the required hero copy and placeholder GA4 snippet without introducing new dependencies.
- Weaknesses:
- Hover pause resumes immediately on `mouseleave`, not after the 10 second idle period called for in the spec's technical approach.
- `start_position` is emitted from the currently visible slide on auto transitions and omitted for manual impressions, so it does not reliably preserve the original randomized starting slide for analysis.
- No screenshot-backed Playwright verification and no landing-specific test command were added.
- Accessibility is thinner than the alternative: dots do not expose current state and inactive slides are only visually hidden.

#### cu
- Strengths:
- More complete interaction model: dot navigation, prev/next arrows, swipe support, idle-resume timing, and focus/hover handling are all implemented coherently.
- Tracks `start_position` from the randomized initial slide consistently in impression events, which better matches the analytics requirement.
- Adds both a lightweight integration check and Playwright desktop/mobile screenshot tests, and those tests passed.
- Better accessibility posture with `aria-hidden`, `aria-current`, button types, focus-visible states, and a grouped nav.
- Weaknesses:
- Still carries unrelated version/package churn in `package.json` and `package-lock.json`, which is noise for this feature.
- The implementation log is effectively empty, so the code had to stand on its own.

## Recommendation

**Winner:** cu

**Rationale:** `cu` is the stronger implementation because it satisfies more of the spec as written, especially the analytics/randomization detail and the required desktop/mobile screenshot verification. `cc` is serviceable, but it falls short on the 10-second resume behavior and leaves the `start_position` tracking too loose for reliable analysis.
