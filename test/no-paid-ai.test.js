'use strict';
/**
 * OWNER RULE: computer opponents never call an LLM, cortex, the local-model route,
 * the Anthropic SDK or any paid API. They are classic algorithms that run in the
 * player's browser at zero server cost. This test fails if anything the opponents
 * are built from reaches for one:
 *
 *   - shared/            the engines and the bots (also loaded by the server)
 *   - client/src/play/   the game pages, bot host and Web Worker
 *
 * It looks at code with comments removed, so explaining the rule in a comment is
 * fine, but an import, a URL or a string naming an AI service is not.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['shared', 'client/src/play'];
const CODE = /\.(js|mjs|cjs|ts|tsx|jsx|json|html)$/;

// Anything that names an AI provider, the estate's model gateway, or the SDK.
const FORBIDDEN = [
  /@anthropic-ai/i, /\banthropic\b/i, /\bopenai\b/i, /openrouter/i, /\bcortex\b/i, /api\/local/i,
  /\bgemini\b/i, /generativelanguage/i, /\bxai\b/i, /api\.x\.ai/i, /\bgrok\b/i, /\bollama\b/i, /\bmistral\b/i,
  /\bllm\b/i, /chat\/completions/i, /\/v1\/messages/i, /\bclaude\b/i, /huggingface/i, /\bcohere\b/i, /\/api\/ai\b/i,
];
// Bot and engine code may not use the network at all. (api.ts and the pages that
// talk to the match host legitimately fetch /api/play, so they are exempt from this half.)
const NO_NETWORK_FILES = (rel) => rel.startsWith('shared/') || /^client\/src\/play\/(bots?|botWorker|local)[A-Za-z]*\.ts$/.test(rel);
const NETWORK = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/, /importScripts\s*\(/, /\bimport\s*\(\s*['"`]https?:/];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (CODE.test(e.name) || e.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Remove // and block comments (not the // inside a URL string) and the .md prose is not scanned at all. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function scan(rel, src) {
  const code = stripComments(src);
  const hits = [];
  for (const re of FORBIDDEN) if (re.test(code)) hits.push(`names an AI service/SDK (${re})`);
  if (NO_NETWORK_FILES(rel)) for (const re of NETWORK) if (re.test(code)) hits.push(`uses the network (${re})`);
  return hits;
}

test('no file under shared/ or client/src/play/ imports or calls an AI, LLM, cortex or paid API', () => {
  let files = 0;
  const problems = [];
  for (const d of DIRS) {
    const base = path.join(ROOT, d);
    assert.ok(fs.existsSync(base), `${d} exists`);
    for (const f of walk(base)) {
      files++;
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      for (const hit of scan(rel, fs.readFileSync(f, 'utf8'))) problems.push(`${rel}: ${hit}`);
    }
  }
  assert.ok(files >= 8, `scanned ${files} files; the scan must not pass by finding nothing`);
  assert.deepEqual(problems, []);
});

test('the scan itself catches what it is meant to catch', () => {
  assert.ok(scan('shared/bots/x.js', "import Anthropic from '@anthropic-ai/sdk';").length);
  assert.ok(scan('shared/bots/x.js', "const r = await fetch('/api/local/v1/chat/completions');").length >= 2);
  assert.ok(scan('client/src/play/botWorker.ts', "await fetch('https://example.com/move')").length);
  assert.ok(scan('client/src/play/chess.ts', "const u = 'https://api.openai.com/v1/x';").length);
  assert.ok(scan('client/src/play/x.ts', "ask('cortex')").length);
  assert.ok(scan('shared/chess/x.js', "const llm = require('llm');").length);
  assert.deepEqual(scan('shared/bots/x.js', '// never call an LLM or cortex here\n/* anthropic */ const a = 1;'), []);
  assert.deepEqual(scan('client/src/play/api.ts', "await fetch('/api/play/matches')"), [], 'the match host API is allowed in api.ts');
});

test('the bots do not depend on the Anthropic SDK or any AI package', () => {
  for (const f of ['shared/package.json', 'client/package.json']) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.deepEqual(deps.filter((d) => /anthropic|openai|langchain|ollama|gemini|llm/i.test(d)), [], f);
  }
  // shared/ is copied into the image next to the server: it must not import a server module that holds a key
  for (const f of walk(path.join(ROOT, 'shared'))) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    assert.ok(!/from\s+['"]\.\.\/\.\.\/server|require\(\s*['"]\.\.\/\.\.\/server/.test(src), `${f} imports a server module`);
  }
});
