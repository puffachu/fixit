'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const LEARN_DIR = process.env.FIXIT_LEARN_DIR || path.join(os.homedir(), '.fixit');
const LEARN_FILE = path.join(LEARN_DIR, 'history.json');

function load() {
  try { return JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8')); }
  catch { return []; }
}

function save(entries) {
  fs.mkdirSync(LEARN_DIR, { recursive: true });
  fs.writeFileSync(LEARN_FILE, JSON.stringify(entries.slice(-500), null, 2));
}

function record({ failedCommand, exitCode, suggestedCommand, accepted, context }) {
  if (!failedCommand || !suggestedCommand) return;
  const entries = load();
  entries.push({
    failedCommand,
    exitCode,
    suggestedCommand,
    accepted: !!accepted,
    cwd: context?.cwd || '',
    timestamp: Date.now()
  });
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

function findSimilar({ failedCommand, exitCode }, minScore = 0.4) {
  const entries = load().filter(e => e.accepted);
  if (!entries.length) return null;
  const scored = entries.map(e => ({
    entry: e,
    score: similarity(failedCommand, e.failedCommand) + (e.exitCode === exitCode ? 0.2 : 0)
  })).filter(s => s.score >= minScore).sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

module.exports = { record, findSimilar, similarity, load, LEARN_FILE };
