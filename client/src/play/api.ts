export interface Seat { name: string | null; kind: 'user' | 'guest' | null; joined: boolean }

export interface MatchState {
  id: string;
  type: string;
  status: 'challenge' | 'open' | 'active' | 'finished' | 'declined' | 'cancelled' | 'revoked' | 'expired';
  version: number;
  createdBy: string;
  seats: [Seat, Seat];
  you: { seat: 0 | 1 | null; role: 'player' | 'spectator'; kind: 'user' | 'guest' | null; creator: boolean };
  game: { turn: 0 | 1 | null; over: boolean; winner: 0 | 1 | null; reason: string | null } | null;
  // Game-type specific; chess's shape is in chess.ts.
  view: any;
  invite?: { path: string };
}

export interface MatchSummary {
  id: string; type: string; status: string; version: number; createdBy: string;
  seat: 0 | 1; opponent: string | null; opponentKind: string | null;
  yourTurn: boolean; winner: number | null; reason: string | null;
  invite?: { path: string };
}

export interface ApiResult<T> { ok: boolean; status: number; data: T | null; error?: string; message?: string }

export async function api<T = any>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    let data: any = null;
    try { data = await r.json(); } catch { /* no body */ }
    return { ok: r.ok, status: r.status, data, error: data?.error, message: data?.message };
  } catch {
    return { ok: false, status: 0, data: null, error: 'NETWORK' };
  }
}

export const lobbyMessage = (r: ApiResult<unknown>): string => {
  switch (r.error) {
    case 'TOO_MANY_MATCHES': return 'You have 20 open matches. Finish or cancel one first.';
    case 'TOO_MANY_PENDING': return 'You already have several unanswered challenges to that name.';
    case 'BAD_USERNAME': return 'Usernames use letters, numbers, dot, dash and underscore.';
    case 'SELF_CHALLENGE': return 'You cannot challenge yourself.';
    case 'NOT_AUTHENTICATED': return 'Sign in first.';
    case 'NO_SUCH_PLAYER': return 'No player with that username.';
    case 'LOOKUP_UNAVAILABLE': return 'Could not check that username right now. Try again in a moment.';
    case 'TOO_MANY_LOOKUPS': return 'Too many names that are not players. Try again in a few minutes.';
    case 'NETWORK': return 'Could not reach the server.';
    default: return r.message || 'Something went wrong.';
  }
};
