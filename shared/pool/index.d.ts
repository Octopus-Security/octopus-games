export type Ball = [number, number] | null;
export interface Shot { angle: number; power: number; spinX?: number; spinY?: number }
export type PoolMove = Shot | { placeCue: { x: number; y: number } } | { callPocket: number };
export type Group = 'solid' | 'stripe';
export interface PoolEvent { type: string; [k: string]: unknown }
export interface LastShot {
  seat: number; shot: Shot; frameCount: number; tracks: (number[] | null)[]; frameDt: number; events: PoolEvent[];
  firstContact: number | null; pocketed: number[]; fouls: string[]; respotted: number[];
}
export type Variant = '8ball' | '9ball';
export interface PoolState {
  type: 'pool'; v: number; variant?: Variant; seed: number | string; balls: Ball[]; turn: number;
  groups: (Group | null)[]; breakShot: boolean; inHand: { kitchen: boolean } | null;
  called: number | null; over: boolean; winner: number | null; reason: string | null;
  shots: number; lastShot: LastShot | null;
}
export interface PoolView {
  type: 'pool'; variant: Variant; lowest: number | null; you: number | null; turn: number | null; over: boolean; winner: number | null;
  reason: string | null; balls: Ball[]; groups: (Group | null)[];
  targets: (string | null)[]; inHand: { kitchen: boolean } | null; breakShot: boolean;
  called: number | null; mustCall: boolean; shots: number; lastShot: LastShot | null;
}
export interface PoolStatus { turn: number | null; over: boolean; winner: number | null; reason: string | null }
export class IllegalMove extends Error { code: string }
export function initialState(seed?: number | string, options?: { variant?: Variant }): PoolState;
export function rackOrder9(seed: number | string): number[];
export function lowestBall(balls: Ball[]): number | null;
export const VARIANTS: Variant[];
export const variants: Variant[];
export function applyMove(state: PoolState, move: PoolMove, seat: number): { state: PoolState; events: PoolEvent[] };
export function view(state: PoolState, seat?: number | null): PoolView;
export function status(state: PoolState): PoolStatus;
export function targetOf(state: PoolState, seat: number): string | null;
export function groupOf(id: number): 'solid' | 'stripe' | 'eight' | 'cue';
export function rackOrder(seed: number | string): number[];
export function resolveShot(state: PoolState, seat: number, shot: Shot, sim: unknown): { state: PoolState; events: PoolEvent[] };
export function simulateShot(table: { balls: Ball[] }, shot: Shot): {
  finalState: { balls: Ball[] }; frames: number[][]; frameDt: number; events: PoolEvent[];
  summary: { firstContact: number | null; pocketed: { ball: number; pocket: number }[]; offTable: number[];
    cueScratch: boolean; cushionAfterContact: number; cushionBalls: number[]; seconds: number; timedOut: boolean };
};
export function aimGuide(balls: Ball[], angle: number): {
  point: [number, number]; ball: number | null;
  objectDir: { x: number; y: number } | null; cueDir: { x: number; y: number } | null;
};
export function cuePlacementProblem(balls: Ball[], x: number, y: number, kitchen: boolean, self?: number): string | null;
export function nearestFreeSpot(balls: Ball[], x: number, y: number, kitchen: boolean, self?: number): [number, number];
export function normaliseShot(shot: unknown): Required<Shot> | null;
export const W: number;
export const H: number;
export const R: number;
export const D: number;
export const HEAD_X: number;
export const FOOT_X: number;
export const V_MAX: number;
export const MAX_FRAMES: number;
export const POCKETS: { x: number; y: number; r: number }[];
export const KNUCKLES: [number, number][];
export const type: 'pool';
export const seats: 2;
export const title: 'Pool';
declare const plugin: {
  type: 'pool'; title: 'Pool'; seats: 2; initialState: typeof initialState; applyMove: typeof applyMove;
  view: typeof view; status: typeof status; IllegalMove: typeof IllegalMove;
};
export default plugin;
