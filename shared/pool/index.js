// Pool game plugin. The interface the multiplayer host expects:
//   { type, seats, initialState(seed), applyMove(state, move, seat) -> { state, events },
//     view(state, seat | null), status(state) -> { turn, over, winner, reason } }
// applyMove throws IllegalMove (name === 'IllegalMove') for a move that is not allowed.
// Everything is pure, deterministic and JSON-serialisable.

import { initialState, applyMove, view, status, IllegalMove } from './rules.js';

export { initialState, applyMove, view, status, IllegalMove };
export { rackOrder, rackOrder9, targetOf, groupOf, resolveShot, compactTracks, lowestBall, VARIANTS } from './rules.js';
export {
  simulateShot, aimGuide, cuePlacementProblem, nearestFreeSpot, normaliseShot,
  W, H, R, D, HEAD_X, FOOT_X, POCKETS, KNUCKLES, V_MAX, MAX_FRAMES,
} from './physics.js';

export const type = 'pool';
export const seats = 2;
export const title = 'Pool';

// Chosen at match creation (initialState's second argument); the host validates against this list.
export const variants = ['8ball', '9ball'];

const plugin = { type, title, seats, variants, initialState, applyMove, view, status, IllegalMove };
export default plugin;
