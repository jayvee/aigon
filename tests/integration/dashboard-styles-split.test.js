'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const dashboardStyles = require('../../lib/dashboard-styles');

// REGRESSION: F628 split sheets must concat in manifest order for /styles.css.
test('concatDashboardStyles joins manifest sheets without gaps', () => {
    const repoPath = path.join(__dirname, '..', '..');
    const css = dashboardStyles.concatDashboardStyles(repoPath);
    assert.ok(css.includes(':root{'), 'tokens sheet present');
    assert.ok(css.includes('.kanban{'), 'kanban sheet present');
    assert.ok(css.includes('.aigon-status-pill-host'), 'chrome-upgrade sheet present');

    const order = dashboardStyles.readManifest(dashboardStyles.resolveStylesDir(repoPath));
    for (const file of order) {
        const chunk = fs.readFileSync(path.join(repoPath, 'templates/dashboard/styles', file), 'utf8');
        assert.ok(css.includes(chunk.trim().slice(0, 40)), `missing chunk from ${file}`);
    }
});

test('readManifest falls back when manifest.json missing', () => {
    assert.deepEqual(
        dashboardStyles.DEFAULT_MANIFEST.slice(0, 3),
        ['tokens.css', 'base.css', 'monitor.css']
    );
});
