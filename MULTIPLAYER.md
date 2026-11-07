# Multiplayer: challenges, invite links and live turn-based games

Two-seat, turn-based games with no clocks. A match is resumable: leave, come
back, carry on (correspondence style). Chess is the first game type; pool plugs in
through the same interface (below).

This repo is public, so this file says how it works, not how to get in.

## Game-type plugin interface

One ESM file per game type at `shared/<type>/index.js`, default-exporting:

```js
{
  type: 'chess',          // must equal the directory name: [a-z][a-z0-9-]*
  title: 'Chess',         // optional display name
  seats: 2,               // the server only supports 2 for now
  initialState(seed)      // -> state.  `seed` is a random 16-hex string, stored with the match
  applyMove(state, move, seat)
                          // -> { state, events }, or throws an IllegalMove
  view(state, seat)       // seat is 0, 1 or null (spectator) -> what that viewer may see
  status(state)           // -> { turn, over, winner, reason }
}
```

- **Pure, deterministic, JSON-serialisable.** No clock, no `Math.random()`, no I/O,
  no mutation of the `state` argument. Anything random derives from `seed` and
  lives in `state`. `state`, `move` and `events` must survive `JSON.parse(JSON.stringify(x))`.
- `seat` is `0` or `1`. In chess seat 0 is white. `applyMove` is called with the
  seat that SENT the move, authenticated by the server; the engine decides whether
  that seat may move now (turn order), and may allow out-of-turn actions such as
  resign. Chess does.
- `move` is whatever the client sends as `{ move }` (max ~2 KB serialised). The
  engine validates it completely; the server never interprets it.
- **IllegalMove.** Throw an error whose `name === 'IllegalMove'` (or `code ===
  'ILLEGAL_MOVE'`). The server answers 422 with the message. Any other error is a
  500 and is logged by message only.
- `events` is a list of small JSON objects (`{ type: 'move', san, ... }`) stored
  with the move in the move log. The client never receives the raw log.
- `status(state)`: `turn` is the seat to act or `null` when over; `over` boolean;
  `winner` is `0`, `1` or `null` (a draw when `over` and `winner === null`);
  `reason` a short string (`checkmate`, `resignation`, ...). The server records
  `winner` and `reason` on the match when `over` first becomes true and then
  refuses further moves.
- `view(state, seat)` is the ONLY thing sent to browsers. For hidden information
  (not needed by chess or open-table pool) strip it here. The server calls it with
  `seat = null` for spectators and for matches that are not yet active. Chess puts
  its `legalMoves` for the seat to move into the view, so the client needs no rules.
- A directory under `shared/` with no `index.js`, or whose export fails the shape
  check, is skipped with a warning at boot; it never becomes a playable type. So a
  half-built game cannot be started. `GET /api/play/types` lists what loaded.
- `shared/package.json` is `{ "type": "module" }`, which is what makes these `.js`
  files ESM for Node while the server is CommonJS. The server loads them with
  `await import()` (`server/multiplayer/engines.js`); the Vite client may import the
  same files (a pool client will want the physics for animation). The Dockerfile
  copies `shared/` into the image.
- Client side, a type needs a renderer registered in `client/src/play/PlayPage.ts`
  (`UIS`) with the signature of `renderChess` in `client/src/play/chess.ts`, and a
  card in `client/src/play/PlayHub.ts`. Pool's card currently says "coming soon".

Chess specifics: FEN is stored on the state and on every history entry, SAN on
every history entry. Moves are `{ from: 'e2', to: 'e4', promotion?: 'q'|'r'|'b'|'n' }`
or `{ t: 'resign' | 'offerDraw' | 'acceptDraw' | 'declineDraw' }`. Threefold
repetition and the fifty-move rule are applied automatically when they occur
(a draw), and checkmate outranks the fifty-move rule. Insufficient material is
K v K, K+minor v K, and only same-coloured bishops. The rules engine
(`shared/chess/rules.js`) is checked by perft against the published node counts
(`test/chess-engine.test.js`).

## Data

Two tables, created with a plain additive `sync()` after the app's existing
alter-sync (never forced, never altered here): `Matches` (id, type, state JSON,
status, seed, version, per-seat kind / name / lower-cased key / token hash,
createdBy, inviteToken, expiry, lastMoveAt, winner, reason) and `MatchMoves`
(matchId, ply, seat, move, events). Guest seat tokens are stored only as a
SHA-256 hash. Invite tokens are stored as issued, because the creator must be able
to copy the link again; they are 192 bits of `crypto.randomBytes`, URL-safe.
Match ids are random UUIDs. A column added later needs a real migration: `sync()`
does not alter existing tables.

`status`: `challenge`, `open` (invite, seat empty), `active`, `finished`,
`declined`, `cancelled`, `revoked`, `expired`.

**Concurrency.** Every match has a `version`, bumped by each move, claim, accept
and revoke. A move POST carries the version it was based on. The update is
`... WHERE id = ? AND version = ? AND status = 'active'`, so of two moves based on
the same version exactly one wins; the other gets **409** `{ error: 'STALE', version }`
and the client refetches.

## Routes

Signed in, behind login and the app-access gate (`/api/play`, mounted after them):

| Route | Does |
|---|---|
| `GET /types` | loaded game types |
| `GET /matches` | `{ incoming, matches }` for the caller |
| `POST /challenges` `{ type, opponent, color? }` | challenge a username |
| `POST /invites` `{ type, color? }` | new match with an invite link |
| `POST /matches/:id/accept` / `decline` | answer a challenge (the challenged user only) |
| `POST /matches/:id/cancel` | creator withdraws a pending challenge or unclaimed link |
| `POST /matches/:id/revoke-invite` | creator kills the link |

Guest-reachable (`/play`, mounted BEFORE the SSO and app-access gates):

| Route | Who |
|---|---|
| `GET /m/:id`, `/m/:id/state`, `/m/:id/events` (SSE), `POST /m/:id/moves` | a seat holder: the signed-in user in that seat, or the holder of that seat's guest cookie |
| `GET /i/:token` (page), `/i/:token/info`, `/i/:token/state`, `/i/:token/events`, `POST /i/:token/claim` | whoever has the link |

**This deliberately lets guests past the app gate, for those two route families
only.** Nothing else is exposed: every route resolves one match and authorises
against it. A match you hold no seat in and no link to answers **404** (not 403,
which would confirm it exists), for signed-in users and anonymous callers alike.
Creating, listing, accepting and revoking stay behind login and the gate.
`/play/*` also runs the SSO middleware (which never rejects) so a signed-in player
is recognised. A signed-in account that the app gate would refuse can still use a
link; that is no stronger than being a guest.

## Starting a match

**Challenge by username.** The opponent is named by typing a username. The server
does NOT look it up (no user directory, no call to auth): a name nobody holds gets
the same 201, the same pending match and the same list entry as a real one, and it
simply expires after 7 days. The challenged user sees it under "Incoming challenges"
and accepts or declines. Usernames must match `[A-Za-z0-9_.-]{1,64}` (auth's own
rule), you cannot challenge yourself, and at most 3 unanswered challenges to the
same name. Identity is the username, compared case-insensitively; the games server
does not hold the numeric account id, so a renamed account does not inherit
pending challenges. Active matches belong to the seat's stored username.

**Invite link.** `/play/i/<token>`. The first person to open it takes the empty
seat, atomically (`UPDATE ... WHERE status = 'open' AND seat is empty`, exactly one
claimant wins; the loser becomes a spectator). A signed-in user takes it under
their username. Anyone else picks a display name (1-24 characters, trimmed,
letters / digits / space / `_` `-` `.` only, no control characters; markup
characters are refused outright and the client renders names with `textContent`
only) and receives a guest seat cookie: a separate 192-bit token, `HttpOnly;
Secure; SameSite=Lax; Path=/play/m/<matchId>`, 30 days, refreshed on each state
fetch. After both seats are filled the link opens the match read-only for
spectators. The creator can revoke it: an unclaimed match dies, a started one keeps
going but spectators are cut off and the link 404s.

## Limits

- 20 matches per user in `challenge`, `open` or `active` (ones they created, plus
  active ones they play in; incoming challenges do not count against the target).
- Unclaimed invites and unanswered challenges expire after 7 days (checked on use).
- Moves: 10 per 10 seconds per seat per match, then 429 (in memory, per process).
- Live streams: 40 per match.

## Live updates

Server-Sent Events at `.../events`, no dependency. Each stream sends `retry`, an
initial `update`, an `update` event (`{ version, status }`, a hint only; the client
refetches its own view) after every change, and a `: hb` comment every 25 s. Headers
include `Cache-Control: no-cache` and `X-Accel-Buffering: no`. The client falls back
to polling every 4 s if `EventSource` errors, and polls every 15 s regardless as a
safety net, because a proxy that buffers the stream would otherwise look exactly
like a quiet game. Whether the production proxy and Cloudflare pass the stream
through unbuffered has not been verified.

## Not logged

Tokens are never logged: errors log `err.message` only, no request URLs, headers
or bodies. All `/play` and `/api/play` responses are `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, because the invite
token is in the URL path.
