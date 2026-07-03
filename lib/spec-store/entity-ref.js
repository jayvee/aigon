'use strict';

const { parseSpecKey, entityTypeFromKind } = require('./spec-key');

/**
 * Pad numeric feature ids to the repo workflow-dir convention (`01`, `10`, …).
 * Research and slug ids pass through unchanged.
 *
 * @param {'feature'|'research'} entityType
 * @param {string|number} entityId
 * @returns {string}
 */
function padFeatureEntityId(entityType, entityId) {
  if (entityType !== 'feature') return String(entityId);
  const raw = String(entityId);
  if (!/^\d+$/.test(raw)) return raw;
  return String(parseInt(raw, 10)).padStart(2, '0');
}

/**
 * Normalize a SpecStore entity reference — display key (`F42`) or workflow address.
 *
 * @param {string | { entityType: string, entityId: string }} ref
 * @returns {{ entityType: 'feature'|'research', entityId: string }}
 */
function normalizeEntityRef(ref) {
  if (typeof ref === 'string') {
    const parsed = parseSpecKey(ref);
    const entityType = entityTypeFromKind(parsed.kind);
    return {
      entityType,
      entityId: padFeatureEntityId(entityType, parsed.number),
    };
  }
  if (ref && (ref.entityType === 'feature' || ref.entityType === 'research') && ref.entityId != null) {
    return { entityType: ref.entityType, entityId: String(ref.entityId) };
  }
  throw new Error('Invalid SpecStore entity reference');
}

module.exports = { normalizeEntityRef, padFeatureEntityId };
