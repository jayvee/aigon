'use strict';

/**
 * Thin assembly facade for dashboard status collection (F633).
 * Internals live in lib/dashboard-collect/ — one module per seam.
 */
const assembly = require('./dashboard-collect/assembly');
const logs = require('./dashboard-collect/logs');
const { collectDoneSpecs } = require('./dashboard-collect/safe-reads');
const { applySpecReviewFromSnapshots } = require('./dashboard-collect/infra-probes');

module.exports = {
    ...assembly,
    ...logs,
    applySpecReviewFromSnapshots,
    collectDoneSpecs,
};
