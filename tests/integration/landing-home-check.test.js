#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const homePath = path.join(__dirname, '../../site/public/home.html');
const html = fs.readFileSync(homePath, 'utf8');

assert.ok(html.includes('analogy-carousel'), 'home.html should include analogy-carousel');
assert.ok(html.includes('analogy_impression'), 'home.html should track analogy_impression');
assert.ok(html.includes('G-XXXXXXXXXX'), 'home.html should include GA4 placeholder ID');
assert.ok(html.includes('data-analogy="copilot"'), 'home.html should include copilot slide');
assert.ok(html.includes('data-analogy="cursor"'), 'home.html should include cursor slide');
assert.ok(html.includes('data-analogy="claude_code"'), 'home.html should include claude_code slide');

console.log('  ✓ landing home.html analogy carousel checks');
