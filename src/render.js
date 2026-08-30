'use strict';
const config = require('./config');

function render(fixes) {
  const lines = [];
  const limit = Math.min(fixes.length, config.maxSuggestions());
  for (let i = 0; i < limit; i++) {
    const fix = fixes[i];
    const icon = i === 0 ? '●' : '○';
    // Purple marks a fix recalled from this user's own accepted history.
    const color = fix.learned ? '\x1b[35m' : '\x1b[36m';
    lines.push(`  ${color}${icon} ${fix.message}\x1b[0m`);
    if (fix.command) lines.push(`    \x1b[33m→ ${fix.command}\x1b[0m`);
  }
  return lines.join('\n');
}

module.exports = { render };
