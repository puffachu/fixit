'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = process.env.FIXIT_CONFIG || path.join(os.homedir(), '.fixit', 'config.json');

let _cache;
function load() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; }
  catch { _cache = {}; }
  if (typeof _cache !== 'object' || Array.isArray(_cache)) _cache = {};
  return _cache;
}

module.exports = {
  load,
  get(key, fallback) {
    const cfg = load();
    return cfg[key] !== undefined ? cfg[key] : fallback;
  },
  isRuleEnabled(ruleName) {
    const disabled = this.get('disabledRules', []);
    return !Array.isArray(disabled) || !disabled.includes(ruleName);
  },
  maxSuggestions() {
    const n = Number(this.get('maxSuggestions', 3));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
  },
  // "Silent when unsure" needs an actual threshold to be true.
  minConfidence() {
    const n = Number(this.get('minConfidence', 0.7));
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0.7;
  },
};
