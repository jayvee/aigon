#!/usr/bin/env node
/**
 * take-screenshots.js — Capture dashboard screenshots with Playwright
 *
 * Prerequisites:
 *   cd ~/src/brewboard
 *   aigon seed-reset ~/src/brewboard --force   # restore seed state with completed features
 *   aigon server start                          # dashboard at http://localhost:4100
 *
 * Then run:
 *   node site/scripts/take-screenshots.js
 *
 * Raw captures land in site/public/img/raw/. Crop and polish them, then move
 * finished files to site/public/img/ with the exact filenames the <Screenshot>
 * component expects.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DASHBOARD_URL = 'http://localhost:4100';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'img', 'raw');

const TARGETS = [
  // Existing screenshots to retake
  {
    name: 'aigon-dashboard-reports.png',
    url: `${DASHBOARD_URL}`,
    tab: 'reports',
    waitFor: '.reports-container',
  },
  {
    name: 'aigon-dashboard-reports-summary.png',
    url: `${DASHBOARD_URL}`,
    tab: 'reports',
    subTab: 'summary',
    waitFor: '.summary-cards',
  },
  {
    name: 'aigon-dashboard-reports-charts.png',
    url: `${DASHBOARD_URL}`,
    tab: 'reports',
    subTab: 'charts',
    waitFor: 'canvas',
  },
  // New screenshots
  {
    name: 'aigon-dashboard-reports-activity.png',
    url: `${DASHBOARD_URL}`,
    tab: 'reports',
    subTab: 'charts',
    waitFor: 'canvas',
    description: 'Token Activity time-series chart with activity-type colour coding',
  },
  {
    name: 'aigon-dashboard-reports-agent-breakdown.png',
    url: `${DASHBOARD_URL}`,
    tab: 'reports',
    subTab: 'charts',
    waitFor: 'canvas',
    description: 'Per-agent cost attribution view',
  },
  // Amplification (Pro) — may fail if Pro is not available
  {
    name: 'aigon-amplification-metrics.png',
    url: `${DASHBOARD_URL}`,
    tab: 'amplification',
    waitFor: '.amplification-container',
    description: 'Quality metrics leaderboard',
    requiresPro: true,
  },
  {
    name: 'aigon-amplification-charts.png',
    url: `${DASHBOARD_URL}`,
    tab: 'amplification',
    waitFor: 'canvas',
    description: 'Trend charts (cycle time, rework, cost-per-feature)',
    requiresPro: true,
  },
  {
    name: 'aigon-amplification-insights.png',
    url: `${DASHBOARD_URL}`,
    tab: 'amplification',
    waitFor: '.insights-card',
    description: 'AI insights / coaching card',
    requiresPro: true,
  },
];

async function navigateToTab(page, tab) {
  const tabButton = await page.$(`[data-tab="${tab}"], button:has-text("${tab}")`);
  if (tabButton) {
    await tabButton.click();
    await page.waitForTimeout(1000);
  }
}

async function navigateToSubTab(page, subTab) {
  const subTabButton = await page.$(`[data-subtab="${subTab}"], button:has-text("${subTab}")`);
  if (subTabButton) {
    await subTabButton.click();
    await page.waitForTimeout(1000);
  }
}

async function main() {
  // Check dashboard is reachable
  try {
    const response = await fetch(DASHBOARD_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    console.error(`\n❌ Dashboard not reachable at ${DASHBOARD_URL}`);
    console.error(`   Start it first: aigon server start\n`);
    console.error(`   Setup steps:`);
    console.error(`   1. cd ~/src/brewboard`);
    console.error(`   2. aigon seed-reset ~/src/brewboard --force`);
    console.error(`   3. aigon server start`);
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const captured = [];
  const skipped = [];

  for (const target of TARGETS) {
    try {
      await page.goto(target.url, { waitUntil: 'networkidle' });

      if (target.tab) {
        await navigateToTab(page, target.tab);
      }
      if (target.subTab) {
        await navigateToSubTab(page, target.subTab);
      }

      // Wait for the target element
      try {
        await page.waitForSelector(target.waitFor, { timeout: 5000 });
      } catch {
        if (target.requiresPro) {
          skipped.push({ name: target.name, reason: 'Pro tab not available' });
          continue;
        }
        // Try capturing anyway for non-Pro targets
      }

      await page.waitForTimeout(500); // let animations settle

      const outputPath = path.join(OUTPUT_DIR, target.name);
      await page.screenshot({ path: outputPath, fullPage: false });
      captured.push(target.name);
    } catch (err) {
      skipped.push({ name: target.name, reason: err.message });
    }
  }

  await browser.close();

  // Print checklist
  console.log('\n📸 Screenshot capture complete\n');

  if (captured.length > 0) {
    console.log('✅ Captured:');
    for (const name of captured) {
      console.log(`   ${OUTPUT_DIR}/${name}`);
    }
  }

  if (skipped.length > 0) {
    console.log('\n⏭️  Skipped:');
    for (const { name, reason } of skipped) {
      console.log(`   ${name} — ${reason}`);
    }
  }

  console.log('\n📋 Manual steps:');
  console.log('   1. Open raw screenshots in Preview / Figma');
  console.log('   2. Crop to the relevant panel/chart');
  console.log('   3. Move finished files to site/public/img/ (exact filenames above)');
  console.log('   4. The <Screenshot> component will automatically show them\n');
}

main();
