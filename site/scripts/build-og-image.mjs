// Builds the open-graph share images for aigon.build.
//
// Run from repo root:
//   node site/scripts/build-og-image.mjs
//
// Outputs:
//   site/public/img/og-image.png
//   site/public/img/og-image-v2.png
//
// The versioned filename lets social platforms fetch a fresh card when
// they have cached an older visual.

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPaths = [
  resolve(__dirname, "../public/img/og-image.png"),
  resolve(__dirname, "../public/img/og-image-v2.png"),
];

const html = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    font-family: 'Manrope', system-ui, sans-serif;
    background:
      radial-gradient(circle at 94% 4%, rgba(213, 95, 42, 0.16), transparent 32%),
      radial-gradient(circle at 11% 24%, rgba(15, 119, 117, 0.13), transparent 36%),
      linear-gradient(180deg, #fffaf1 0%, #f7f2e8 58%, #f5efe3 100%);
    color: #171512;
    position: relative;
    overflow: hidden;
  }

  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, rgba(40, 25, 10, 0.055) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(40, 25, 10, 0.055) 1px, transparent 1px);
    background-size: 44px 44px;
    -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.25) 62%, transparent 100%);
    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.25) 62%, transparent 100%);
  }

  .frame {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    padding: 44px 64px 54px;
    display: grid;
    grid-template-columns: 1.06fr 0.94fr;
    gap: 48px;
    align-items: stretch;
  }

  .copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: space-between;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .mark {
    width: 58px;
    height: 58px;
    border-radius: 15px;
    background: #0b0b0c;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 18px 34px rgba(23, 21, 18, 0.14);
  }

  .mark svg { display: block; }

  .wordmark {
    font-family: 'Sora', sans-serif;
    font-weight: 800;
    font-size: 31px;
    color: #0b0b0c;
  }

  .kicker {
    margin-top: 24px;
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: 10px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #5f5851;
    padding: 10px 16px 10px 12px;
    border: 1px solid rgba(40, 25, 10, 0.12);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.56);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #d55f2a;
    box-shadow: 0 0 0 6px rgba(213, 95, 42, 0.15);
  }

  h1 {
    margin-top: 20px;
    font-family: 'Sora', sans-serif;
    font-size: 52px;
    line-height: 1.06;
    letter-spacing: -0.035em;
    font-weight: 800;
    max-width: 740px;
  }

  .accent { color: #c74812; }

  .sub {
    margin-top: 18px;
    max-width: 680px;
    color: #57504a;
    font-size: 21px;
    line-height: 1.42;
    font-weight: 600;
  }

  .install {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: 18px;
    margin-top: 22px;
    padding: 14px 18px;
    border-radius: 12px;
    background: #171512;
    color: #fffaf1;
    box-shadow: 0 18px 40px rgba(23, 21, 18, 0.18);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 16px;
    font-weight: 500;
  }

  .install span {
    padding: 5px 9px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.13);
    color: #f6cdb9;
    font-size: 13px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .footer {
    display: flex;
    align-items: center;
    gap: 14px;
    color: #5f5851;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 15px;
    font-weight: 600;
  }

  .footer b {
    color: #171512;
    font-weight: 600;
  }

  .visual {
    align-self: center;
    display: grid;
    gap: 14px;
  }

  .dashboard {
    border: 1px solid rgba(40, 25, 10, 0.13);
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.64);
    box-shadow: 0 30px 70px rgba(40, 25, 10, 0.14);
    overflow: hidden;
  }

  .dash-top {
    height: 58px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    border-bottom: 1px solid rgba(40, 25, 10, 0.1);
  }

  .window-dots {
    display: flex;
    gap: 8px;
  }

  .window-dots i {
    width: 10px;
    height: 10px;
    display: block;
    border-radius: 50%;
    background: rgba(23, 21, 18, 0.22);
  }

  .dash-label {
    font-family: 'IBM Plex Mono', monospace;
    color: #6b625b;
    font-size: 14px;
    font-weight: 600;
  }

  .board {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 18px;
  }

  .col {
    min-height: 250px;
    border: 1px solid rgba(40, 25, 10, 0.08);
    border-radius: 14px;
    background: rgba(250, 245, 234, 0.76);
    padding: 12px;
  }

  .col-title {
    margin-bottom: 12px;
    font-family: 'IBM Plex Mono', monospace;
    color: #6b625b;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .card {
    border: 1px solid rgba(40, 25, 10, 0.11);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.9);
    padding: 10px;
    margin-bottom: 9px;
  }

  .card strong {
    display: block;
    color: #171512;
    font-size: 14px;
    line-height: 1.2;
  }

  .card small {
    display: block;
    margin-top: 7px;
    color: #746b64;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    line-height: 1.35;
  }

  .card.active {
    border-color: rgba(213, 95, 42, 0.42);
    box-shadow: 0 12px 24px rgba(213, 95, 42, 0.12);
  }

  .card.win {
    border-color: rgba(15, 119, 117, 0.4);
    background: rgba(238, 249, 246, 0.96);
  }

  .terminal {
    display: block;
    align-items: center;
    border-radius: 18px;
    background: #171512;
    color: #f8f3ea;
    padding: 15px 18px;
    box-shadow: 0 22px 44px rgba(23, 21, 18, 0.22);
  }

  .terminal-code {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 14px;
    line-height: 1.45;
    color: #e8dfd4;
  }

  .terminal-code b { color: #f7b58f; font-weight: 600; }

  .badge-row {
    display: flex;
    gap: 8px;
  }

  .badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    font-weight: 600;
    padding: 7px 10px;
    border-radius: 999px;
    color: #d9fff8;
    background: rgba(15, 119, 117, 0.22);
    border: 1px solid rgba(121, 213, 196, 0.25);
  }
</style>
</head>
<body>
  <main class="frame">
    <section class="copy">
      <div>
        <div class="brand">
          <div class="mark">
            <svg width="40" height="40" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
              <polygon points="32,14 50,32 32,50 14,32" fill="white"/>
              <line x1="20" y1="20" x2="44" y2="44" stroke="#0b0b0c" stroke-width="5"/>
            </svg>
          </div>
          <div class="wordmark">AIGON</div>
        </div>

        <div class="kicker"><span class="dot"></span>Spec-driven agent orchestration</div>
        <h1>Run AI coding agents from <span class="accent">one spec</span>.</h1>
        <p class="sub">
          Parallel worktrees, kanban control, agent reviews, and LLM-as-judge evals.
          Everything stays in your repo.
        </p>
        <div class="install">$ npm install -g @senlabsai/aigon@next <span>Beta</span></div>
      </div>

      <div class="footer">
        <b>aigon.build</b>
        <span>/</span>
        <span>Claude Code · Codex · Gemini · Cursor</span>
      </div>
    </section>

    <section class="visual" aria-hidden="true">
      <div class="dashboard">
        <div class="dash-top">
          <div class="window-dots"><i></i><i></i><i></i></div>
          <div class="dash-label">localhost:4100 / fleet mode</div>
        </div>
        <div class="board">
          <div class="col">
            <div class="col-title">Spec</div>
            <div class="card">
              <strong>feature-42</strong>
              <small>markdown spec<br>acceptance criteria</small>
            </div>
            <div class="card">
              <strong>research</strong>
              <small>parallel findings</small>
            </div>
          </div>
          <div class="col">
            <div class="col-title">Agents</div>
            <div class="card active">
              <strong>Claude Code</strong>
            <small>worktree / cc42</small>
            </div>
            <div class="card active">
              <strong>Codex</strong>
            <small>worktree / cx42</small>
            </div>
            <div class="card active">
              <strong>Gemini</strong>
            <small>worktree / gg42</small>
            </div>
          </div>
          <div class="col">
            <div class="col-title">Eval</div>
            <div class="card win">
              <strong>Winner selected</strong>
              <small>judge notes<br>merge decision</small>
            </div>
            <div class="card">
              <strong>logs</strong>
              <small>stored in git</small>
            </div>
          </div>
        </div>
      </div>

      <div class="terminal">
        <div class="terminal-code">
          <b>$</b> aigon feature-start 42 cc cx gg<br>
          <b>$</b> aigon feature-eval 42
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const png = await page.screenshot({
  type: "png",
  clip: { x: 0, y: 0, width: 1200, height: 630 },
  omitBackground: false,
});

for (const outPath of outPaths) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
}

await browser.close();
