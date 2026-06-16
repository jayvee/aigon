'use strict';

const { MARKER_START, MARKER_END, readTemplate } = require('../../utils');

module.exports = function projectContextCommand() {
    return (args = []) => {
        const jsonOutput = args.includes('--json');
        const template = readTemplate('generic/agents-md.md');
        const markerMatch = template.match(new RegExp(`${MARKER_START}\\n([\\s\\S]*?)\\n${MARKER_END}`));
        const content = markerMatch ? markerMatch[1] : template.replace(MARKER_START, '').replace(MARKER_END, '');
        const text = content.trim();
        if (jsonOutput) {
            process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: text } }));
        } else {
            console.log(text);
        }
    };
};
