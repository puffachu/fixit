'use strict';
// Isolate learned history: without this the suite reads the developer's real
// ~/.fixit/history.json, and a recalled fix takes fixes[0] out from under the
// rule assertions below.
process.env.FIXIT_LEARN_DIR = '/tmp/fixit-engine-test-' + process.pid;
process.env.FIXIT_CONFIG = '/tmp/fixit-engine-test-config-' + process.pid + '.json';
const { findFixes } = require('../src/engine');
const assert = require('assert');

const ctx = {
  cwd: '/tmp', platform: 'linux', isGitRepo: true, gitBranch: 'main',
  gitStatus: '## main...origin/main [behind 2]', packageManager: 'npm',
  hasNodeModules: false, hasDockerfile: false
};

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\nfixit engine tests\n');

test('returns empty on exit code 0', () => {
  assert.deepStrictEqual(findFixes('ls', 0, '', ctx), []);
});

test('git push rejected → suggest pull --rebase', () => {
  const fixes = findFixes('git push origin main', 1, '! [rejected] main -> main (non-fast-forward)', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.includes('pull --rebase'));
  assert.ok(fixes[0].confidence > 0.9);
});

test('permission denied → suggest sudo', () => {
  const fixes = findFixes('cat /etc/shadow', 1, 'cat: /etc/shadow: Permission denied', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.startsWith('sudo'));
});

test('port in use → identify the owner, not a blind kill -9', () => {
  const fixes = findFixes('npm start', 1, 'Error: listen EADDRINUSE: address already in use :::3000', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.includes('3000'));
  // Whatever holds the port may be a database or another user's process.
  assert.ok(!/kill\s+-9/.test(fixes[0].command));
});

test('missing node module → suggest npm install', () => {
  const fixes = findFixes('node server.js', 1, "Error: Cannot find module 'express'", ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.includes('npm install express'));
});

test('disk full → suggest df', () => {
  const fixes = findFixes('dd if=/dev/zero of=/tmp/big', 1, 'No space left on device', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.includes('df'));
});

test('DNS failure → suggest ping', () => {
  const fixes = findFixes('curl https://example.com', 7, 'curl: (6) Could not resolve host: example.com', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].confidence >= 0.7);
});

test('docker not running → suggest start', () => {
  const fixes = findFixes('docker ps', 1, 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.includes('systemctl start docker'));
});

test('python missing module → suggest pip install', () => {
  const fixes = findFixes('python3 app.py', 1, 'ModuleNotFoundError: No module named "flask"', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.includes('pip install flask'));
});

test('git nothing to commit → suggest git status', () => {
  const fixes = findFixes('git commit -m "test"', 1, 'nothing to commit, working tree clean', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command === 'git status');
});

test('git no upstream → suggest set-upstream', () => {
  const fixes = findFixes('git push', 1, "fatal: The current branch feature-x has no upstream branch.", ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.includes('--set-upstream'));
  assert.ok(fixes[0].command?.includes('feature-x') || fixes[0].command?.includes('main'));
});

test('OOM kill (exit 137) → suggest free', () => {
  const fixes = findFixes('npm run build', 137, 'Killed', ctx);
  assert.ok(fixes.length > 0);
  assert.ok(fixes[0].command?.includes('free'));
});

test('unknown command with no near match → silent', () => {
  // `gitstatus` is 6 edits from `git`. Repeating "is it installed?" back at the
  // user adds nothing the error message did not already say.
  const fixes = findFixes('gitstatus', 127, 'gitstatus: command not found', ctx);
  assert.deepStrictEqual(fixes, []);
});

test('typo’d command → correct it with the arguments intact', () => {
  const fixes = findFixes('gti status', 127, 'gti: command not found', ctx);
  assert.ok(fixes.length > 0);
  assert.strictEqual(fixes[0].command, 'git status');
  // A transposition is an unambiguous typo; say so with real confidence.
  assert.ok(fixes[0].confidence >= 0.9, `confidence was ${fixes[0].confidence}`);
});

test('no match → returns empty', () => {
  const fixes = findFixes('echo hello', 0, '', ctx);
  assert.deepStrictEqual(fixes, []);
});

test('multiple rules can fire, sorted by confidence', () => {
  const fixes = findFixes('git push', 1, '! [rejected] (non-fast-forward)\nfatal: Could not read from remote repository.', ctx);
  assert.ok(fixes.length >= 1);
  for (let i = 1; i < fixes.length; i++)
    assert.ok(fixes[i-1].confidence >= fixes[i].confidence);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
