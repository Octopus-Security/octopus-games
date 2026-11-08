export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Cell { x: number; y: number }
export interface SnakeState {
  cols: number; rows: number; snake: Cell[]; dir: Dir; queue: Dir[]; food: Cell | null;
  eaten: number; score: number; over: boolean; won: boolean;
}
export const DIRS: Record<Dir, Cell>;
export const START_MS: number;
export const MIN_MS: number;
export function tickMs(eaten: number): number;
export function placeFood(cols: number, rows: number, snake: Cell[], rng?: () => number): Cell | null;
export function newGame(cols?: number, rows?: number, rng?: () => number): SnakeState;
export function queueTurn(state: SnakeState, dir: Dir): boolean;
export function step(state: SnakeState, rng?: () => number): SnakeState;
