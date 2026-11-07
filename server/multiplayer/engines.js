'use strict';
// Loads game-type plugins from shared/<type>/index.js. Those are ESM (shared/
// package.json says "type": "module") and this server is CommonJS, hence the
// dynamic import. A directory without an index.js, or whose export does not have
// the plugin shape, is skipped: a half-built game never becomes a playable type.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SHARED_DIR = path.join(__dirname, '../../shared');

function valid(p, dir) {
  return p && p.type === dir && p.seats === 2 &&
    ['initialState', 'applyMove', 'view', 'status'].every(k => typeof p[k] === 'function');
}

async function loadEngines(sharedDir = SHARED_DIR) {
  const engines = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(sharedDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { /* none */ }
  for (const dir of dirs.sort()) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(dir)) continue;
    const file = path.join(sharedDir, dir, 'index.js');
    if (!fs.existsSync(file)) continue;
    try {
      const mod = await import(pathToFileURL(file).href);
      if (valid(mod.default, dir)) engines.set(dir, mod.default);
      else console.warn(`[play] shared/${dir}/index.js does not export a valid game plugin; skipped`);
    } catch (e) {
      console.warn(`[play] shared/${dir} failed to load: ${e.message}`);
    }
  }
  return engines;
}

const isIllegalMove = e => !!e && (e.name === 'IllegalMove' || e.code === 'ILLEGAL_MOVE');

module.exports = { loadEngines, isIllegalMove, SHARED_DIR };
