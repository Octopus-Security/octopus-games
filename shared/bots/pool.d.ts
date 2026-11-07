import type { PoolState, PoolMove } from '../pool/index.js';
export interface PoolBotOptions { level?: 'easy' | 'medium' | 'hard'; rng?: () => number; maxSims?: number; budgetMs?: number }
export interface PoolBotResult { moves: PoolMove[]; info: { sims: number; ms: number; tag: string; score: number; level: string } }
export const LEVELS: Record<'easy' | 'medium' | 'hard', { maxSims: number; budgetMs: number; aimSigma: number; powerSigma: number; leave: boolean; powers: number[]; spins: number[]; pairs: number; pick: number }>;
export function chooseShot(state: PoolState, opts?: PoolBotOptions): PoolBotResult;
