'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = process.env.FIXIT_CONFIG || path.join(os.homedir(), '.fixit', 'config.json');

function load() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

module.exports = {
  load,
  get(key, fallback) {
    const cfg = load();
    return cfg[key] !== undefined ? cfg[key] : fallback;
  },
  isRuleEnabled(ruleName) {
    const disabled = this.get('disabledRules', []);
    return !disabled.includes(ruleName);
  },
  maxSuggestions() {
    return this.get('maxSuggestions', 5);
  }
};
