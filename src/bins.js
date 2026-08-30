'use strict';
const fs = require('fs');
const path = require('path');

let _cache = null;

// Every executable reachable via PATH, name -> absolute path.
// Built once per process; a failed command spawns one short-lived node, so this
// is a within-run cache, not a persistent one.
function allBins() {
  if (_cache) return _cache;
  _cache = new Map();
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory() || _cache.has(e.name)) continue; // earlier PATH entry wins
      const full = path.join(dir, e.name);
      try { fs.accessSync(full, fs.constants.X_OK); } catch { continue; }
      _cache.set(e.name, full);
    }
  }
  return _cache;
}

function binExists(name) {
  return !!name && allBins().has(name);
}

module.exports = { allBins, binExists };
