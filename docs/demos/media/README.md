# Promotional GIF Demos

This folder stores promotional GIF demos used in README/docs/marketing.

## Deliverables
- `gifs/01-board-at-a-glance.gif`
- `gifs/02-live-fleet-progress.gif`
- `gifs/03-feature-in-30-seconds.gif`
- `gifs/04-research-autopilot.gif`
- `gifs/05-eval-and-close.gif`

All deliverables are optimized to:
- Width: 800px
- Frame timing: 6-7 centiseconds per frame (~15fps)
- Size: under 3MB each

## Rebuild Workflow
1. Regenerate raw clips:
   ```bash
   docs/demos/media/scripts/generate-promotional-gifs.sh
   ```
2. Optimize all raw GIFs with `gifsicle`:
   ```bash
   docs/demos/media/optimize-gifs.sh
   ```
3. Validate size/width/fps constraints:
   ```bash
   docs/demos/media/validate-gifs.sh
   ```

## Recording Notes For Future Captures
- Use 15fps and record at 1x resolution.
- For terminal demos, use 16-18pt font and a clean prompt.
- Keep captures short and tightly cropped to stay under 3MB.
