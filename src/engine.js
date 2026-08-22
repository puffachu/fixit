'use strict';
const rules = require('./rules');
const learn = require('./learn');

function findFixes(command, exitCode, output, context) {
  if (exitCode === 0) return [];
  const fixes = [];

  // Multi-command awareness: split on && and ; to find which part failed
  const segments = command.split(/&&|;/).map(s => s.trim()).filter(Boolean);
  let effectiveCommand = command;
  if (segments.length > 1) {
    // Estimate which segment failed based on output position or last segment
    // For now, check each segment against rules too
    for (const seg of segments) {
      const segFixes = _runRules(seg, exitCode, output, context);
      fixes.push(...segFixes.map(f => ({ ...f, message: `[${seg.slice(0, 30)}] ${f.message}` })));
    }
  }

  effectiveCommand = command;
  const learned = learn.findSimilar({ failedCommand: command, exitCode });
  if (learned && learned.entry.suggestedCommand) {
    fixes.push({
      message: 'Based on your history:',
      command: learned.entry.suggestedCommand,
      confidence: 0.98,
      learned: true
    });
  }

  // Only run rules on full command if no segment-specific fix was found
  if (!fixes.some(f => !f.learned)) {
    fixes.push(..._runRules(effectiveCommand, exitCode, output, context));
  }

  if (fixes.some(f => f.confidence >= 0.95)) return fixes.sort((a,b) => b.confidence - a.confidence).slice(0, 5);

  return fixes.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function _runRules(command, exitCode, output, context) {
  const results = [];
  for (const rule of rules) {
    try {
      const result = rule.match({ command, exitCode, output, context });
      if (Array.isArray(result)) results.push(...result);
      else if (result) results.push(result);
    } catch {}
  }
  return results.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

function recordAcceptance(failedCommand, exitCode, suggestedCommand, context) {
  learn.record({ failedCommand, exitCode, suggestedCommand, accepted: true, context });
}

module.exports = { findFixes, recordAcceptance };
