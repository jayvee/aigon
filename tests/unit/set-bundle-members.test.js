'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    isSetStackIdleMember,
    shouldSkipSetStackMember,
    filterSetStackMembers,
} = require('../../templates/dashboard/js/set-bundle-members.js');

test('pre-start set members render as compact stack tiles', () => {
    const roll = { slug: 'deepen-create', memberCount: 4 };
    const inboxMember = { id: 'deepen-create-1-feature-prompt', stage: 'inbox' };
    assert.equal(isSetStackIdleMember(inboxMember, roll), true);
    assert.deepEqual(filterSetStackMembers([inboxMember], roll), [inboxMember]);
});

test('embedded current member is omitted from the stack', () => {
    const roll = {
        currentFeature: { id: '42' },
        currentFeatureContract: { entity: { id: '42' } },
    };
    const current = { id: '42', stage: 'in-progress', currentSpecState: 'implementing' };
    const waiting = { id: '43', stage: 'backlog' };
    assert.equal(shouldSkipSetStackMember(current, roll), true);
    assert.deepEqual(filterSetStackMembers([current, waiting], roll), [waiting]);
});

test('active set members keep full stack cards', () => {
    const roll = { slug: 'active-set' };
    const active = { id: '42', stage: 'in-progress', currentSpecState: 'implementing' };
    assert.equal(isSetStackIdleMember(active, roll), false);
});
