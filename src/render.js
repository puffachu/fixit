'use strict';

function render(fixes) {
  const lines = [];
  for (let i = 0; i < Math.min(fixes.length, 3); i++) {
    const fix = fixes[i];
    const icon = i === 0 ? '●' : '○';
    lines.push(`  ${icon} ${fix.message}`);
    if (fix.command) lines.push(`    \x1b[36m→ ${fix.command}\x1b[0m`);
  }
  return lines.join('\n');
}

module.exports = { render };
