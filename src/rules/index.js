'use strict';

// Each rule: { name, match({command, exitCode, output, context}) => fix | [fixes] | null }
// Fix: { message, command?, confidence: 0-1 }

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({length: m+1}, (_,i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1]===b[j-1]?0:1));
  return d[m][n];
}

module.exports = [
  // ── Fuzzy binary suggestion (gti → git) ──
  {
    name: 'fuzzy-binary',
    match: ({ command, exitCode, context }) => {
      if (exitCode !== 127) return null;
      const bin = command.split(/\s+/)[0];
      if (!bin || bin.startsWith('/') || bin.startsWith('.')) return null;

      // Get actual executables from PATH (not shell builtins/functions)
      const fs = require('fs');
      const path = require('path');
      const allBins = new Set();
      for (const dir of (process.env.PATH || '').split(':')) {
        try {
          for (const f of fs.readdirSync(dir)) {
            try { fs.accessSync(path.join(dir, f), fs.constants.X_OK); allBins.add(f); } catch {}
          }
        } catch {}
      }

      // Find closest matches
      const threshold = bin.length <= 4 ? 2 : 3;
      const matches = [];
      for (const candidate of allBins) {
        if (Math.abs(candidate.length - bin.length) > 2) continue;
        const d = lev(bin, candidate);
        if (d <= threshold && d > 0) {
          // Bonus score for transpositions (same letters rearranged, e.g. gti→git)
          const isAnagram = [...bin].sort().join('') === [...candidate].sort().join('');
          matches.push({ name: candidate, distance: d, anagram: isAnagram });
        }
      }
      // Anagrams first (likely transposition typo), then by distance
      matches.sort((a, b) => (b.anagram - a.anagram) || (a.distance - b.distance) || a.name.localeCompare(b.name));

      if (matches.length > 0) {
        const rest = command.slice(bin.length).trim();
        const best = matches[0].name;
        return {
          message: `\`${bin}\` not found. Did you mean \`${best}\`?`,
          command: `${best}${rest ? ' ' + rest : ''}`,
          confidence: 0.95 - matches[0].distance * 0.1
        };
      }
      return null;
    }
  },

  // ── Command not found ──
  {
    name: 'command-not-found',
    match: ({ output }) => {
      const m = output.match(/(?:command not found|not recognized|No such file or directory)/);
      if (!m) return null;
      return { message: `Check spelling — is the command installed? Try \`which <name>\` or install it.`, confidence: 0.5 };
    }
  },

  // ── Path argument checker (works even without stderr output) ──
  {
    name: 'path-argument-checker',
    match: ({ command, exitCode, context }) => {
      if (exitCode === 0) return null;
      if (!context?.cwd) return null;

      const fs = require('fs');
      const path = require('path');

      // Extract path-like arguments from the command (skip flags and the binary itself)
      const tokens = command.trim().split(/\s+/).slice(1).filter(t => !t.startsWith('-'));
      const pathArgs = tokens.filter(t =>
        t.includes('/') || (t.includes('.') && /\.[\w\/]/.test(t))
      ).slice(0, 5);

      for (const arg of pathArgs) {
        // Skip things that aren't paths (URLs, quoted strings with spaces, etc.)
        if (/^https?:\/\//.test(arg)) continue;
        if (/^['"].*['"]$/.test(arg) && arg.includes(' ')) continue;

        const resolved = path.resolve(context.cwd, arg.replace(/^["']|["']$/g, ''));

        // If it exists, skip
        try { fs.accessSync(resolved); continue; } catch { /* doesn't exist — check for fuzzy match */ }

        // Walk up to find existing ancestor + fuzzy match missing segment
        let existingDir = path.dirname(resolved);
        let missingSegment = path.basename(resolved);
        let depth = 0;
        while (!fs.existsSync(existingDir) && depth < 5) {
          missingSegment = path.basename(existingDir) + '/' + missingSegment;
          existingDir = path.dirname(existingDir);
          depth++;
        }

        if (fs.existsSync(existingDir)) {
          try {
            const entries = fs.readdirSync(existingDir);
            const targetName = missingSegment.split('/')[0].toLowerCase();
            const matches = entries.filter(f => {
              const fl = f.toLowerCase();
              return fl.includes(targetName.slice(0, Math.max(3, Math.floor(targetName.length / 2)))) || lev(targetName, fl) <= 2;
            });
            if (matches.length > 0) {
              const corrected = matches[0];
              let relExisting = path.relative(context.cwd, existingDir);
              if (relExisting === '') relExisting = '.';
              const parts = [];
              if (relExisting !== '.') parts.push(relExisting);
              parts.push(corrected);
              const rest = missingSegment.split('/').slice(1).join('/');
              if (rest) parts.push(rest);
              const suggestion = path.isAbsolute(arg)
                ? path.join(existingDir, corrected + (rest ? '/' + rest : ''))
                : path.join(...parts);
              return {
                message: `\`${arg}\` doesn't exist, but did you mean \`${suggestion}\`?`,
                command: suggestion,
                confidence: 0.85
              };
            }
          } catch { /* unreadable */ }
        }
      }
      return null;
    }
  },

  // ── Permission denied on file ──
  {
    name: 'permission-denied-file',
    match: ({ command, output, exitCode }) => {
      if (/No such file or directory/i.test(output)) return null;
      // Don't suggest sudo if they're already using sudo — likely a different error
      if (command.trim().startsWith('sudo ') || command.includes(' sudo ')) return null;
      const hasOutput = /Permission denied/i.test(output);
      const hasSysFile = /(^|\s)(\/etc\/|\/var\/|\/root\/|\/proc\/|\/sys\/)/.test(command);
      // Only trigger with no output if NOT using sudo AND targeting system path
      if (!hasOutput) {
        // Without output: only fire on exit 126 (true permission error)
        // Exit code 1 with a system path could be "file not found" — let path checker handle it
        if (!hasSysFile || exitCode !== 126) return null;
      }
      if (/git|ssh/.test(command)) return null;
      const fileMatch = command.match(/(\S+)\s*$/);
      return {
        message: `Permission denied. You may need elevated access.`,
        command: command.startsWith('sudo ') ? undefined : `sudo ${command}`,
        confidence: 0.85
      };
    }
  },

  // ── Git push rejected (non-fast-forward) ──
  {
    name: 'git-push-rejected',
    match: ({ command, output }) => {
      if (!command.includes('git push')) return null;
      if (!/rejected|non-fast-forward/i.test(output)) return null;
      return {
        message: `Remote has commits you don't have. Pull with rebase first.`,
        command: `git pull --rebase && git push`,
        confidence: 0.95
      };
    }
  },

  // ── Git not a repo ──
  {
    name: 'git-not-a-repo',
    match: ({ command, output }) => {
      if (!command.startsWith('git ')) return null;
      if (!/not a git repository/i.test(output)) return null;
      return { message: `You're outside a git repo. Navigate to your project directory or run \`git init\`.`, confidence: 0.9 };
    }
  },

  // ── Port already in use ──
  {
    name: 'port-in-use',
    match: ({ output }) => {
      const m = output.match(/EADDRINUSE.*?:(\d{2,5})/) || output.match(/(?:address already in use).*?(\d{2,5})/i) || output.match(/port\s+(\d{2,5}).*already/i);
      if (!m) return null;
      const port = m[1];
      return {
        message: `Port ${port} is occupied.`,
        command: `lsof -ti :${port} | xargs kill -9`,
        confidence: 0.9
      };
    }
  },

  // ── Module not found (Node) ──
  {
    name: 'node-module-not-found',
    match: ({ command, output, context }) => {
      const m = output.match(/Cannot find module ['"](.+)['"]/);
      if (!m) return null;
      const mod = m[1];
      if (mod.startsWith('.') || mod.startsWith('/')) return null;
      const pm = context?.packageManager || 'npm';
      const installCmd = pm === 'yarn' ? `yarn add ${mod}` : pm === 'pnpm' ? `pnpm add ${mod}` : `npm install ${mod}`;
      return {
        message: `Missing dependency: \`${mod}\`.`,
        command: installCmd,
        confidence: 0.92
      };
    }
  },

  // ── npm module not found / typo package name ──
  {
    name: 'npm-typo-package',
    match: ({ command, output }) => {
      if (!command.includes('npm install') && !command.includes('npm i ')) return null;
      const m = output.match(/404 Not Found.*?['"]([^'"]+)['"]/);
      if (!m) return null;
      return { message: `\`${m[1]}\` doesn't exist on npm. Check spelling.`, confidence: 0.8 };
    }
  },

  // ── Disk full ──
  {
    name: 'disk-full',
    match: ({ output }) => {
      if (!/No space left on device|ENOSPC/i.test(output)) return null;
      return {
        message: `Disk is full.`,
        command: `df -h && du -sh /* 2>/dev/null | sort -rh | head -10`,
        confidence: 0.98
      };
    }
  },

  // ── DNS resolution failed ──
  {
    name: 'dns-failure',
    match: ({ output }) => {
      if (!/(Temporary failure in name resolution|Name or service not known|getaddrinfo ENOTFOUND|NXDOMAIN|Could not resolve host)/i.test(output)) return null;
      return {
        message: `DNS resolution failed. Check network connection or DNS config.`,
        command: `ping -c 1 8.8.8.8`,
        confidence: 0.85
      };
    }
  },

  // ── Connection refused ──
  {
    name: 'connection-refused',
    match: ({ output }) => {
      if (!/(Connection refused|ECONNREFUSED)/i.test(output)) return null;
      const hostM = output.match(/connect(?:ion)? to (\S+)/i);
      const host = hostM ? hostM[1] : '';
      return { message: `Connection refused${host ? ` (${host})` : ''}. Is the service running?`, confidence: 0.7 };
    }
  },

  // ── SSL cert expired ──
  {
    name: 'ssl-cert-expired',
    match: ({ output }) => {
      if (!/(certificate.*(expired|expire)|CERT_HAS_EXPIRED|SSL certificate problem)/i.test(output)) return null;
      return { message: `SSL/TLS certificate issue. Check system clock and certificate validity.`, confidence: 0.75 };
    }
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
        if (m) return { message: `Missing environment variable: \`${m[1]}\`.`, command: `export ${m[1]}=`, confidence: 0.88 };
      }
      return null;
    }
  },

  // ── Typo'd flag (Levenshtein) ──
  {
    name: 'typo-flag',
    match: ({ command, output }) => {
      const m = output.match(/unknown (?:option|flag|switch|argument)[: ]+(\S+)/i) || output.match(/unrecognized option ['"](\S+)['"]/i);
      if (!m) return null;
      const badFlag = m[1].replace(/^--?/, '');
      // Extract known flags from help text in output if available, else from same binary
      return { message: `\`--${badFlag}\` isn't valid. Run \`<cmd> --help\` to see available flags.`, confidence: 0.7 };
    }
  },

  // ── Docker daemon not running ──
  {
    name: 'docker-daemon',
    match: ({ output }) => {
      if (!/(Cannot connect to the Docker daemon|Is the docker daemon running)/i.test(output)) return null;
      return {
        message: `Docker isn't running.`,
        command: process.platform === 'darwin' ? `open -a Docker` : `sudo systemctl start docker`,
        confidence: 0.95
      };
    }
  },

  // ── Python: no module named ──
  {
    name: 'python-no-module',
    match: ({ output }) => {
      const m = output.match(/No module named ['"]?([\w.]+)['"]?/);
      if (!m) return null;
      return {
        message: `Python can't find \`${m[1]}\`. Install it with pip.`,
        command: `pip install ${m[1]}`,
        confidence: 0.9
      };
    }
  },

  // ── Python: syntax error line hint ──
  {
    name: 'python-syntax',
    match: ({ output }) => {
      const m = output.match(/File "([^"]+)", line (\d+)\\n\\n?(.*)/s);
      if (!m || !output.includes('SyntaxError')) return null;
      return { message: `Syntax error at ${m[1]}:${m[2]} — ${m[3]?.trim() || 'check that line'}`, confidence: 0.6 };
    }
  },

  // ── Cargo: unused import warning treated as error ──
  {
    name: 'cargo-deny-warnings',
    match: ({ command, output }) => {
      if (!command.includes('cargo build') && !command.includes('cargo check')) return null;
      if (!output.includes('deny(warnings)') && !output.includes('-D warnings')) return null;
      return { message: `Build fails because warnings are denied. Fix warnings or remove \`#![deny(warnings)]\`.`, confidence: 0.8 };
    }
  },

  // ── Git: nothing to commit ──
  {
    name: 'git-nothing-to-commit',
    match: ({ command, output }) => {
      if (!command.includes('git commit')) return null;
      if (!/nothing to commit/i.test(output)) return null;
      return { message: `Nothing staged. Use \`git add\` first, or check \`git status\`.`, command: `git status`, confidence: 0.95 };
    }
  },

  // ── Git: no upstream branch ──
  {
    name: 'git-no-upstream',
    match: ({ command, output, context }) => {
      if (!command.includes('git push')) return null;
      if (!/no upstream branch|set-upstream/i.test(output)) return null;
      const branchM = output.match(/branch ['"]?(\S+)['"]?/);
      const branch = context?.gitBranch || branchM?.[1] || '<branch>';
      return { message: `New branch needs upstream set.`, command: `git push --set-upstream origin ${branch}`, confidence: 0.97 };
    }
  },

  // ── Git: diverged branches ──
  {
    name: 'git-diverged',
    match: ({ command, output, context }) => {
      if (!command.startsWith('git ')) return null;
      const m = context?.gitStatus?.match(/^## (\S+)\.\.\.(\S+) \[(?:ahead (\d+), )?behind (\d+)\]/);
      if (!m || !context?.isGitRepo) return null;
      return { message: `Branch has diverged from remote.`, command: `git pull --rebase`, confidence: 0.85 };
    }
  },

  // ── SSH: host key verification ──
  {
    name: 'ssh-host-key',
    match: ({ output }) => {
      if (!/(HOST KEY VERIFICATION FAILED|host key verification failed)/i.test(output)) return null;
      return { message: `SSH host key changed or wasn't accepted. Verify it's expected before proceeding.`, command: `ssh-keygen -R <hostname>`, confidence: 0.75 };
    }
  },

  // ── SSH: permission denied (publickey) ──
  {
    name: 'ssh-publickey',
    match: ({ command, output }) => {
      if (!command.includes('ssh ') && !command.includes('scp ') && !command.includes('rsync ')) return null;
      if (!/Permission denied \(publickey\)/.test(output)) return null;
      return { message: `SSH key rejected. Try specifying the identity file or add your key to ssh-agent.`, command: `ssh-add ~/.ssh/id_rsa`, confidence: 0.8 };
    }
  },

  // ── Node: ERR_MODULE_NOT_FOUND (ESM) ──
  {
    name: 'node-esm-not-found',
    match: ({ output }) => {
      if (!output.includes('ERR_MODULE_NOT_FOUND')) return null;
      const m = output.match(/Cannot find package '(\S+)'/);
      if (!m) return null;
      return { message: `Missing ESM package: \`${m[1]}\`.`, command: `npm install ${m[1]}`, confidence: 0.9 };
    }
  },

  // ── apt: unable to locate package ──
  {
    name: 'apt-package-typo',
    match: ({ output }) => {
      const m = output.match(/Unable to locate package (\S+)/);
      if (!m) return null;
      return {
        message: `Package \`${m[1]}\` not found. Try updating the index first.`,
        command: `apt update && apt search ${m[1]}`,
        confidence: 0.85
      };
    }
  },

  // ── brew: formula not found ──
  {
    name: 'brew-formula-not-found',
    match: ({ output }) => {
      const m = output.match(/No available formula.*?for (\S+)/) || output.match(/Formula not found: (\S+)/);
      if (!m) return null;
      return { message: `\`${m[1]}\` isn't in Homebrew core. Try \`brew search ${m[1]}\` or check tap.`, confidence: 0.8 };
    }
  },

  // ── Segfault ──
  {
    name: 'segfault',
    match: ({ output }) => {
      if (!/Segmentation fault/i.test(output)) return null;
      return { message: `Segfault — likely memory bug. Consider running under valgrind or gdb.`, command: `gdb --args ${''}`, confidence: 0.4 };
    }
  },

  // ── Process killed (OOM) ──
  {
    name: 'oom-killed',
    match: ({ output, exitCode }) => {
      if (exitCode !== 137) return null;
      if (!/killed|Killed/i.test(output)) return null;
      return { message: `Process was likely OOM-killed (exit ${exitCode}). Check available memory.`, command: `free -h`, confidence: 0.85 };
    }
  },

  // ── No such file or directory (universal path matcher) ──
  {
    name: 'no-such-file-or-directory',
    match: ({ output, context }) => {
      const m = output.match(/['"]?(\S+)['"]?: No such file or directory/i);
      if (!m) return null;
      const rawTarget = m[1];
      const fs = require('fs');
      const path = require('path');
      const parent = path.dirname(resolved);
      const basename = path.basename(resolved);

      // Walk up until we find an existing ancestor
      let existingDir = parent;
      let missingSegment = basename;
      let depth = 0;
      while (!fs.existsSync(existingDir) && depth < 5) {
        missingSegment = path.basename(existingDir) + '/' + missingSegment;
        existingDir = path.dirname(existingDir);
        depth++;
      }

      if (fs.existsSync(existingDir)) {
        try {
          const entries = fs.readdirSync(existingDir);
          // Fuzzy: substring or Levenshtein <= 3 on the first missing segment
          const targetName = missingSegment.split('/')[0];
          const matches = entries.filter(f => {
            const fl = f.toLowerCase();
            const tl = targetName.toLowerCase();
            return fl.includes(tl.slice(0, Math.max(3, Math.floor(tl.length / 2)))) || lev(tl, fl) <= 3;
          });
          if (matches.length > 0) {
            const corrected = matches[0];
            const rest = missingSegment.split('/').slice(1).join('/');
            // Build the corrected path relative to cwd
            const relExisting = path.relative(context?.cwd || '.', existingDir);
            const parts = [];
            if (relExisting !== '.') parts.push(relExisting);
            parts.push(corrected);
            if (rest) parts.push(rest);
            const suggestion = path.isAbsolute(rawTarget)
              ? path.join(existingDir, corrected + (rest ? '/' + rest : ''))
              : path.join(...parts);
            return {
              message: `\`${rawTarget}\` doesn't exist, but did you mean \`${corrected}\`?`,
              command: suggestion,
              confidence: 0.88
            };
          }
        } catch { /* unreadable */ }
      }

      try {
        const siblings = fs.readdirSync(parent).filter(f =>
          f.toLowerCase().includes(basename.toLowerCase().slice(0, Math.max(3, Math.floor(basename.length / 2))))
        );
        if (siblings.length > 0) {
          return {
            message: `\`${rawTarget}\` doesn't exist here, but did you mean:`,
            command: siblings.slice(0, 3).map(s => path.join(path.dirname(rawTarget), s)).join('  '),
            confidence: 0.9
          };
        }
      } catch { /* parent doesn't exist */ }
      return { message: `\`${rawTarget}\` doesn't exist.`, confidence: 0.6 };
    }
  },
];
