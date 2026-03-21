#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_pattern() {
  local pattern="$1"
  local file="$2"
  if ! rg -q -- "$pattern" "$file"; then
    echo "Missing required pattern '$pattern' in $file" >&2
    exit 1
  fi
}

# 1) Homepage includes the four-mode model and mode cards
require_pattern 'Drive mode' index.html
require_pattern 'Fleet mode' index.html
require_pattern 'Autopilot mode' index.html
require_pattern 'Swarm mode' index.html
require_pattern 'Hands-on \+ one agent' index.html
require_pattern 'Hands-on \+ multi-agent' index.html
require_pattern 'Hands-off \+ one agent' index.html
require_pattern 'Hands-off \+ multi-agent' index.html

# 2) Terminal examples are organized by mode
require_pattern 'data-demo="drive"' index.html
require_pattern 'data-demo="fleet"' index.html
require_pattern 'data-demo="autopilot"' index.html
require_pattern 'data-demo="swarm"' index.html
require_pattern 'aigon feature-autopilot 07' index.html
require_pattern 'aigon feature-setup 07 cc gg cx' index.html
require_pattern 'aigon feature-autopilot 07 --auto-submit' index.html

# Swarm setup currently does not take --autonomous; autonomous happens at implement step
if rg -n 'feature-setup [^`[:cntrl:]]*--autonomous' index.html >/dev/null; then
  echo "Found invalid Swarm command: feature-setup ... --autonomous" >&2
  exit 1
fi

# 3) Guardrail: no legacy mode terms on the homepage
if rg -n -i 'solo mode|arena mode|ralph mode|ralph loop|--ralph' index.html >/dev/null; then
  echo "Found legacy mode terminology in index.html" >&2
  exit 1
fi

# 4) Radar section reflects current monitoring model
require_pattern '<li><a href="#radar" class="nav-link">Radar</a></li>' index.html
require_pattern '<section class="section reveal" id="radar">' index.html
require_pattern 'Radar: one service, every view\.' index.html
require_pattern 'aigon radar add' index.html
require_pattern 'aigon radar start' index.html
require_pattern 'aigon radar install' index.html
require_pattern 'aigon radar open' index.html
require_pattern 'img/aigon-radar-dashboard.png' index.html
require_pattern 'macOS notifications' index.html
require_pattern 'VS Code sidebar' index.html

if rg -n 'aigon conductor|href="#menubar"|id="menubar"' index.html >/dev/null; then
  echo "Found stale menubar/conductor content in index.html" >&2
  exit 1
fi

test -f img/aigon-radar-dashboard.png || {
  echo "Missing dashboard image asset: img/aigon-radar-dashboard.png" >&2
  exit 1
}

# 5) Narrative order on homepage: problem -> value -> modes -> demo -> loop -> workflow -> radar -> docs
problem_line="$(rg -n '<section class="section reveal" id="problem">' index.html | cut -d: -f1)"
value_line="$(rg -n '<section class="section reveal" id="value">' index.html | cut -d: -f1)"
modes_line="$(rg -n '<section class="section reveal" id="modes">' index.html | cut -d: -f1)"
demo_line="$(rg -n '<section class="section reveal" id="demo">' index.html | cut -d: -f1)"
loop_line="$(rg -n '<section class="section reveal" id="loop">' index.html | cut -d: -f1)"
workflow_line="$(rg -n '<section class="section reveal" id="workflow">' index.html | cut -d: -f1)"
radar_line="$(rg -n '<section class="section reveal" id="radar">' index.html | cut -d: -f1)"
docs_line="$(rg -n '<section class="section reveal" id="docs">' index.html | cut -d: -f1)"

if ! (( problem_line < value_line && value_line < modes_line && modes_line < demo_line && demo_line < loop_line && loop_line < workflow_line && workflow_line < radar_line && radar_line < docs_line )); then
  echo "Homepage section order does not match required narrative flow" >&2
  exit 1
fi

echo "Mode content checks passed."
