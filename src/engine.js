'use strict';

const rules = require('./rules');

function findFixes(command, exitCode, output, context) {
  if (exitCode === 0) return [];
  const fixes = [];
  for (const rule of rules) {
    try {
      const result = rule.match({ command, exitCode, output, context });
      if (result && Array.isArray(result)) {
        fixes.push(...result);
      } else if (result) {
        fixes.push(result);
      }
    } catch { /* rule errors are silent */ }
  }
  return fixes.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

module.exports = { findFixes };
