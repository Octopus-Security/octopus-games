// Snake rules, pure: no DOM, no timers, no randomness except the rng you pass in.
// Cells are { x, y } on a cols x rows grid; the snake is an array with the head first.

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const QUEUE_MAX = 2;

export const START_MS = 150;
export const MIN_MS = 65;

/** Milliseconds per step: starts slow and speeds up a little with every food eaten. */
export function tickMs(eaten) {
  return Math.max(MIN_MS, START_MS - eaten * 3);
}

/** A random free cell, never on the snake; null if the snake fills the board. */
export function placeFood(cols, rows, snake, rng = Math.random) {
  const taken = new Set(snake.map((c) => c.y * cols + c.x));
  const free = [];
  for (let i = 0; i < cols * rows; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) return null;
  const i = free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
  return { x: i % cols, y: Math.floor(i / cols) };
}

export function newGame(cols = 20, rows = 20, rng = Math.random) {
  const cy = Math.floor(rows / 2), cx = Math.floor(cols / 2);
  const snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
  return { cols, rows, snake, dir: 'right', queue: [], food: placeFood(cols, rows, snake, rng), eaten: 0, score: 0, over: false, won: false };
}

/**
 * Ask to turn. Compared with the direction the snake will be heading after the turns
 * already queued, so a reversal (or a repeat) is ignored. Up to two turns are kept,
 * which is what makes a fast "up, left" double-tap work. Returns true if queued.
 */
export function queueTurn(state, dir) {
  if (state.over || !DIRS[dir]) return false;
  const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
  if (dir === last || dir === OPPOSITE[last]) return false;
  if (state.queue.length >= QUEUE_MAX) return false;
  state.queue.push(dir);
  return true;
}

/** Advance one step. Mutates and returns state. Wall or self hit sets over. */
export function step(state, rng = Math.random) {
  if (state.over) return state;
  if (state.queue.length) state.dir = state.queue.shift();
  const d = DIRS[state.dir];
  const head = { x: state.snake[0].x + d.x, y: state.snake[0].y + d.y };
  if (head.x < 0 || head.y < 0 || head.x >= state.cols || head.y >= state.rows) { state.over = true; return state; }
  const ate = !!state.food && head.x === state.food.x && head.y === state.food.y;
  // the tail cell frees up this step unless we are growing
  const body = ate ? state.snake : state.snake.slice(0, -1);
  if (body.some((c) => c.x === head.x && c.y === head.y)) { state.over = true; return state; }
  state.snake.unshift(head);
  if (ate) {
    state.eaten++;
    state.score += 10;
    state.food = placeFood(state.cols, state.rows, state.snake, rng);
    if (!state.food) { state.over = true; state.won = true; }
  } else {
    state.snake.pop();
  }
  return state;
}
