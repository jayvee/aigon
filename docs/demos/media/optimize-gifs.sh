#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MEDIA_DIR="$ROOT_DIR/docs/demos/media"
RAW_DIR="$MEDIA_DIR/raw"
OUT_DIR="$MEDIA_DIR/gifs"
MAX_BYTES=$((3 * 1024 * 1024))

if ! command -v gifsicle >/dev/null 2>&1; then
  echo "error: gifsicle is required (brew install gifsicle)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

optimize_one() {
  local input="$1"
  local output="$2"
  local lossy=80
  local colors=64

  gifsicle -O3 --lossy="$lossy" --colors "$colors" --resize-width 800 "$input" -o "$output"

  local size
  size=$(stat -f%z "$output" 2>/dev/null || stat -c%s "$output")
  while [ "$size" -ge "$MAX_BYTES" ] && [ "$lossy" -le 500 ]; do
    lossy=$((lossy + 20))
    if [ "$colors" -gt 16 ]; then
      colors=$((colors / 2))
    fi
    gifsicle -O3 --lossy="$lossy" --colors "$colors" --resize-width 800 "$input" -o "$output"
    size=$(stat -f%z "$output" 2>/dev/null || stat -c%s "$output")
  done

  if [ "$size" -ge "$MAX_BYTES" ]; then
    echo "warning: $output is still over 3MB ($size bytes)" >&2
  fi

  echo "optimized: $(basename "$output") (${size} bytes, lossy=$lossy, colors=$colors)"
}

shopt -s nullglob
inputs=("$RAW_DIR"/*.gif)

if [ ${#inputs[@]} -eq 0 ]; then
  echo "No raw GIFs found in $RAW_DIR"
  exit 0
fi

for input in "${inputs[@]}"; do
  filename="$(basename "$input")"
  optimize_one "$input" "$OUT_DIR/$filename"
done

echo "done: optimized ${#inputs[@]} gif(s) into $OUT_DIR"
