'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, report } = require('../_helpers');

const sourcePath = path.join(__dirname, '../../templates/dashboard/js/pipeline.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('    function sortColumnCards(');
const end = source.indexOf('\n    function columnDragActive(', start);
assert.ok(start >= 0 && end > start, 'sortColumnCards source must remain extractable');
const sandbox = {};
vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.sortColumnCards = sortColumnCards;`, sandbox, {
    filename: sourcePath,
});

// REGRESSION: R67 existed in the dashboard API but numeric ascending order hid it
// behind eight older Inbox cards and the "more" overflow control.
test('active research cards are ordered newest first regardless of numeric ID', () => {
    const cards = [
        { id: '54', name: 'old-numbered', createdAt: '2026-06-25T10:31:13.952Z' },
        { id: 'investigate-spdd', name: 'newer-unnumbered', createdAt: '2026-07-26T06:49:15.444Z' },
        { id: '67', name: 'software-factory-positioning', createdAt: '2026-08-04T13:32:31.804Z' },
        { id: '64', name: 'older-numbered', createdAt: '2026-06-25T10:31:13.954Z' },
    ];
    const ordered = sandbox.sortColumnCards(cards, 'inbox', 'research');
    assert.deepStrictEqual(Array.from(ordered, card => card.id), ['67', 'investigate-spdd', '64', '54']);
});

// REGRESSION: feature backlog order remains priority-like numeric ascending.
test('feature ordering is unchanged', () => {
    const ordered = sandbox.sortColumnCards([
        { id: '739', name: 'newer' },
        { id: '733', name: 'older' },
    ], 'backlog', 'features');
    assert.deepStrictEqual(Array.from(ordered, card => card.id), ['733', '739']);
});

report();
