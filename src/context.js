'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function safeExec(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', timeout: 2000, stdio: ['pipe','pipe','pipe'] }).trim(); }
  catch { return ''; }
}

function gatherContext(cwd = process.cwd()) {
  const ctx = {
    cwd,
    platform: process.platform,
    isGitRepo: false,
    gitBranch: '',
    gitStatus: '',
    packageManager: null,
    hasNodeModules: false,
    hasDockerfile: false,
    shell: path.basename(process.env.SHELL || ''),
    user: process.env.USER || '',
    home: process.env.HOME || '',
    path_dirs: (process.env.PATH || '').split(':'),
  };

  // Git context
  if (safeExec('git rev-parse --git-dir', cwd)) {
    ctx.isGitRepo = true;
    ctx.gitBranch = safeExec('git rev-parse --abbrev-ref HEAD', cwd);
    ctx.gitStatus = safeExec('git status --porcelain -b', cwd);
  }

  // Package manager detection
  if (fs.existsSync(path.join(cwd, 'package.json'))) ctx.packageManager = 'npm';
  else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) ctx.packageManager = 'cargo';
  else if (fs.existsSync(path.join(cwd, 'go.mod'))) ctx.packageManager = 'go';
  else if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) ctx.packageManager = 'pip';

  ctx.hasNodeModules = fs.existsSync(path.join(cwd, 'node_modules'));
  ctx.hasDockerfile = fs.existsSync(path.join(cwd, 'Dockerfile'));

  return ctx;
}

module.exports = { gatherContext };
