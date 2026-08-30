'use strict';
// Precision regression suite.
//
// fixit's failure mode is not missing a fix — it's confidently printing a wrong
// one. Every case below is labelled with what should happen, so noise is
// measured rather than guessed at. Each entry marked (RC-n) pins a specific
// regression; see the root causes in the accompanying plan.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fixit-noise-'));
process.env.FIXIT_LEARN_DIR = path.join(TMP, 'learn');
process.env.FIXIT_CONFIG = path.join(TMP, 'config.json');

const { findFixes } = require('../src/engine');

// Fixture the path rules can actually resolve against.
const WORK = path.join(TMP, 'work');
fs.mkdirSync(path.join(WORK, 'src'), { recursive: true });
fs.mkdirSync(path.join(WORK, 'bot'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'notes.txt'), 'x');
fs.writeFileSync(path.join(WORK, 'README.md'), 'x');
fs.writeFileSync(path.join(WORK, 'src', 'main.py'), 'x');
fs.writeFileSync(path.join(WORK, 'bot', 'main.py'), 'x');

const ctx = {
  cwd: WORK, platform: 'linux', isGitRepo: true, gitBranch: 'main',
  gitStatus: '## main...origin/main [behind 2]', packageManager: 'npm',
  hasNodeModules: false, hasDockerfile: false,
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ── The corpus ───────────────────────────────────────────────────────────────
// [label, command, exitCode, stderr, 'silent' | 'suggest']
const CORPUS = [
  // Not errors at all.
  ['ctrl-C',                  'sleep 100',                          130, '', 'silent'],
  ['SIGTERM',                 'node server.js',                     143, '', 'silent'],
  ['grep finds nothing',      'grep needle README.md',                1, '', 'silent'],
  ['diff reports difference', 'diff notes.txt README.md',             1, '', 'silent'],
  ['test predicate false',    'test -f /nope',                        1, '', 'silent'],
  ['which misses',            'which nonesuch',                       1, '', 'silent'],

  // Failures fixit has nothing useful to add to.
  ['pytest failure',          'pytest tests/test_api.py::test_login', 1, '1 failed, 3 passed', 'silent'],
  ['jest snapshot',           'jest src/Button.test.tsx',             1, '1 snapshot failed.', 'silent'],
  ['npm test failure',        'npm test',                             1, '2 tests failed\n  at test/x.js:42', 'silent'],
  ['python ValueError',       'python3 src/main.py',                  1, 'Traceback (most recent call last):\n  File "src/main.py", line 3\nValueError: bad input', 'silent'],
  ['tsc type error',          'npx tsc --noEmit',                     2, "src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.", 'silent'],
  ['eslint findings',         'eslint . --ext .ts',                    1, '3 problems (3 errors, 0 warnings)', 'silent'],
  ['make recipe failed',      'make build',                           2, 'make: *** [Makefile:12: build] Error 1', 'silent'],
  ['kubectl no context',      'kubectl get pods',                     1, 'error: no configuration has been provided', 'silent'],
  ['curl 404',                'curl -sf https://example.com/x.json', 22, 'curl: (22) The requested URL returned error: 404 Not Found', 'silent'],
  ['git pre-commit hook',     'git commit -m "wip 1.0"',              1, 'pre-commit hook failed', 'silent'],
  ['docker pull denied',      'docker run myimage:1.2 sh',          125, 'docker: Error response from daemon: pull access denied', 'silent'],
  ['go build error',          'go build ./...',                       2, 'src/x.go:9:2: undefined: Foo', 'silent'],
  ['unknown binary, no near', 'gitstatus',                          127, 'gitstatus: command not found', 'silent'],

  // Real, actionable failures.
  ['mistyped filename',       'cat notes.md',                         1, 'cat: notes.md: No such file or directory', 'suggest'],
  ['transposed binary',       'gti status',                         127, 'gti: command not found', 'suggest'],
  ['git push rejected',       'git push',                             1, '! [rejected] main -> main (non-fast-forward)', 'suggest'],
  ['nothing staged',          'git commit -m x',                      1, 'nothing to commit, working tree clean', 'suggest'],
  ['port taken',              'npm start',                            1, 'Error: listen EADDRINUSE: address already in use :::3000', 'suggest'],
  ['node module missing',     'node server.js',                       1, "Error: Cannot find module 'express'", 'suggest'],
  ['python module missing',   'python3 src/main.py',                  1, "ModuleNotFoundError: No module named 'flask'", 'suggest'],
  ['docker down',             'docker ps',                            1, 'Cannot connect to the Docker daemon. Is the docker daemon running?', 'suggest'],
  ['disk full',               'dd if=/dev/zero of=/tmp/big',          1, 'dd: writing to /tmp/big: No space left on device', 'suggest'],
  ['dns down',                'curl https://example.com',             6, 'curl: (6) Could not resolve host: example.com', 'suggest'],
  ['oom',                     'npm run build',                      137, 'Killed', 'suggest'],
  ['ssh key rejected',        'ssh git@github.com',                 255, 'git@github.com: Permission denied (publickey).', 'suggest'],
  ['permission denied',       'cat /etc/shadow',                      1, 'cat: /etc/shadow: Permission denied', 'suggest'],
];

console.log('\nfixit precision tests\n');

let noise = 0, missed = 0;
for (const [label, command, exitCode, output, expectation] of CORPUS) {
  test(`${expectation === 'silent' ? 'silent' : 'suggests'}: ${label}`, () => {
    const fixes = findFixes(command, exitCode, output, ctx);
    if (expectation === 'silent') {
      if (fixes.length) {
        noise++;
        throw new Error(`expected silence, got: ${fixes.map(f =>
          `[${f.confidence}] ${f.message}${f.command ? ' -> ' + f.command : ''}`).join(' | ')}`);
      }
    } else {
      if (!fixes.length) { missed++; throw new Error('expected a suggestion, got silence'); }
      assert.ok(fixes[0].confidence >= 0.7, `confidence ${fixes[0].confidence} below floor`);
    }
  });
}

// ── Targeted regressions ─────────────────────────────────────────────────────
console.log('\nregressions\n');

test('RC-2/3: a mistyped path yields a runnable command, not a bare filename', () => {
  const fixes = findFixes('cat notes.md', 1, 'cat: notes.md: No such file or directory', ctx);
  assert.ok(fixes.length > 0, 'no suggestion (the rule used to throw ReferenceError)');
  assert.strictEqual(fixes[0].command, 'cat notes.txt');
});

test('RC-3: no rule throws on any corpus input', () => {
  const rules = require('../src/rules');
  for (const [, command, exitCode, output] of CORPUS) {
    for (const rule of rules) {
      try { rule.match({ command, exitCode, output, context: ctx }); }
      catch (e) { throw new Error(`rule "${rule.name}" threw on "${command}": ${e.message}`); }
    }
  }
});

test('RC-4: best candidate wins, not readdir order', () => {
  // `shadoww` is 1 edit from `shadow` and 2 from `gshadow`.
  fs.writeFileSync(path.join(WORK, 'shadow'), 'x');
  fs.writeFileSync(path.join(WORK, 'gshadow'), 'x');
  const fixes = findFixes('cat shadoww.txt', 1, 'cat: shadoww.txt: No such file or directory',
    { ...ctx, cwd: WORK });
  if (fixes.length) assert.ok(!/gshadow/.test(fixes[0].command), `picked ${fixes[0].command}`);
});

test('a typo fix keeps any wrapper prefix', () => {
  const fixes = findFixes('sudo gti status', 127, 'gti: command not found', ctx);
  assert.ok(fixes.length > 0);
  assert.strictEqual(fixes[0].command, 'sudo git status');
});

test('RC-5: a chain yields one suggestion, not one per segment', () => {
  const fixes = findFixes('cd /tmp && cat notes.md && echo done', 1,
    'cat: notes.md: No such file or directory', ctx);
  assert.strictEqual(fixes.length, 1, `got ${fixes.length}: ${JSON.stringify(fixes)}`);
  assert.ok(/notes\.txt/.test(fixes[0].command), fixes[0].command);
});

test('RC-5: quoted separators are not split', () => {
  const { splitSegments } = require('../src/cmd');
  assert.deepStrictEqual(splitSegments(`awk 'BEGIN{print 1; print 2}' d.txt`),
    [`awk 'BEGIN{print 1; print 2}' d.txt`]);
});

test('RC-7: confidence floor is enforced', () => {
  const rules = require('../src/rules');
  for (const rule of rules) {
    const fix = rule.match({
      command: 'true', exitCode: 1, output: '', context: ctx,
    });
    if (fix && !Array.isArray(fix)) assert.ok(fix.confidence >= 0.7, `${rule.name} -> ${fix.confidence}`);
  }
});

test('RC-8: disabledRules is honoured', () => {
  const cfgPath = path.join(TMP, 'disabled.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ disabledRules: ['git-push-rejected'] }));
  const out = require('child_process').execFileSync(process.execPath, ['-e', `
    process.env.FIXIT_CONFIG = ${JSON.stringify(cfgPath)};
    process.env.FIXIT_LEARN_DIR = ${JSON.stringify(path.join(TMP, 'learn'))};
    const { findFixes } = require(${JSON.stringify(path.resolve(__dirname, '../src/engine'))});
    const f = findFixes('git push', 1, '! [rejected] main -> main (non-fast-forward)', ${JSON.stringify(ctx)});
    console.log(JSON.stringify(f.map(x => x.message)));
  `], { encoding: 'utf8' });
  assert.ok(!/Pull with rebase/.test(out), `rule still fired: ${out.trim()}`);
});

// ── Learned history ──────────────────────────────────────────────────────────
console.log('\nlearned history\n');

const LEARN_DIR = path.join(TMP, 'learn');
const learnFile = path.join(LEARN_DIR, 'history.json');
function seed(entries) {
  fs.mkdirSync(LEARN_DIR, { recursive: true });
  fs.writeFileSync(learnFile, JSON.stringify(entries, null, 2));
}
const now = Date.now();

test('RC-1: history does not hijack an unrelated failure', () => {
  seed([
    { failedCommand: 'npm install express', exitCode: 1, suggestedCommand: 'npm install express --legacy-peer-deps', accepted: true, acceptCount: 1, timestamp: now },
    { failedCommand: 'git push', exitCode: 1, suggestedCommand: 'git pull --rebase && git push', accepted: true, acceptCount: 1, timestamp: now },
  ]);
  // Shares only the token `npm` with the stored failure.
  const build = findFixes('npm run build', 1, '2 tests failed', ctx);
  assert.ok(!build.some(f => f.learned), `recalled: ${JSON.stringify(build)}`);
  // Same program, entirely different failure.
  const status = findFixes('git status', 1, 'fatal: not a git repository', ctx);
  assert.ok(!status.some(f => f.learned), `recalled: ${JSON.stringify(status)}`);
});

test('RC-1: a matching rule outranks a recalled fix', () => {
  seed([{ failedCommand: 'git commit -m x', exitCode: 1, suggestedCommand: 'git pull --rebase', accepted: true, acceptCount: 9, timestamp: now }]);
  const fixes = findFixes('git commit -m x', 1, 'nothing to commit, working tree clean', ctx);
  assert.ok(fixes.length > 0);
  assert.strictEqual(fixes[0].command, 'git status', `got ${fixes[0].command}`);
});

test('RC-1: an exact repeat is still recalled', () => {
  seed([{ failedCommand: 'kubectl aply -f x.yaml', exitCode: 1, suggestedCommand: 'kubectl apply -f x.yaml', accepted: true, acceptCount: 3, timestamp: now }]);
  const fixes = findFixes('kubectl aply -f x.yaml', 1, 'unknown command "aply"', ctx);
  const learned = fixes.find(f => f.learned);
  assert.ok(learned, `no recall: ${JSON.stringify(fixes)}`);
  assert.strictEqual(learned.command, 'kubectl apply -f x.yaml');
  assert.ok(learned.confidence <= 0.9, `confidence ${learned.confidence} may outrank rules`);
});

test('RC-2: history poisoned with a bare path is ignored', () => {
  seed([
    { failedCommand: 'cat HN_LAUCNH.MD', exitCode: 1, suggestedCommand: 'HN_LAUNCH.md', accepted: true, acceptCount: 4, timestamp: now },
    { failedCommand: 'cat model cache', exitCode: 1, suggestedCommand: 'HN_LAUNCH.md', accepted: true, acceptCount: 2, timestamp: now },
  ]);
  const fixes = findFixes('cat /etc/shadow', 1, 'cat: /etc/shadow: Permission denied', ctx);
  assert.ok(!fixes.some(f => f.command === 'HN_LAUNCH.md'), `recalled a bare path: ${JSON.stringify(fixes)}`);
  assert.ok(fixes[0].command.startsWith('sudo'), `expected the sudo fix, got ${fixes[0].command}`);
});

test('RC-2: a bare path is never recorded as a fix', () => {
  fs.rmSync(learnFile, { force: true });
  const learn = require('../src/learn');
  learn.record({ failedCommand: 'cat x.md', exitCode: 1, suggestedCommand: 'notes.txt', accepted: true, context: {} });
  assert.strictEqual(learn.load().length, 0, 'stored an unrunnable suggestion');
  learn.record({ failedCommand: 'cat x.md', exitCode: 1, suggestedCommand: 'cat notes.txt', accepted: true, context: {} });
  assert.strictEqual(learn.load().length, 1);
});

test('repeat acceptances collapse into acceptCount', () => {
  fs.rmSync(learnFile, { force: true });
  const learn = require('../src/learn');
  for (let i = 0; i < 3; i++) {
    learn.record({ failedCommand: 'gti push', exitCode: 127, suggestedCommand: 'git push', accepted: true, context: {} });
  }
  const entries = learn.load();
  assert.strictEqual(entries.length, 1, `${entries.length} duplicate entries`);
  assert.strictEqual(entries[0].acceptCount, 3);
});

// ── Shell hook framing ───────────────────────────────────────────────────────
// The `hook` output is parsed by bash/zsh `read` with IFS set to the separator.
// A tab would be IFS *whitespace*, so repeated tabs collapse and a fix with no
// command shifts the learned flag into the command slot — the shell then prints
// "[Ctrl+X Tab to run] 0".
console.log('\nshell hook framing\n');

const { execFileSync } = require('child_process');
const CLI = path.resolve(__dirname, '../bin/cli.js');
const SEP = '\u001f'; // must match bin/cli.js

function hook(command, exitCode, output) {
  const errFile = path.join(TMP, 'hook-stderr');
  fs.writeFileSync(errFile, output || '');
  return execFileSync(process.execPath, [CLI, 'hook', command, String(exitCode), WORK, errFile], {
    encoding: 'utf8',
    env: { ...process.env, FIXIT_LEARN_DIR: path.join(TMP, 'empty-learn') },
  });
}

test('a fix with no command keeps three fields', () => {
  const line = hook('git status', 1, 'fatal: not a git repository (or any of the parent directories): .git').replace(/\n$/, '');
  const parts = line.split('');
  assert.strictEqual(parts.length, 3, `got ${parts.length} fields: ${JSON.stringify(line)}`);
  assert.ok(parts[0].length > 0, 'message empty');
  assert.strictEqual(parts[1], '', 'command should be empty for an advice-only fix');
  assert.strictEqual(parts[2], '0');
});

test('the separator is not IFS whitespace', () => {
  // Parsed the way the hooks parse it: an empty middle field must survive.
  const line = hook('git status', 1, 'fatal: not a git repository (or any of the parent directories): .git').replace(/\n$/, '');
  const parsed = execFileSync('bash', ['-c',
    `IFS=$'\\x1f' read -r m c l <<< "$1"; printf '%s|%s' "$c" "$l"`, '_', line],
    { encoding: 'utf8' });
  assert.strictEqual(parsed, '|0', `bash parsed command/learned as ${parsed}`);
});

test('a fix with a command still parses', () => {
  const line = hook('gti status', 127, 'gti: command not found').replace(/\n$/, '');
  const [message, command, learned] = line.split('');
  assert.ok(/git/.test(message));
  assert.strictEqual(command, 'git status');
  assert.strictEqual(learned, '0');
});

test('messages never contain the separator or a newline', () => {
  for (const [, command, exitCode, output] of CORPUS) {
    const line = hook(command, exitCode, output);
    if (!line) continue;
    assert.strictEqual(line.split('\n').filter(Boolean).length, 1, `multi-line output for ${command}`);
    assert.strictEqual(line.replace(/\n$/, '').split('').length, 3, `bad framing for ${command}`);
  }
});

test('nothing to say means no output at all', () => {
  assert.strictEqual(hook('sleep 100', 130, ''), '', 'printed something for Ctrl+C');
  assert.strictEqual(hook('grep zzz README.md', 1, ''), '', 'printed something for a grep miss');
});

console.log(`\n${passed} passed, ${failed} failed   (noise: ${noise}, missed: ${missed})\n`);
process.exit(failed > 0 ? 1 : 0);
