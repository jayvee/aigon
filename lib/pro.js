'use strict';

let pro = null;
try { pro = require('@aigon/pro'); } catch { /* free tier — @aigon/pro not installed */ }

module.exports = {
    isProAvailable: () => !!pro,
    getPro: () => pro,
};
