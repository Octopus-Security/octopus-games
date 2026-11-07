export interface ChessHistoryEntry { seat: 0 | 1; san: string; fen: string; from: string; to: string; promotion?: string }
export interface ChessState {
  fen: string; turn: 0 | 1; history: ChessHistoryEntry[]; reps: Record<string, number>;
  drawOffer: 0 | 1 | null; result: { winner: 0 | 1 | null; reason: string } | null;
}
export type ChessMove = { from: string; to: string; promotion?: string } | { t: 'resign' | 'offerDraw' | 'acceptDraw' | 'declineDraw' };
export class IllegalMove extends Error { code: string }
export function initialState(seed?: unknown): ChessState;
export function applyMove(state: ChessState, move: ChessMove, seat: number): { state: ChessState; events: unknown[] };
export function view(state: ChessState, seat: number | null): any;
export function status(state: ChessState): { turn: number | null; over: boolean; winner: number | null; reason: string | null };
declare const plugin: { type: 'chess'; title: string; seats: 2; initialState: typeof initialState; applyMove: typeof applyMove; view: typeof view; status: typeof status };
export default plugin;
