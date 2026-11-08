'use strict';
// Per-game tab icons: the mapping, the fallback, and the swap/restore on a fake <link>.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let G;
before(async () => { G = await import('../client/src/gameIcons.js'); });

test('named games get their icon', () => {
  assert.equal(G.iconFor('pool'), '🎱');
  assert.equal(G.iconFor('snake'), '🐍');
  assert.equal(G.iconFor('frogger', 'Arcade'), '🐸');
  assert.equal(G.iconFor('chess'), '♟️');
});

test('every card game gets the cards through its category, any slug', () => {
  assert.equal(G.iconFor('blackjack', 'Cards'), '🃏');
  assert.equal(G.iconFor('some-future-solitaire', 'Cards'), '🃏');
});

test('anything else falls back to the default (null)', () => {
  assert.equal(G.iconFor('galaga', 'Arcade'), null);
  assert.equal(G.iconFor('constructor'), null);
  assert.equal(G.iconFor(), null);
});

test('emoji data URI is an SVG that carries the emoji', () => {
  const uri = G.emojiDataUri('🎱');
  assert.ok(uri.startsWith('data:image/svg+xml,'));
  const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
  assert.match(svg, /viewBox="0 0 100 100"/);
  assert.ok(svg.includes('🎱'));
});

test('setGameIcon swaps the link href and resetGameIcon restores the default', () => {
  const link = { href: 'https://auth.example/brand/games/favicon.svg', getAttribute(k) { return this[k]; }, setAttribute(k, v) { this[k] = v; } };
  global.document = { querySelector: (q) => (q === 'link[rel="icon"]' ? link : null) };
  try {
    G.setGameIcon('pool');
    assert.ok(link.href.startsWith('data:image/svg+xml,'));
    G.setGameIcon('galaga', 'Arcade'); // no icon: back to default
    assert.equal(link.href, 'https://auth.example/brand/games/favicon.svg');
    G.setGameIcon('blackjack', 'Cards');
    G.setGameIcon('frogger');
    G.resetGameIcon();
    assert.equal(link.href, 'https://auth.example/brand/games/favicon.svg');
    G.resetGameIcon(); // idempotent
    assert.equal(link.href, 'https://auth.example/brand/games/favicon.svg');
  } finally { delete global.document; }
});
