### Step 4.2: Automated browser verification

If Playwright verification is enabled in `.aigon/config.json`:

1. Ensure dev server is running (`aigon dev-server start` if not already started)
2. Create test fixture data for this feature in the configured fixtures directory (for example `tests/e2e/fixtures/`)
3. Write a Playwright test script that exercises the feature's acceptance criteria as end-to-end user flows
4. Run the test with video recording enabled:
   ```bash
   npx playwright test <test-file> --reporter=list --video=on --output=<artifacts-dir>
   ```
5. Use a clean browser context for reliable runs:
   - Add Chromium args such as `--no-first-run`, `--disable-default-apps`, `--password-store=basic`, `--disable-save-password-bubble`
   - Pre-seed localStorage/cookies where needed to skip onboarding or cookie banners
   - Use context options such as `acceptDownloads: true` and `ignoreHTTPSErrors: true` where appropriate
6. Publish a Playwright HTML report for user review:
   ```bash
   npx playwright test <test-file> --reporter=html
   npx playwright show-report --host 127.0.0.1 --port 9323
   ```
   Share both:
   - Local URL: `http://127.0.0.1:9323`
   - File path: `playwright-report/index.html`
7. Present results:
   - Pass/fail summary
   - Playwright report URL/path
   - Path to video recording(s) and/or screenshots
   - If tests failed: include failure details

**If `MANUAL_MODE`:** After automated verification, open a persistent browser for manual testing:
```bash
npx playwright open <dev-server-url>
```
Then continue to Step 4.5 (manual testing checklist). Keep the browser open for user testing.

**If `AUTO_SUBMIT_ACTIVE`:** Note artifact paths in the implementation log and proceed without waiting.
Include the Playwright report URL/path in the log as well.
