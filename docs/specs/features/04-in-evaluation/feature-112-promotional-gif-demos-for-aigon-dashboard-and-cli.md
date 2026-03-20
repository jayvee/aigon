# Feature: Promotional GIF demos for Aigon dashboard and CLI

## Summary
Create a set of 5 short, optimised GIF recordings demonstrating Aigon's dashboard and CLI workflows. These will be used in the README, docs site, and promotional materials to show the product in action without requiring full video production.

## User Stories
- [ ] As a potential user, I can see the Kanban board in action so I understand the visual project management aspect
- [ ] As a potential user, I can see live fleet progress updating in real-time so I understand the multi-agent orchestration
- [ ] As a potential user, I can see a single command creating a feature end-to-end so I understand the speed of the workflow
- [ ] As a potential user, I can see research autopilot spawning multiple agents so I understand the fleet capability
- [ ] As a potential user, I can see the eval/close lifecycle so I understand the full feature loop

## Acceptance Criteria
- [ ] 5 GIFs recorded and optimised, stored in `docs/media/gifs/`
- [ ] Each GIF is under 3MB after optimisation
- [ ] Each GIF is 800px wide, 15fps
- [ ] Terminal font is 16-18pt in all CLI recordings
- [ ] All GIFs have been run through `gifsicle` optimisation
- [ ] An `optimize-gifs.sh` script exists in `docs/media/` for repeatable optimisation

## Validation
```bash
# Check all GIFs exist and are under 3MB
for f in docs/media/gifs/*.gif; do
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  [ "$size" -lt 3145728 ] || echo "FAIL: $f is over 3MB ($size bytes)"
done
```

## Technical Approach

### Recording Tool: CleanShot X
- **Mode**: Record Screen > Record as GIF (not video)
- **FPS**: Set to 15fps in Preferences > Recording
- **Cursor**: Enable "Highlight Clicks" in preferences
- **Resolution**: Record at 1x (not Retina) to keep file sizes manageable
- **Crop**: Tight crop around relevant window area only

### Terminal Prep (for CLI GIFs)
- Font size: 16-18pt
- `clear` before each take
- Pause 1-2s at key output moments so viewers can read
- Clean prompt (no long paths or clutter)

### The 5 Scenarios

**GIF 1 — "Board at a Glance"** (Dashboard, ~5-8s)
- Open dashboard in browser
- Show Kanban board with features across columns (inbox, backlog, in-progress, done)
- Click between views or scroll to show breadth
- Key message: visual project management

**GIF 2 — "Live Fleet Progress"** (Dashboard, ~8-12s)
- Dashboard open with a feature in-progress
- Show agent logs/status auto-updating via WebSocket
- Multiple agents visible, progress streaming in
- Key message: real-time visibility into parallel work

**GIF 3 — "Feature in 30 Seconds"** (CLI, ~10-15s)
- Run `/afn "add dark mode toggle"`
- Watch spec creation, worktree setup, agent start
- Key message: one command from idea to implementation

**GIF 4 — "Research Autopilot"** (CLI, ~8-12s)
- Run `/arap R-005 cc cu`
- Show agents spawning in split terminals
- Key message: multi-agent fleet orchestration

**GIF 5 — "Eval & Close"** (CLI, ~8-10s)
- Run `/afe F-042` to evaluate
- Run `/afcl F-042` to close
- Show the review > merge > cleanup flow
- Key message: full lifecycle completion

### Optimisation Pipeline
1. Record raw GIF in CleanShot X (15fps, tight crop)
2. Trim in CleanShot's built-in editor
3. Run optimisation script:
   ```bash
   gifsicle -O3 --lossy=80 --colors 64 --resize-width 800 -o optimized.gif raw.gif
   ```
4. Verify under 3MB
5. Optionally generate WebM/MP4 fallbacks with `ffmpeg` for docs site

### Directory Structure
```
docs/media/
  optimize-gifs.sh          # Batch optimisation script
  gifs/
    01-board-at-a-glance.gif
    02-live-fleet-progress.gif
    03-feature-in-30-seconds.gif
    04-research-autopilot.gif
    05-eval-and-close.gif
  raw/                      # Gitignored raw recordings
```

## Dependencies
- CleanShot X (already installed on Mac)
- `brew install gifsicle` for optimisation
- `brew install gifski` (optional, for higher quality at smaller sizes)
- Dashboard running with realistic demo data (multiple features in various states)
- At least one feature in-progress with active agents for GIF 2

## Out of Scope
- Full video production with narration/music
- Animated SVG or Lottie alternatives
- Embedding GIFs in README (separate task)
- Docs site integration (separate task)

## Open Questions
- Should we add text overlay/captions to the GIFs, or keep them clean?
- Do we need a "before Aigon / after Aigon" comparison GIF?
- Should raw recordings be kept in a separate repo to avoid bloating the main repo?

## Related
- Future: README update to embed the GIFs
- Future: Docs site / landing page with GIF demos
