# Feature: Extract inline data and templates from CLI monolith

## Summary

Extract all large inline data — HTML templates, profile preset strings, help text, and prompt templates — from `aigon-cli.js` into external files. This is Phase 1 of the CLI modularization effort. The goal is to reduce the main file by ~1,500–2,000 lines with zero logic changes. Every extraction is a mechanical move: cut the string out, put it in a file, load it at runtime.

## User Stories

- [ ] As a developer, I can edit the dashboard HTML/CSS/JS in proper `.html`/`.css`/`.js` files with syntax highlighting and linting, instead of editing a template literal buried inside a 11K-line JS file
- [ ] As a developer, I can modify profile-specific instructions (test instructions, dep check, manual testing guidance) in standalone Markdown files without touching `aigon-cli.js`
- [ ] As a developer, I can update help text without scrolling to line 11806 of the main file
- [ ] As a developer, I can tweak the Ralph autopilot prompt in a dedicated template file
- [ ] As a user, the CLI behaves identically before and after — no functional changes

## Acceptance Criteria

- [ ] `buildDashboardHtml()` loads its HTML from `templates/dashboard/index.html` instead of an inline template literal (~320 lines extracted)
- [ ] `PROFILE_PRESETS` string fields (`testInstructions`, `manualTestingGuidance`, `depCheck`) are loaded from `templates/profiles/<profile>/<field>.md` files (~50 lines of dense string data extracted, expanding to ~6 profiles x 3 fields = 18 files)
- [ ] `buildRalphPrompt()` loads its template from `templates/prompts/ralph-iteration.txt` (~25 lines extracted)
- [ ] The `help` command loads its text from `templates/help.txt` (~160 lines extracted)
- [ ] `getScaffoldContent()` loads from `templates/scaffold.md` if not already external (~30 lines extracted)
- [ ] `getRootFileContent()` loads from `templates/root-file.md` if not already external (~10 lines extracted)
- [ ] All new template files are committed and included in the npm package (`files` array in `package.json` if applicable)
- [ ] `node -c aigon-cli.js` passes (syntax check)
- [ ] `aigon help` output is identical before and after
- [ ] `aigon board` works correctly
- [ ] `aigon doctor` works correctly
- [ ] Dashboard HTML renders correctly (manual verification via `aigon radar open` or `aigon dashboard`)
- [ ] Profile placeholder injection still works: `aigon install-agent cc` produces correct agent commands with profile-specific content

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

### Dashboard HTML extraction

The `buildDashboardHtml()` function (lines 1326–1647) contains a 320-line HTML template literal with inline CSS and JS. Extract to `templates/dashboard/index.html` as a complete HTML file with a `${INITIAL_DATA}` placeholder. At runtime:

```javascript
function buildDashboardHtml(initialData) {
    const serializedData = escapeForHtmlScript(initialData);
    const html = fs.readFileSync(path.join(__dirname, 'templates/dashboard/index.html'), 'utf8');
    return html.replace('${INITIAL_DATA}', serializedData);
}
```

Keep it as a single HTML file (not split into .css/.js) because the dashboard is served as a single response and the inline approach is intentional for zero-dependency serving. The benefit is editability with HTML syntax highlighting.

### Profile preset extraction

Each profile (web, api, ios, android, library, generic) has string fields for `testInstructions`, `manualTestingGuidance`, and `depCheck`. Create:

```
templates/profiles/
  web/
    test-instructions.md
    manual-testing-guidance.md
    dep-check.md
  api/
    test-instructions.md
    ...
  ios/
    ...
  (etc.)
```

Load lazily on first access or at startup:

```javascript
function loadProfilePresetStrings(profile) {
    const dir = path.join(__dirname, 'templates/profiles', profile);
    return {
        testInstructions: fs.existsSync(path.join(dir, 'test-instructions.md'))
            ? fs.readFileSync(path.join(dir, 'test-instructions.md'), 'utf8').trimEnd()
            : '',
        manualTestingGuidance: fs.existsSync(path.join(dir, 'manual-testing-guidance.md'))
            ? fs.readFileSync(path.join(dir, 'manual-testing-guidance.md'), 'utf8').trimEnd()
            : '',
        depCheck: fs.existsSync(path.join(dir, 'dep-check.md'))
            ? fs.readFileSync(path.join(dir, 'dep-check.md'), 'utf8').trimEnd()
            : '',
    };
}
```

The `PROFILE_PRESETS` object retains `devServer` and `setupEnvLine` inline (they're small structured data, not prose).

### Help text extraction

Move the help string from the `help` command handler to `templates/help.txt`. Load and print:

```javascript
'help': () => {
    const helpText = fs.readFileSync(path.join(__dirname, 'templates/help.txt'), 'utf8');
    console.log(helpText);
},
```

### Ralph prompt extraction

Move the template string from `buildRalphPrompt()` to `templates/prompts/ralph-iteration.txt` with `{{PLACEHOLDER}}` markers. Use `processTemplate()` or simple `.replace()` to inject values at runtime.

### Scaffold and root file content

Check if `getScaffoldContent()` and `getRootFileContent()` still have inline strings. If so, extract to `templates/scaffold.md` and `templates/root-file.md`.

### Verification approach

Before starting, capture baseline outputs:
1. `aigon help > /tmp/help-before.txt`
2. `node -e "require('./aigon-cli.js')"` — ensure no import errors
3. `node -c aigon-cli.js` — syntax check

After each extraction, re-run the same checks and diff the output.

## Dependencies

- None — this is the first phase, no other features need to land first
- Should ideally land BEFORE feature-46 (command-vocabulary-rename) to reduce merge conflicts

## Out of Scope

- DRY refactoring of repeated code patterns (Phase 2: separate feature)
- Splitting `aigon-cli.js` into `lib/` modules (Phase 3: separate feature)
- Externalizing small data structures like `COMMAND_ALIASES`, `COMMAND_ARG_HINTS` (not enough volume to justify)
- Changing any logic or behavior — this is purely a "move strings to files" operation
- Adding a build step or bundler

## Open Questions

- Should the dashboard HTML be split into `.html` + `.css` + `.js` files and concatenated at build time, or kept as one HTML file? (Recommendation: one file for simplicity, but worth discussing)
- Should profile template files use `{{PLACEHOLDER}}` syntax for any dynamic content, or keep them as static strings? (Recommendation: static strings, since the current code just uses them as-is)

## Related

- Phase 2: "DRY refactoring of CLI helpers and command patterns" (to be created)
- Phase 3: "Modularize CLI into lib/ modules" (to be created)
- Current file: `aigon-cli.js` (11,434 lines)
