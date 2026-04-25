# Purpose 
The adopt flag is very powerful. This feature adds some examples into both the aigon README, GUIDE and the aigon-site marketing.

Here is a good example of an agent interaction:

NOTE: below should be replaced by the recent standard for being explicit about adoption.



  Strengths & Weaknesses

  cc (Claude):
  - Strengths: Client-side comparison avoids resolver round-trip (snappier UX). More tests (28 vs 25). Cleaner, leaner code. Multi-scenario seed fixture enables easy testing. Resolver exists and is tested but frontend doesn't depend
  on it.
  - Weaknesses: Resolver technically unused in the UI path (but tested and available for future use).

  cx (Codex):
  - Strengths: Resolver-first architecture follows spec more literally. Richer CSS with gradient backgrounds. Responsive grid layout.
  - Weaknesses: Extra resolver call on every project open (latency). Fewer tests (25 vs 28). No scoping validation test. No seed fixtures.

  Recommendation

  Winner: cc (Claude)

  Rationale:
  1. Better architecture — computing comparison client-side with the already-bundled @farline/planning library avoids an unnecessary resolver round-trip, giving snappier UX
  2. More comprehensive testing — 28 vs 25 tests, with 3 resolver tests (including scoping validation) vs 1
  3. Seed fixtures — multi-scenario YAML fixture makes future testing easier
  4. Leaner code — 450 vs 668 lines, achieving the same feature with less complexity

  Which implementation would you like to merge?
⏺ Looking at the diffs, cx has two things worth considering:

  1. Richer CSS styling — cx has gradient backgrounds, a 2-column responsive grid for best/worst cards, and more polished visual treatment (162 lines vs cc's 72 lines). cc's styling is functional but plainer.
  2. Delta metrics display — cx renders the time and cost deltas as separate metric cards (e.g. "4.3 weeks earlier", "6 units more") below the narrative, while cc only shows the narrative text.

  Neither is essential — cc's implementation is complete and correct. But if you want the comparison banner to look more polished in Jira, the CSS from cx could be worth adopting.

  Up to you — straight merge or --adopt cx?

  /aigon:feature-close 14 cc

❯ /aigon:feature-close 14 cc --adopt cx 