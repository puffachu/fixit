'use strict';
const path = require('path');
const { binExists } = require('./bins');

// Prefixes that wrap the real command; skipped when identifying the program.
const WRAPPERS = new Set(['sudo', 'nohup', 'time', 'env', 'nice', 'exec', 'command', 'stdbuf']);

// Shell builtins are runnable but never appear in PATH.
const BUILTINS = new Set([
  'cd', 'echo', 'export', 'source', '.', 'alias', 'unalias', 'set', 'unset',
  'eval', 'exit', 'pushd', 'popd', 'type', 'test', 'read', 'printf', 'local',
  'return', 'shift', 'trap', 'wait', 'jobs', 'fg', 'bg', 'umask', 'hash', 'history',
]);

function tokens(command) {
  return String(command || '').trim().split(/\s+/).filter(Boolean);
}

// The literal first token, with env assignments and wrappers stripped.
function rawArgv0(command) {
  const t = tokens(command);
  let i = 0;
  while (i < t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]) || WRAPPERS.has(path.basename(t[i])))) i++;
  return t[i] || '';
}

// Normalized program identity for comparing two commands: basename, lowercased,
// version suffix dropped so `../../bin/python` and `python3` compare equal.
function argv0(command) {
  const raw = rawArgv0(command);
  if (!raw) return '';
  const base = path.basename(raw).toLowerCase();
  const stripped = base.replace(/\d+(\.\d+)*$/, '');
  return stripped || base;
}

// Would this string actually run? Guards against storing a bare path as a
// "fix" — the bug that poisoned history with entries like `HN_LAUNCH.md`.
function looksLikeCommand(str) {
  const s = String(str || '').trim();
  if (!s) return false;
  const first = tokens(s)[0];
  if (!first) return false;
  if (/^[.~/]/.test(first)) return true;                      // explicit path
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) return true;     // VAR=x cmd
  const name = path.basename(first);
  if (BUILTINS.has(name) || binExists(name) || binExists(first)) return true;
  // Not installed here, which is fine — a fix may name a tool this machine
  // lacks. But reject a bare filename: that is the shape of the old bug.
  return !/\.[A-Za-z0-9]{1,6}$/.test(name);
}

// Quote-aware split on the operators that separate whole commands. The old
// `split(/&&|;/)` tore quoted strings apart (`awk 'BEGIN{print 1; print 2}'`).
function splitSegments(command) {
  const s = String(command || '');
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
    if ((ch === '&' && s[i + 1] === '&') || (ch === '|' && s[i + 1] === '|')) {
      out.push(cur); cur = ''; i++; continue;
    }
    if (ch === '|' || ch === ';') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Which part of a chain actually failed? Rules used to run on every segment,
// emitting one line each. The error output usually names the culprit.
function pickFailingSegment(command, output) {
  const segments = splitSegments(command);
  if (segments.length <= 1) return String(command || '').trim();
  const out = String(output || '');
  if (out) {
    // Most tools prefix their errors with `prog: `.
    for (const seg of segments) {
      const prog = path.basename(rawArgv0(seg));
      if (prog && new RegExp('(^|\\s)' + escapeRe(prog) + ':').test(out)) return seg;
    }
    for (const seg of segments) {
      const prog = path.basename(rawArgv0(seg));
      if (prog && new RegExp('\\b' + escapeRe(prog) + '\\b').test(out)) return seg;
    }
  }
  return segments[segments.length - 1];
}

// Swap one argument for its correction, preserving the rest of the command, so
// a path fix yields a runnable line rather than a naked filename.
function substituteArg(command, badArg, goodArg) {
  const s = String(command || '');
  const re = new RegExp('(^|\\s)(["\']?)' + escapeRe(badArg) + '(["\']?)(?=\\s|$)');
  if (!re.test(s)) return null;
  const quoted = /\s/.test(goodArg) ? JSON.stringify(goodArg) : goodArg;
  return s.replace(re, (_, pre) => pre + quoted);
}

module.exports = {
  tokens, rawArgv0, argv0, looksLikeCommand, splitSegments,
  pickFailingSegment, substituteArg, escapeRe, BUILTINS, WRAPPERS,
};
