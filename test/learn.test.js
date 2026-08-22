'use strict';
const assert = require('assert');
const fs = require('fs');
process.env.FIXIT_LEARN_DIR = '/tmp/fixit-learn-test-' + Date.now();
const learn = require('../src/learn');
const { findFixes, recordAcceptance } = require('../src/engine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\nfixit learning tests\n');

test('empty history returns null', () => {
  assert.strictEqual(learn.findSimilar({ failedCommand: 'anything', exitCode: 1 }), null);
});

test('record + recall exact match', () => {
  recordAcceptance('nohup ../../bin/python bot/main.py &', 127, 'nohup python3 bot/main.py &', { cwd: '/tmp' });
  const result = findFixes('nohup ../../bin/python bot/main.py &', 127, '', {});
  assert.ok(result.length > 0);
  assert.strictEqual(result[0].learned, true);
  assert.ok(result[0].command.includes('python3'));
});

test('recall similar (not exact) command', () => {
  const result = findFixes('nohup ../bin/python bot/main.py &', 127, '', {});
  assert.ok(result.length > 0);
  assert.strictEqual(result[0].learned, true);
});

test('no recall for unrelated command', () => {
  const result = findFixes('cat /etc/shadow', 126, '', {});
  if (result.length > 0 && result[0].learned) throw new Error('should not have learned match');
});

test('similarity function works', () => {
  assert.strictEqual(learn.similarity('hello world', 'hello world'), 1);
  assert.ok(learn.similarity('nohup python bot', 'nohup python bot main') > 0.5);
  assert.ok(learn.similarity('cat file', 'docker ps') < 0.3);
});

test('acceptance persists to disk', () => {
  recordAcceptance('unique-cmd-xyz --flag', 1, 'fixed-cmd-xyz --flag', {});
  const data = JSON.parse(fs.readFileSync(learn.LEARN_FILE, 'utf8'));
  const found = data.find(e => e.failedCommand === 'unique-cmd-xyz --flag');
  assert.ok(found);
  assert.strictEqual(found.suggestedCommand, 'fixed-cmd-xyz --flag');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
