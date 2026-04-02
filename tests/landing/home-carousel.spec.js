// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const homeUrl = pathToFileURL(path.join(__dirname, '../../site/public/home.html')).href;

test.describe('Landing hero analogy carousel', () => {
  test('desktop viewport: carousel visible and screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(homeUrl);
    const carousel = page.locator('.analogy-carousel');
    await expect(carousel).toBeVisible();
    await expect(carousel).toHaveClass(/is-ready/);
    await expect(page.locator('.analogy-slide.is-active')).toHaveCount(1);
    await page.screenshot({
      path: path.join(__dirname, '../../test-results/landing-hero-desktop.png'),
    });
  });

  test('mobile viewport: carousel visible and screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(homeUrl);
    const carousel = page.locator('.analogy-carousel');
    await expect(carousel).toBeVisible();
    await expect(carousel).toHaveClass(/is-ready/);
    await page.screenshot({
      path: path.join(__dirname, '../../test-results/landing-hero-mobile.png'),
    });
  });
});
