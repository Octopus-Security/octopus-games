export interface ChessBotOptions { level?: 'easy' | 'medium' | 'hard'; timeMs?: number; maxDepth?: number; rng?: () => number }
export interface ChessBotMove { from: string; to: string; promotion?: string; depth: number; nodes: number; ms: number; score: number }
export const LEVELS: Record<'easy' | 'medium' | 'hard', { maxDepth: number; timeMs: number; blunder: number; noise: number }>;
export function chooseMove(fen: string, opts?: ChessBotOptions): ChessBotMove | null;
