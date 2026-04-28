#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RAW_DIR="$ROOT_DIR/docs/demos/media/raw"
mkdir -p "$RAW_DIR"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg is required (brew install ffmpeg)" >&2
  exit 1
fi

# GIF 1: dashboard board overview
ffmpeg -hide_banner -loglevel error -y \
  -ss 4 -t 3 \
  -i "$ROOT_DIR/docs/images/aigon-dashboard-01-fleet-start.gif" \
  -vf "fps=15,scale=800:-1:flags=lanczos" \
  "$RAW_DIR/01-board-at-a-glance.gif"

# GIF 2: live fleet progress
ffmpeg -hide_banner -loglevel error -y \
  -ss 8 -t 3 \
  -i "$ROOT_DIR/docs/images/aigon-dashboard-02-fleet-evaluation.gif" \
  -vf "fps=15,scale=800:-1:flags=lanczos" \
  "$RAW_DIR/02-live-fleet-progress.gif"

# GIF 3: cli feature command flow
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 3 -i "$ROOT_DIR/docs/images/aigon-slash-commands-menu.png" \
  -loop 1 -t 4 -i "$ROOT_DIR/docs/images/aigon-warp-arena-split.png" \
  -filter_complex "[0:v]scale=800:450:force_original_aspect_ratio=decrease,pad=800:450:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=15[v0];[1:v]scale=800:450:force_original_aspect_ratio=decrease,pad=800:450:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=15[v1];[v0][v1]xfade=transition=fade:duration=0.7:offset=2.3,format=rgb24" \
  -t 6 \
  "$RAW_DIR/03-feature-in-30-seconds.gif"

# GIF 4: research autopilot with split terminals
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -t 7 -i "$ROOT_DIR/docs/images/aigon-research-arena-split.png" \
  -vf "fps=15,scale=960:-1:flags=lanczos,zoompan=z='min(zoom+0.0007,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=15:s=800x450,format=rgb24" \
  "$RAW_DIR/04-research-autopilot.gif"

# GIF 5: eval and close lifecycle
ffmpeg -hide_banner -loglevel error -y \
  -ss 10 -t 3 \
  -i "$ROOT_DIR/docs/images/aigon-dashboard-03-fleet-submitted.gif" \
  -vf "fps=15,scale=800:-1:flags=lanczos" \
  "$RAW_DIR/05-eval-and-close.gif"

echo "Generated raw GIFs in $RAW_DIR"
