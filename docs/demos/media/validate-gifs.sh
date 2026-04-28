#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GIF_DIR="$ROOT_DIR/docs/demos/media/gifs"
MAX_BYTES=$((3 * 1024 * 1024))
EXPECTED=(
  "01-board-at-a-glance.gif"
  "02-live-fleet-progress.gif"
  "03-feature-in-30-seconds.gif"
  "04-research-autopilot.gif"
  "05-eval-and-close.gif"
)

if ! command -v identify >/dev/null 2>&1; then
  echo "error: ImageMagick identify is required (brew install imagemagick)" >&2
  exit 1
fi

fail=0
for name in "${EXPECTED[@]}"; do
  file="$GIF_DIR/$name"
  if [ ! -f "$file" ]; then
    echo "FAIL missing: $name"
    fail=1
    continue
  fi

  size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
  width=$(identify -format '%w\n' "$file[0]" | head -n1)
  delay_cs=$(identify -format '%T\n' "$file" | awk 'NF{print; exit}')

  if [ "$size" -ge "$MAX_BYTES" ]; then
    echo "FAIL oversize: $name ($size bytes)"
    fail=1
  fi

  if [ "$width" -ne 800 ]; then
    echo "FAIL width: $name (got ${width}px)"
    fail=1
  fi

  # GIF delays are centiseconds; 7cs is ~14.3fps and treated as 15fps target.
  if [ "$delay_cs" -gt 7 ] || [ "$delay_cs" -lt 6 ]; then
    echo "FAIL fps timing: $name (delay ${delay_cs}cs/frame, expected 6-7cs)"
    fail=1
  fi

done

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "PASS all promotional GIF checks"
