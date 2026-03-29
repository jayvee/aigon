'use strict';

/**
 * Append-only event log persistence (JSONL format).
 *
 * Ported from aigon-next/src/workflow/event-store.ts.
 */

const fs = require('fs/promises');
const path = require('path');

/**
 * Read all events from a JSONL file.
 * @param {string} eventsPath
 * @returns {Promise<object[]>}
 */
async function readEvents(eventsPath) {
  try {
    const content = await fs.readFile(eventsPath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Append a single event to the JSONL log.
 * @param {string} eventsPath
 * @param {object} event
 * @returns {Promise<void>}
 */
async function appendEvent(eventsPath, event) {
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
}

module.exports = { readEvents, appendEvent };
