# GIF Recording Guide

Quick reference for recording the 5 promotional GIFs.

## Setup

```bash
brew install gifsicle   # required for optimisation
```

### CleanShot X Settings
- **Mode**: Record Screen > Record as GIF
- **FPS**: 15fps (Preferences > Recording)
- **Cursor**: Enable "Highlight Clicks"
- **Resolution**: Record at 1x (not Retina)
- **Crop**: Tight crop around the relevant window

### Terminal Prep (CLI GIFs)
- Font size: 16-18pt
- Run `clear` before each take
- Pause 1-2s at key output moments
- Clean prompt (short path)

## The 5 Scenarios

| # | Name | Source | Duration | What to show |
|---|------|--------|----------|--------------|
| 1 | Board at a Glance | Dashboard | 5-8s | Kanban board with features across columns |
| 2 | Live Fleet Progress | Dashboard | 8-12s | Agent logs auto-updating via WebSocket |
| 3 | Feature in 30 Seconds | CLI | 10-15s | `/afn "add dark mode toggle"` end-to-end |
| 4 | Research Autopilot | CLI | 8-12s | `/arap R-005 cc cu` spawning agents |
| 5 | Eval & Close | CLI | 8-10s | `/afe F-042` then `/afcl F-042` lifecycle |

## Workflow

1. Record raw GIF in CleanShot X — save to `raw/`
2. Trim in CleanShot's built-in editor
3. Run optimisation:
   ```bash
   ./optimize-gifs.sh
   ```
4. Verify all outputs in `gifs/` are under 3MB
5. Rename to match the expected filenames:
   - `01-board-at-a-glance.gif`
   - `02-live-fleet-progress.gif`
   - `03-feature-in-30-seconds.gif`
   - `04-research-autopilot.gif`
   - `05-eval-and-close.gif`
