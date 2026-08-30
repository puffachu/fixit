#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const [, , cmd, ...args] = process.argv;

function usage() {
  console.log(`fixit — zero-dependency terminal error fixer

Usage:
  fixit hook <command> <exitCode> <cwd> [outputFile]
      Emit one tab-separated suggestion: message<TAB>command<TAB>learned
      Prints nothing when there is nothing confident to say. Used by the shell hooks.

  fixit accept <command> <exitCode> <suggestion> [cwd]
      Record that a suggestion was accepted.

  fixit explain <command> <exitCode> [outputFile]
      Human-readable suggestions for a failure.

  fixit install     Print the shell integration snippet for $SHELL
  fixit version     Show version

Legacy JSON interface (still supported):
  fixit suggest '<json>' | fixit suggest-json '<json>'
`);
}

if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
  usage();
  process.exit(0);
}

if (cmd === 'version' || cmd === '--version') {
  console.log(require('../package.json').version);
  process.exit(0);
}

if (cmd === 'install') {
  const shell = process.env.SHELL || '';
  const file = shell.includes('zsh') ? 'fixit.zsh'
    : shell.includes('fish') ? 'fixit.fish'
      : shell.includes('bash') ? 'fixit.bash' : null;
  if (!file) {
    console.error(`Unknown shell: ${shell || '(unset)'}. Source one of these manually:`);
    console.error('  shell/fixit.bash  shell/fixit.zsh  shell/fixit.fish');
    process.exit(1);
  }
  console.log(fs.readFileSync(path.join(__dirname, '..', 'shell', file), 'utf8'));
  process.exit(0);
}

// Read captured stderr from a file. Passing it as an argv string breaks on long
// output and on anything the shell would re-interpret.
function readOutput(file) {
  if (!file) return '';
  try { return fs.readFileSync(file, 'utf8').slice(0, 8192); } catch { return ''; }
}

function computeFixes(command, exitCode, output, cwd) {
  const { gatherContext } = require('../src/context');
  const { findFixes } = require('../src/engine');
  // Context gathering shells out to git; skip it when no rule can use it.
  const needsFullContext = ![126, 127, 137].includes(exitCode);
  const ctx = needsFullContext
    ? gatherContext(cwd || process.cwd())
    : { cwd: cwd || process.cwd(), platform: process.platform };
  return findFixes(command || '', exitCode, output || '', ctx);
}

// Field separator for the `hook` output. Deliberately not a tab: a tab is an
// IFS whitespace character, so bash and zsh collapse repeated ones and a fix
// with no command would shift the `learned` flag into the command slot. 0x1f
// (unit separator) is non-whitespace, so empty fields survive.
const SEP = '';

// One line, one field: strip anything that would break the framing.
function field(value) {
  return String(value == null ? '' : value)
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

if (cmd === 'hook') {
  const [command, exitCodeRaw, cwd, outputFile] = args;
  const exitCode = Number.parseInt(exitCodeRaw, 10);
  if (!command || !Number.isFinite(exitCode)) process.exit(0);
  const fixes = computeFixes(command, exitCode, readOutput(outputFile), cwd);
  if (!fixes.length) process.exit(0);
  const best = fixes[0];
  process.stdout.write(
    [field(best.message), field(best.command), best.learned ? '1' : '0'].join(SEP) + '\n');
  process.exit(0);
}

if (cmd === 'accept') {
  const [command, exitCodeRaw, suggestion, cwd] = args;
  // Legacy JSON form: fixit accept '{"command":...}'
  if (command && command.trim().startsWith('{')) {
    const input = JSON.parse(command);
    require('../src/engine').recordAcceptance(
      input.command || '', input.exitCode == null ? 1 : input.exitCode,
      input.suggestion || '', { cwd: input.cwd });
    process.exit(0);
  }
  if (!command || !suggestion) process.exit(0);
  const exitCode = Number.parseInt(exitCodeRaw, 10);
  require('../src/engine').recordAcceptance(
    command, Number.isFinite(exitCode) ? exitCode : 1, suggestion,
    { cwd: cwd || process.cwd() });
  process.exit(0);
}

if (cmd === 'explain') {
  const [command, exitCodeRaw, outputFile] = args;
  const exitCode = Number.parseInt(exitCodeRaw, 10);
  const fixes = computeFixes(command || '', Number.isFinite(exitCode) ? exitCode : 1,
    readOutput(outputFile), process.cwd());
  if (!fixes.length) process.exit(0);
  console.log(require('../src/render').render(fixes));
  process.exit(0);
}

if (cmd === 'suggest' || cmd === 'suggest-json') {
  let input;
  try { input = JSON.parse(args[0] || '{}'); }
  catch { console.error('fixit: invalid JSON payload'); process.exit(1); }
  const fixes = computeFixes(
    input.command || '', input.exitCode == null ? 1 : input.exitCode,
    input.output || '', input.cwd);
  if (!fixes.length) process.exit(0);

  if (cmd === 'suggest') {
    console.log(require('../src/render').render(fixes));
  } else {
    const best = fixes[0];
    // `learned` drives the shells' "this came from you" highlight; it was
    // never sent before, so that highlight could never appear.
    console.log(JSON.stringify({
      message: best.message,
      command: best.command || '',
      learned: !!best.learned,
      confidence: best.confidence,
    }));
  }
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
usage();
process.exit(1);
