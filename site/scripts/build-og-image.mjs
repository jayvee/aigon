// Builds the open-graph share image for aigon.build at site/public/img/og-image.png
// Renders an HTML template with playwright at 1200x630 and saves it as a PNG.
//
// Run from repo root:
//   node site/scripts/build-og-image.mjs
//
// Re-run whenever the headline / brand mark changes.

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../public/img/og-image.png");

const html = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    font-family: 'Manrope', system-ui, sans-serif;
    background: #f7f2e8;
    color: #1a1816;
    position: relative;
    overflow: hidden;
  }

  /* Diagonal stripe pattern matching the site */
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0,
      transparent 22px,
      rgba(160, 105, 60, 0.06) 22px,
      rgba(160, 105, 60, 0.06) 23px
    );
  }

  .frame {
    position: relative;
    width: 100%;
    height: 100%;
    padding: 64px 72px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    z-index: 1;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .mark {
    width: 64px;
    height: 64px;
    border-radius: 14px;
    background: #0a0a0b;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mark svg { display: block; }

  .wordmark {
    font-family: 'Sora', sans-serif;
    font-weight: 800;
    font-size: 32px;
    letter-spacing: -0.02em;
    color: #0a0a0b;
  }

  .eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 16px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #c2410c;
    margin-bottom: 18px;
  }

  .headline {
    font-family: 'Sora', sans-serif;
    font-weight: 800;
    font-size: 76px;
    line-height: 1.02;
    letter-spacing: -0.025em;
    color: #0a0a0b;
    max-width: 1000px;
  }

  .headline em {
    font-style: normal;
    color: #c2410c;
  }

  .sub {
    font-family: 'Manrope', sans-serif;
    font-size: 24px;
    line-height: 1.4;
    color: #4a4540;
    max-width: 900px;
    margin-top: 22px;
  }

  .footer {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 32px;
  }

  .badges {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 14px;
    font-weight: 500;
    padding: 8px 14px;
    border-radius: 999px;
    background: rgba(10, 10, 11, 0.06);
    border: 1px solid rgba(10, 10, 11, 0.12);
    color: #1a1816;
  }

  .url {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 18px;
    font-weight: 500;
    color: #1a1816;
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="top">
      <div class="mark">
        <svg width="40" height="40" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <polygon points="32,14 50,32 32,50 14,32" fill="white"/>
          <line x1="20" y1="20" x2="44" y2="44" stroke="#0a0a0b" stroke-width="5"/>
        </svg>
      </div>
      <div class="wordmark">AIGON</div>
    </div>

    <div>
      <div class="eyebrow">Spec-driven · Multi-agent</div>
      <h1 class="headline">
        Run AI coding agents <em>head-to-head</em>.<br>
        Ship the best one.
      </h1>
      <p class="sub">
        Open-source orchestration for Claude, Gemini, Cursor, and Codex —
        with a Kanban board, slash commands, and your own API keys.
      </p>
    </div>

    <div class="footer">
      <div class="badges">
        <div class="badge">Claude Code</div>
        <div class="badge">Gemini</div>
        <div class="badge">Cursor</div>
        <div class="badge">Codex</div>
      </div>
      <div class="url">aigon.build</div>
    </div>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: "networkidle" });
// Give web fonts a moment to settle even after networkidle
await page.waitForTimeout(400);
mkdirSync(dirname(outPath), { recursive: true });
const png = await page.screenshot({
  type: "png",
  clip: { x: 0, y: 0, width: 1200, height: 630 },
  omitBackground: false,
});
writeFileSync(outPath, png);
await browser.close();

console.log(`Wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
