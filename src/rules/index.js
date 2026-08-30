'use strict';

// Each rule: { name, match({command, exitCode, output, context}) => fix | [fixes] | null }
// Fix: { message, command?, confidence: 0-1 }
//
// Confidence scale (the engine drops anything under config.minConfidence, 0.7):
//   0.95+  certain — the error names the problem and the fix is mechanical
//   0.85   very likely — one plausible reading of an unambiguous error
//   0.70   worth showing — actionable, but the user should look before running
// Below 0.7 means "stay silent", which is the point.

const fs = require('fs');
const path = require('path');
const { allBins, binExists } = require('../bins');
const { rawArgv0, substituteArg } = require('../cmd');
const { pythonPackageFor, installCommandFor, BINARY_PACKAGES } = require('../packages');

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

// Pick the single best correction for `name` among `entries`, scored 0-1.
// The old code took `matches[0]` — whatever readdir happened to return first —
// which is how `shadoww` came out as `gshadow` instead of `shadow`.
function bestCandidate(name, entries) {
  const target = String(name || '').toLowerCase();
  if (!target) return null;
  let best = null;
  for (const entry of entries) {
    const c = entry.toLowerCase();
    const d = lev(target, c);
    let score = 1 - d / Math.max(target.length, c.length, 1);
    if (c === target) score = 1;                                  // case-only difference
    else if (stripExt(c) === stripExt(target)) score = Math.max(score, 0.9); // wrong extension
    if (!best || score > best.score) best = { name: entry, score, distance: d };
  }
  return best;
}

// Minimum similarity before we claim to know what the user meant.
const MIN_PATH_SCORE = 0.7;

// Errors that mean "a path was wrong". Used to gate the path rules so they stop
// firing on tracebacks, type errors and failing test suites.
const PATH_ERROR_RE = /(No such file or directory|not found|cannot find|does not exist|doesn't exist|ENOENT|cannot open|can't open|unable to open|Not a directory|Is a directory)/i;

// Tokens that look like a path but aren't: test selectors, URLs, host:port,
// version specifiers, globs already expanded by the shell.
function isPathLike(token) {
  if (!token) return false;
  if (/^https?:\/\//i.test(token)) return false;
  if (/^-/.test(token)) return false;                   // flag
  if (/[=@]/.test(token)) return false;                 // KEY=val, pkg@1.2
  if (token.includes('/')) return true;
  // A colon outside a path means an image tag, host:port or test selector
  // (`tests/x.py::test_y`, `myimage:1.2`), not something to fuzzy-correct.
  if (token.includes(':')) return false;
  // Needs a real name before the extension, so a bare `--ext .ts` value or a
  // dotfile isn't mistaken for a mistyped path.
  return /^[^.].*\.[A-Za-z0-9]{1,6}$/.test(token);
}

// Walk up to the nearest existing ancestor, returning it plus the missing tail.
function nearestExisting(resolved) {
  let dir = path.dirname(resolved);
  let missing = path.basename(resolved);
  let depth = 0;
  while (!fs.existsSync(dir) && depth < 5) {
    missing = path.basename(dir) + '/' + missing;
    dir = path.dirname(dir);
    depth++;
  }
  return fs.existsSync(dir) ? { dir, missing } : null;
}

// Correct one bad path argument, returning the whole corrected command.
// Previously these rules returned only the corrected *path*, so Ctrl+X Tab
// replaced the prompt with a bare filename and history recorded it as a "fix".
function correctPathArg(command, arg, cwd, confidence) {
  const clean = arg.replace(/^["']|["']$/g, '');
  const resolved = path.resolve(cwd || '.', clean);
  try { fs.accessSync(resolved); return null; } catch { /* missing — try to correct */ }

  const near = nearestExisting(resolved);
  if (!near) return null;

  let entries;
  try { entries = fs.readdirSync(near.dir); } catch { return null; }

  const segments = near.missing.split('/');
  const best = bestCandidate(segments[0], entries);
  if (!best || best.score < MIN_PATH_SCORE) return null;
  if (best.name === segments[0]) return null;

  const tail = segments.slice(1).join('/');
  const correctedTarget = best.name + (tail ? '/' + tail : '');
  const abs = path.join(near.dir, correctedTarget);
  const suggestion = path.isAbsolute(clean)
    ? abs
    : (path.relative(cwd || '.', abs) || '.');

  const fixed = substituteArg(command, arg, suggestion);
  if (!fixed) return null;

  return {
    message: `\`${clean}\` doesn't exist. Did you mean \`${suggestion}\`?`,
    command: fixed,
    confidence: Math.round(confidence * best.score * 100) / 100,
  };
}

const COMMON_BINS = new Set([
  'git', 'python3', 'python', 'node', 'npm', 'npx', 'docker', 'curl', 'wget',
  'ls', 'cat', 'grep', 'find', 'make', 'gcc', 'ssh', 'vim', 'nano', 'tar',
  'chmod', 'chown', 'systemctl', 'apt', 'brew', 'kubectl', 'cargo', 'go', 'pip',
]);

module.exports = [
  // ── Missing binary: install hint, then typo correction ──
  {
    name: 'fuzzy-binary',
    match: ({ command, exitCode, context }) => {
      if (exitCode !== 127) return null;
      const bin = rawArgv0(command);
      if (!bin || bin.startsWith('/') || bin.startsWith('.') || bin.includes('/')) return null;
      if (binExists(bin)) return null;

      // An exact match against a known package name means the tool simply
      // isn't installed — that's a stronger signal than any typo guess.
      if (BINARY_PACKAGES[bin]) {
        const install = installCommandFor(bin, context && context.platform);
        if (install) {
          return {
            message: `\`${bin}\` isn't installed.`,
            command: install,
            confidence: 0.92,
          };
        }
      }

      const names = [...allBins().keys()];
      const threshold = bin.length <= 4 ? 2 : 3;
      const first = bin[0].toLowerCase();
      const sorted = [...bin].sort().join('');
      const matches = [];

      for (const candidate of names) {
        if (Math.abs(candidate.length - bin.length) > 2) continue;
        const cl = candidate.toLowerCase();
        // Same initial, or the first two characters transposed (gti -> git).
        if (cl[0] !== first && !(cl[0] === (bin[1] || '').toLowerCase() && cl[1] === first)) continue;
        const d = lev(bin, candidate);
        if (d === 0 || d > threshold) continue;
        const base = candidate.replace(/\d+$/, '').replace(/-\d+.*$/, '');
        const anagram = sorted === [...candidate].sort().join('') || sorted === [...base].sort().join('');
        matches.push({ name: candidate, distance: d, anagram, common: COMMON_BINS.has(candidate) });
      }
      if (!matches.length) return null;

      // A transposition is the most likely typo; then prefer a command the user
      // plausibly meant over an obscure neighbour at the same distance.
      matches.sort((a, b) =>
        (b.anagram - a.anagram) ||
        (a.distance - b.distance) ||
        (b.common - a.common) ||
        (a.name.length - b.name.length) ||
        a.name.localeCompare(b.name));

      const best = matches.find(m => m.anagram && m.name.length === bin.length) || matches[0];
      // Confidence follows the candidate we actually return. The old code read
      // matches[0].distance while returning a different name.
      const confidence = best.anagram ? 0.95 : Math.round((0.95 - best.distance * 0.12) * 100) / 100;

      // Swap the token in place so a wrapper prefix survives:
      // `sudo gti status` must become `sudo git status`, not `git status`.
      const fixed = substituteArg(command, bin, best.name)
        || `${best.name}${command.slice(command.indexOf(bin) + bin.length)}`;
      return {
        message: `\`${bin}\` not found. Did you mean \`${best.name}\`?`,
        command: fixed,
        confidence,
      };
    },
  },

  // ── A path argument that doesn't exist (fires even with no stderr) ──
  {
    name: 'path-argument-checker',
    match: ({ command, exitCode, output, context }) => {
      if (exitCode === 0) return null;
      if (!context || !context.cwd) return null;
      // Only when the failure plausibly concerns a path.
      if (output && output.trim() && !PATH_ERROR_RE.test(output)) return null;

      const tokens = command.trim().split(/\s+/).slice(1);
      const pathArgs = tokens.filter(isPathLike).slice(0, 5);
      for (const arg of pathArgs) {
        const fix = correctPathArg(command, arg, context.cwd, 0.9);
        if (fix) return fix;
      }
      return null;
    },
  },

  // ── "No such file or directory" naming a specific target ──
  {
    name: 'no-such-file-or-directory',
    match: ({ command, output, context }) => {
      const m = output.match(/['"]?([^'"\s]+)['"]?: No such file or directory/i);
      if (!m) return null;
      const target = m[1];
      if (!isPathLike(target)) return null;
      // The error already told the user it's missing; only speak up if we can
      // offer the corrected command.
      return correctPathArg(command, target, (context && context.cwd) || '.', 0.95);
    },
  },

  // ── Permission denied ──
  {
    name: 'permission-denied-file',
    match: ({ command, output }) => {
      // Requires the actual error. Previously fired on any exit 1 whose command
      // merely mentioned /etc or /var, and suggested sudo blindly.
      if (!/Permission denied/i.test(output)) return null;
      if (/No such file or directory/i.test(output)) return null;
      if (/\(publickey/i.test(output)) return null;              // ssh-publickey owns this
      if (/^sudo\s|\ssudo\s/.test(command.trim())) return null;  // already elevated
      if (/^(git|ssh|scp|rsync)\b/.test(command.trim())) return null;
      return {
        message: 'Permission denied. You may need elevated access.',
        command: `sudo ${command.trim()}`,
        confidence: 0.85,
      };
    },
  },

  // ── Git push rejected (non-fast-forward) ──
  {
    name: 'git-push-rejected',
    match: ({ command, output }) => {
      if (!command.includes('git push')) return null;
      if (!/rejected|non-fast-forward/i.test(output)) return null;
      return {
        message: `Remote has commits you don't have. Pull with rebase first.`,
        command: 'git pull --rebase && git push',
        confidence: 0.95,
      };
    },
  },

  // ── Git: not a repository ──
  {
    name: 'git-not-a-repo',
    match: ({ command, output }) => {
      if (!command.startsWith('git ')) return null;
      if (!/not a git repository/i.test(output)) return null;
      return {
        message: `You're outside a git repo. Navigate to your project directory or run \`git init\`.`,
        confidence: 0.9,
      };
    },
  },

  // ── Port already in use ──
  {
    name: 'port-in-use',
    match: ({ output }) => {
      const m = output.match(/EADDRINUSE.*?:(\d{2,5})/)
        || output.match(/(?:address already in use).*?(\d{2,5})/i)
        || output.match(/port\s+(\d{2,5}).*already/i);
      if (!m) return null;
      const port = m[1];
      // Show the owner rather than SIGKILLing whatever holds the port — it may
      // well be a database, or another user's process.
      return {
        message: `Port ${port} is in use. Check what's holding it before killing it.`,
        command: `lsof -i :${port}`,
        confidence: 0.9,
      };
    },
  },

  // ── Node: module not found ──
  {
    name: 'node-module-not-found',
    match: ({ output, context }) => {
      const m = output.match(/Cannot find module ['"](.+?)['"]/);
      if (!m) return null;
      const mod = m[1];
      if (mod.startsWith('.') || mod.startsWith('/')) return null;
      const pm = (context && context.packageManager) || 'npm';
      const installCmd = pm === 'yarn' ? `yarn add ${mod}`
        : pm === 'pnpm' ? `pnpm add ${mod}`
          : `npm install ${mod}`;
      return { message: `Missing dependency: \`${mod}\`.`, command: installCmd, confidence: 0.92 };
    },
  },

  // ── npm: package doesn't exist ──
  {
    name: 'npm-typo-package',
    match: ({ command, output }) => {
      if (!command.includes('npm install') && !command.includes('npm i ')) return null;
      const m = output.match(/404 Not Found.*?['"]([^'"]+)['"]/);
      if (!m) return null;
      return {
        message: `\`${m[1]}\` doesn't exist on npm. Check the spelling.`,
        command: `npm search ${m[1]}`,
        confidence: 0.8,
      };
    },
  },

  // ── Disk full ──
  {
    name: 'disk-full',
    match: ({ output }) => {
      if (!/No space left on device|ENOSPC/i.test(output)) return null;
      // Report usage; don't walk the entire filesystem unprompted.
      return { message: 'Disk is full.', command: 'df -h', confidence: 0.98 };
    },
  },

  // ── DNS resolution failed ──
  {
    name: 'dns-failure',
    match: ({ output }) => {
      if (!/(Temporary failure in name resolution|Name or service not known|getaddrinfo ENOTFOUND|NXDOMAIN|Could not resolve host)/i.test(output)) return null;
      return {
        message: 'DNS resolution failed. Check your network or DNS config.',
        command: 'ping -c 1 8.8.8.8',
        confidence: 0.85,
      };
    },
  },

  // ── SSL/TLS certificate problem ──
  {
    name: 'ssl-cert-expired',
    match: ({ output }) => {
      if (!/(certificate.*(expired|expire)|CERT_HAS_EXPIRED|SSL certificate problem)/i.test(output)) return null;
      // A skewed system clock is the most common cause and the easiest to check.
      return {
        message: 'Certificate rejected. A wrong system clock is the usual cause — check the date.',
        command: 'date',
        confidence: 0.75,
      };
    },
  },

  // ── Missing environment variable ──
  {
    name: 'missing-env-var',
    match: ({ output }) => {
      const patterns = [
        /(?:environment variable|env var)\s+["']?([A-Z_][A-Z0-9_]+)["']?\s+(?:is|required|must be|not set|undefined)/i,
        /process\.env\.([A-Z_][A-Z0-9_]+)\s+is\s+undefined/,
      ];
      for (const p of patterns) {
        const m = output.match(p);
        if (m) {
          return {
            message: `Missing environment variable: \`${m[1]}\`.`,
            command: `export ${m[1]}=`,
            confidence: 0.88,
          };
        }
      }
      return null;
    },
  },

  // ── Unknown flag ──
  {
    name: 'typo-flag',
    match: ({ command, output }) => {
      const m = output.match(/unknown (?:option|flag|switch|argument)[: ]+(\S+)/i)
        || output.match(/unrecognized option ['"]?(\S+?)['"]?$/im);
      if (!m) return null;
      const bin = rawArgv0(command);
      if (!bin) return null;
      const flag = m[1].replace(/["']/g, '');
      return {
        message: `\`${flag}\` isn't a valid option for \`${bin}\`.`,
        command: `${bin} --help`,
        confidence: 0.75,
      };
    },
  },

  // ── Docker daemon not running ──
  {
    name: 'docker-daemon',
    match: ({ output, context }) => {
      if (!/(Cannot connect to the Docker daemon|Is the docker daemon running)/i.test(output)) return null;
      const darwin = (context && context.platform === 'darwin') || process.platform === 'darwin';
      return {
        message: `Docker isn't running.`,
        command: darwin ? 'open -a Docker' : 'sudo systemctl start docker',
        confidence: 0.95,
      };
    },
  },

  // ── Python: missing module ──
  {
    name: 'python-no-module',
    match: ({ output }) => {
      const m = output.match(/No module named ['"]?([\w.]+)['"]?/);
      if (!m) return null;
      const imported = m[1];
      // `No module named 'foo.bar'` needs the distribution for `foo`, and the
      // import name often isn't the package name (cv2 -> opencv-python).
      const pkg = pythonPackageFor(imported);
      const runner = binExists('python3') ? 'python3 -m pip' : 'pip';
      const note = pkg !== imported.split('.')[0] ? ` (\`${imported.split('.')[0]}\` ships as \`${pkg}\`)` : '';
      return {
        message: `Python can't find \`${imported}\`${note}.`,
        command: `${runner} install ${pkg}`,
        confidence: 0.9,
      };
    },
  },

  // ── Cargo: warnings denied ──
  {
    name: 'cargo-deny-warnings',
    match: ({ command, output }) => {
      if (!command.includes('cargo build') && !command.includes('cargo check')) return null;
      if (!output.includes('deny(warnings)') && !output.includes('-D warnings')) return null;
      return {
        message: 'Build fails because warnings are denied. Fix them or drop `#![deny(warnings)]`.',
        confidence: 0.8,
      };
    },
  },

  // ── Git: nothing to commit ──
  {
    name: 'git-nothing-to-commit',
    match: ({ command, output }) => {
      if (!command.includes('git commit')) return null;
      if (!/nothing to commit/i.test(output)) return null;
      return {
        message: 'Nothing staged. Use `git add` first, or check `git status`.',
        command: 'git status',
        confidence: 0.95,
      };
    },
  },

  // ── Git: no upstream branch ──
  {
    name: 'git-no-upstream',
    match: ({ command, output, context }) => {
      if (!command.includes('git push')) return null;
      if (!/no upstream branch|set-upstream/i.test(output)) return null;
      const branchM = output.match(/branch ['"]?(\S+?)['"]?\s/);
      const branch = (context && context.gitBranch) || (branchM && branchM[1]) || '<branch>';
      return {
        message: 'New branch needs an upstream set.',
        command: `git push --set-upstream origin ${branch}`,
        confidence: 0.97,
      };
    },
  },

  // ── Git: branch diverged from remote ──
  {
    name: 'git-diverged',
    match: ({ command, output, context }) => {
      if (!command.startsWith('git ')) return null;
      if (!context || !context.isGitRepo) return null;
      // Requires the error to actually implicate the remote. It used to fire on
      // any failing git command whenever the branch happened to be behind.
      if (!/rejected|non-fast-forward|behind|diverged|fetch first|need to pull/i.test(output)) return null;
      if (!/\[(?:ahead \d+, )?behind \d+\]/.test((context && context.gitStatus) || '')) return null;
      return { message: 'Branch has diverged from its remote.', command: 'git pull --rebase', confidence: 0.85 };
    },
  },

  // ── SSH: host key verification failed ──
  {
    name: 'ssh-host-key',
    match: ({ command, output }) => {
      if (!/HOST KEY VERIFICATION FAILED/i.test(output)) return null;
      const hostM = output.match(/Offending .*? for ([^\s]+)/i)
        || output.match(/host key for ([^\s]+) has changed/i)
        || command.match(/\b(?:ssh|scp)\s+(?:\S+@)?([\w.-]+)/);
      const host = hostM && hostM[1];
      const fix = {
        message: `SSH host key changed. Confirm the new key is expected before trusting it.`,
        confidence: 0.75,
      };
      if (host) fix.command = `ssh-keygen -R ${host}`;
      return fix;
    },
  },

  // ── SSH: public key rejected ──
  {
    name: 'ssh-publickey',
    match: ({ command, output }) => {
      if (!/\b(ssh|scp|rsync)\b/.test(command)) return null;
      if (!/Permission denied \(publickey/.test(output)) return null;
      return {
        message: 'SSH key rejected. Add your key to the agent, or pass an identity file.',
        command: 'ssh-add ~/.ssh/id_ed25519',
        confidence: 0.8,
      };
    },
  },

  // ── Node: ESM package not found ──
  {
    name: 'node-esm-not-found',
    match: ({ output }) => {
      if (!output.includes('ERR_MODULE_NOT_FOUND')) return null;
      const m = output.match(/Cannot find package '(\S+?)'/);
      if (!m) return null;
      return { message: `Missing ESM package: \`${m[1]}\`.`, command: `npm install ${m[1]}`, confidence: 0.9 };
    },
  },

  // ── apt: package not found ──
  {
    name: 'apt-package-typo',
    match: ({ output }) => {
      const m = output.match(/Unable to locate package (\S+)/);
      if (!m) return null;
      return {
        message: `Package \`${m[1]}\` not found. Refresh the index first.`,
        command: 'sudo apt update',
        confidence: 0.85,
      };
    },
  },

  // ── brew: formula not found ──
  {
    name: 'brew-formula-not-found',
    match: ({ output }) => {
      const m = output.match(/No available formula.*?for (\S+)/) || output.match(/Formula not found: (\S+)/);
      if (!m) return null;
      return {
        message: `\`${m[1]}\` isn't in Homebrew core — it may need a tap.`,
        command: `brew search ${m[1]}`,
        confidence: 0.8,
      };
    },
  },

  // ── Killed (usually OOM) ──
  {
    name: 'oom-killed',
    match: ({ exitCode, output, context }) => {
      if (exitCode !== 137) return null;
      const darwin = (context && context.platform === 'darwin') || process.platform === 'darwin';
      // Exit 137 is SIGKILL; with the kernel's "Killed" notice it's near-certain OOM.
      const confident = /killed/i.test(output);
      return {
        message: confident
          ? 'Process was killed — almost certainly out of memory.'
          : 'Process was killed (exit 137). Out of memory is the usual cause.',
        command: darwin ? 'vm_stat' : 'free -h',
        confidence: confident ? 0.9 : 0.8,
      };
    },
  },
];
