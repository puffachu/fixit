'use strict';
const rules = require('./rules');
const learn = require('./learn');

function findFixes(command, exitCode, output, context) {
  if (exitCode === 0) return [];
  const fixes = [];

  const learned = learn.findSimilar({ failedCommand: command, exitCode });
  if (learned && learned.entry.suggestedCommand) {
    fixes.push({
      message: 'Based on your history:',
      command: learned.entry.suggestedCommand,
      confidence: 0.98,
      learned: true
    });
  }

  for (const rule of rules) {
    try {
      const result = rule.match({ command, exitCode, output, context });
      if (Array.isArray(result)) fixes.push(...result);
      else if (result) fixes.push(result);
    } catch {}
  }

  return fixes.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function recordAcceptance(failedCommand, exitCode, suggestedCommand, context) {
  learn.record({ failedCommand, exitCode, suggestedCommand, accepted: true, context });
}

module.exports = { findFixes, recordAcceptance };
