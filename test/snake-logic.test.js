'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let S;
before(async () => { S = await import('../client/src/games/snake/logic.js'); });
const rngOf = (v) => () => v;

test('new game: 3 long, heading right, food off the snake', () => {
  const g = S.newGame(20, 20, rngOf(0));
  assert.equal(g.snake.length, 3);
  assert.ok(!g.snake.some((c) => c.x === g.food.x && c.y === g.food.y));
});

test('step moves the head and keeps the length', () => {
  const g = S.newGame(20, 20, rngOf(0.99));
  const h = g.snake[0];
  S.step(g);
  assert.deepEqual(g.snake[0], { x: h.x + 1, y: h.y });
  assert.equal(g.snake.length, 3);
});

test('eating grows by one, scores, and moves the food off the snake', () => {
  const g = S.newGame(20, 20, rngOf(0.5));
  g.food = { x: g.snake[0].x + 1, y: g.snake[0].y };
  S.step(g, rngOf(0));
  assert.equal(g.snake.length, 4);
  assert.equal(g.score, 10);
  assert.ok(!g.snake.some((c) => c.x === g.food.x && c.y === g.food.y));
});

test('food is never placed on the snake, over many random draws', () => {
  const snake = [];
  for (let x = 0; x < 5; x++) for (let y = 0; y < 4; y++) snake.push({ x, y });
  for (let i = 0; i < 200; i++) {
    const f = S.placeFood(5, 5, snake, () => i / 200);
    assert.equal(f.y, 4);
  }
  assert.equal(S.placeFood(2, 2, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]), null);
});

test('hitting a wall ends the game', () => {
  const g = S.newGame(5, 5, rngOf(0));
  for (let i = 0; i < 10 && !g.over; i++) S.step(g);
  assert.ok(g.over);
});

test('hitting itself ends the game', () => {
  const g = S.newGame(20, 20, rngOf(0));
  g.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 }, { x: 5, y: 4 }];
  g.dir = 'up'; g.food = { x: 0, y: 0 };
  S.queueTurn(g, 'right');
  S.step(g); // head (6,5) is the body
  assert.ok(g.over);
});

test('moving into the cell the tail is leaving is allowed', () => {
  const g = S.newGame(20, 20, rngOf(0));
  g.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }];
  g.dir = 'left'; g.food = { x: 0, y: 0 };
  S.queueTurn(g, 'down'); // head -> (5,6) which is the tail
  S.step(g);
  assert.ok(!g.over);
});

test('instant reversal is refused, including against a queued turn', () => {
  const g = S.newGame();
  assert.equal(S.queueTurn(g, 'left'), false);
  assert.equal(S.queueTurn(g, 'right'), false);
  assert.equal(S.queueTurn(g, 'up'), true);
  assert.equal(S.queueTurn(g, 'down'), false);
});

test('a quick double-tap queues two turns, applied one per step', () => {
  const g = S.newGame(20, 20, rngOf(0));
  g.food = { x: 0, y: 0 };
  assert.equal(S.queueTurn(g, 'up'), true);
  assert.equal(S.queueTurn(g, 'left'), true);
  assert.equal(S.queueTurn(g, 'down'), false); // queue full
  const h = g.snake[0];
  S.step(g);
  assert.deepEqual(g.snake[0], { x: h.x, y: h.y - 1 });
  S.step(g);
  assert.deepEqual(g.snake[0], { x: h.x - 1, y: h.y - 1 });
});

test('speed rises with food eaten, with a floor', () => {
  assert.ok(S.tickMs(10) < S.tickMs(0));
  assert.equal(S.tickMs(10000), S.MIN_MS);
});
