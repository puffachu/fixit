#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const [,, cmd, ...args] = process.argv;

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`fixit — zero-dependency terminal error fixer

Usage:
  fixit <command> [args...]

Commands:
  suggest   Read stdin for error output, suggest fixes
  install   Print shell integration snippet
  version   Show version
`);
  process.exit(0);
}

if (cmd === 'version') {
  console.log(require('../package.json').version);
  process.exit(0);
}

if (cmd === 'install') {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) {
    console.log(fs.readFileSync(path.join(__dirname, '../shell/fixit.zsh'), 'utf8'));
  } else if (shell.includes('bash')) {
    console.log(fs.readFileSync(path.join(__dirname, '../shell/fixit.bash'), 'utf8'));
  } else if (shell.includes('fish')) {
    console.log(fs.readFileSync(path.join(__dirname, '../shell/fixit.fish'), 'utf8'));
  } else {
    console.error('Unknown shell. Available: zsh, bash, fish');
    console.error('Source the appropriate file from shell/');
    process.exit(1);
  }
  process.exit(0);
}

if (cmd === 'suggest') {
  const input = JSON.parse(args[0] || '{}');
  const { gatherContext } = require('../src/context');
  const { findFixes } = require('../src/engine');
  const ctx = gatherContext(input.cwd);
  const fixes = findFixes(input.command || '', input.exitCode ?? 1, input.output || '', ctx);
  if (fixes.length === 0) {
    process.exit(0); // silent when nothing to say
  }
  const { render } = require('../src/render');
  console.log(render(fixes));
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
process.exit(1);
