'use strict';
const rules = require('./rules');
const learn = require('./learn');
const config = require('./config');
const { argv0, pickFailingSegment } = require('./cmd');

// The user stopped it (Ctrl+C, SIGTERM). Not a failure to explain.
const SIGNAL_EXITS = new Set([130, 131, 143]);

// Programs where a nonzero exit is a normal answer ("no match", "files differ")
// rather than an error. Only silent when they also printed nothing to stderr.
const NEGATIVE_RESULT_OK = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'diff', 'cmp', 'test', '[',
  'false', 'pgrep', 'pidof', 'which', 'type', 'ping',
]);

// A failing test suite is expected output. Rules may still have something real
// to say about it (a missing import, say), but only at high confidence.
const TEST_RUNNERS = [
  /\bpytest\b/, /\bjest\b/, /\bvitest\b/, /\bmocha\b/, /\bphpunit\b/, /\brspec\b/,
  /\bgo\s+test\b/, /\bcargo\s+test\b/, /\bnode\s+--test\b/,
  /\b(?:npm|yarn|pnpm)\s+(?:run\s+)?test\b/,
];
const TEST_RUNNER_FLOOR = 0.9;

function findFixes(command, exitCode, output, context) {
  if (exitCode === 0) return [];
  const cmd = String(command || '').trim();
  if (!cmd) return [];
  const out = String(output || '');

  if (SIGNAL_EXITS.has(exitCode)) return [];
  if (NEGATIVE_RESULT_OK.has(argv0(cmd)) && !out.trim()) return [];

  let floor = config.minConfidence();
  if (TEST_RUNNERS.some(re => re.test(cmd))) floor = Math.max(floor, TEST_RUNNER_FLOOR);

  const fixes = [];

  // Rules see the segment that actually failed, not every segment in the chain.
  // Correcting the whole chain would be wrong anyway: an earlier `cd` changes
  // the directory a later path argument resolves against.
  const target = pickFailingSegment(cmd, out);
  fixes.push(..._runRules(target, exitCode, out, context));
  // Only fall back to the whole line if segment selection found nothing.
  if (!fixes.length && target !== cmd) fixes.push(..._runRules(cmd, exitCode, out, context));

  const learned = learn.findSimilar({ failedCommand: cmd, exitCode });
  if (learned && learned.entry && learned.entry.suggestedCommand) {
    fixes.push({
      message: 'Based on your history:',
      command: learned.entry.suggestedCommand,
      confidence: learn.confidenceFor(learned),
      learned: true,
    });
  }

  return _finalize(fixes, cmd, floor);
}

function _runRules(command, exitCode, output, context) {
  const results = [];
  for (const rule of rules) {
    if (rule.name && !config.isRuleEnabled(rule.name)) continue;
    try {
      const result = rule.match({ command, exitCode, output, context });
      if (Array.isArray(result)) results.push(...result);
      else if (result) results.push(result);
    } catch (err) {
      // A bare catch here hid a ReferenceError that disabled the no-such-file
      // rule for the project's entire history. Surface bugs when asked.
      if (process.env.FIXIT_DEBUG) {
        console.error(`fixit: rule "${rule.name}" threw: ${err && err.message}`);
      }
    }
  }
  return results;
}

function _finalize(fixes, originalCommand, floor) {
  const seen = new Set();
  const kept = [];
  for (const f of fixes) {
    if (!f || typeof f.message !== 'string' || !f.message.trim()) continue;
    const confidence = typeof f.confidence === 'number' ? f.confidence : 0;
    if (confidence < floor) continue;

    let command = typeof f.command === 'string' ? f.command.trim() : '';
    // Re-running exactly what just failed is not a fix.
    if (command && command === originalCommand.trim()) continue;

    const key = f.message + ' >> ' + command;
    if (seen.has(key)) continue;
    seen.add(key);

    const out = { ...f, confidence };
    if (command) out.command = command;
    else delete out.command;
    kept.push(out);
  }
  // On a tie a deterministic rule beats a recalled one.
  kept.sort((a, b) =>
    (b.confidence - a.confidence) || ((a.learned ? 1 : 0) - (b.learned ? 1 : 0)));
  return kept.slice(0, Math.max(1, config.maxSuggestions()));
}

function recordAcceptance(failedCommand, exitCode, suggestedCommand, context) {
  learn.record({ failedCommand, exitCode, suggestedCommand, accepted: true, context });
}

module.exports = { findFixes, recordAcceptance, SIGNAL_EXITS, NEGATIVE_RESULT_OK };
