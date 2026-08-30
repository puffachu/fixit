'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { argv0, looksLikeCommand } = require('./cmd');

const LEARN_DIR = process.env.FIXIT_LEARN_DIR || path.join(os.homedir(), '.fixit');
const LEARN_FILE = path.join(LEARN_DIR, 'history.json');

// A fix you accepted once two months ago should not outrank a habit.
const RECENCY_HALFLIFE_MS = 60 * 24 * 60 * 60 * 1000;

// Token overlap required to call two failures "the same failure". The old code
// used 0.4 but added +0.2 for a matching exit code, and since exit 1 is
// near-universal the real threshold was 0.2 — one shared token out of five.
const MIN_SIMILARITY = 0.6;

// Confidence band for recalled fixes. Deliberately below the 0.95 of a
// deterministic rule match, so history can never bury a known-correct answer.
const CONF_MIN = 0.72;
const CONF_MAX = 0.90;

function load() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8')); }
  catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.filter(e =>
    e && typeof e.failedCommand === 'string' && typeof e.suggestedCommand === 'string');
}

function save(entries) {
  fs.mkdirSync(LEARN_DIR, { recursive: true });
  fs.writeFileSync(LEARN_FILE, JSON.stringify(entries.slice(-500), null, 2));
}

function record({ failedCommand, exitCode, suggestedCommand, accepted, context }) {
  if (!failedCommand || !suggestedCommand) return;
  // Never store something that isn't runnable, or a no-op.
  if (!looksLikeCommand(suggestedCommand)) return;
  if (suggestedCommand.trim() === failedCommand.trim()) return;

  const entries = load();
  const now = Date.now();
  const existing = entries.find(e =>
    e.failedCommand === failedCommand && e.suggestedCommand === suggestedCommand);

  if (existing) {
    // Collapse repeats into a weight instead of appending duplicates.
    existing.acceptCount = (existing.acceptCount || 1) + (accepted ? 1 : 0);
    existing.accepted = existing.accepted || !!accepted;
    existing.timestamp = now;
    if (context?.cwd) existing.cwd = context.cwd;
  } else {
    entries.push({
      failedCommand,
      exitCode,
      suggestedCommand,
      accepted: !!accepted,
      acceptCount: accepted ? 1 : 0,
      cwd: context?.cwd || '',
      timestamp: now,
    });
  }
  save(entries);
}

function tokenize(cmd) {
  return cmd.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function similarity(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  const intersection = [...sa].filter(t => sb.has(t)).length;
  const union = new Set([...sa, ...sb]).size;
  return intersection / union;
}

// Recall a past fix only when this really is the same failure: same program,
// same exit code, and substantial token overlap. All three are gates — none is
// a score bonus that can paper over a weak match.
function findSimilar({ failedCommand, exitCode }, minSimilarity = MIN_SIMILARITY) {
  const target = argv0(failedCommand);
  if (!target) return null;
  const now = Date.now();
  const scored = [];

  for (const e of load()) {
    if (!e.accepted) continue;
    if (e.exitCode !== exitCode) continue;
    if (argv0(e.failedCommand) !== target) continue;
    // Drops history poisoned by the old bug that stored bare paths as fixes.
    if (!looksLikeCommand(e.suggestedCommand)) continue;
    const sim = similarity(failedCommand, e.failedCommand);
    if (sim < minSimilarity) continue;
    const age = Math.max(0, now - (e.timestamp || 0));
    const recency = Math.pow(0.5, age / RECENCY_HALFLIFE_MS);
    const weight = Math.log2(1 + Math.max(1, e.acceptCount || 1));
    scored.push({ entry: e, similarity: sim, score: sim * recency * weight });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

// Similarity, not raw score, drives confidence: an exact repeat is trustworthy,
// a borderline 0.6 overlap is not, however often it was accepted.
function confidenceFor(match) {
  if (!match) return 0;
  const s = Math.max(0, Math.min(1, match.similarity ?? 0));
  const t = (s - MIN_SIMILARITY) / (1 - MIN_SIMILARITY);
  return Math.round((CONF_MIN + (CONF_MAX - CONF_MIN) * Math.max(0, t)) * 100) / 100;
}

module.exports = {
  record, findSimilar, similarity, confidenceFor, load, LEARN_FILE,
  MIN_SIMILARITY, CONF_MIN, CONF_MAX,
};
