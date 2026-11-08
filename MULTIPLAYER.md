# Multiplayer: challenges, invite links and live turn-based games

Two-seat, turn-based games with no clocks. A match is resumable: leave, come
back, carry on (correspondence style). Chess and pool (8-ball and 9-ball) are the
two game types; both plug in through the same interface (below).

Every game can also be played **locally**, with no server and no account: pass and
play (two people, one device) and vs Computer. Those modes are not matches: they use
the same shared engine in the browser and are described under "Local modes" below.

This repo is public, so this file says how it works, not how to get in.

## Game-type plugin interface

One ESM file per game type at `shared/<type>/index.js`, default-exporting:

```js
{
  type: 'chess',          // must equal the directory name: [a-z][a-z0-9-]*
  title: 'Chess',         // optional display name
  seats: 2,               // the server only supports 2 for now
  variants: ['8ball', '9ball'],  // optional. A create request may carry { variant }; anything
                          // not in this list is refused with 400 BAD_VARIANT (a type without
                          // the list refuses every variant). Chosen once, stored in the state.
  initialState(seed, options?)
                          // -> state.  `seed` is a random 16-hex string, stored with the match.
                          //    `options` is { variant } and only exists for types that list `variants`
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
  card in `client/src/play/PlayHub.ts`. Chess is `chess.ts`, pool is `pool.ts`. The match
  page keeps ONE stage element across live updates, so a renderer may keep state on it
  (pool keeps its canvas there, which is what lets a new shot animate from where the balls
  were).

Pool specifics (rules in `shared/pool/RULES.md`): a move is a shot `{ angle, power, spinY? }`,
`{ placeCue: { x, y } }` (ball in hand) or `{ callPocket }` (8-ball only). The create request
takes `variant: '8ball' | '9ball'` (default `8ball`; a state stored before variants existed has
no `variant` field and is read as 8-ball). The state's `lastShot` holds the animation
(per-ball tracks); `view` carries it, so BOTH browsers replay every shot, the shooter's and the
opponent's, from data the server produced. The server is authoritative: it runs the physics,
the client only draws and sends the aim. Receiving the same state twice (a live-update refetch
and the reply to your own move) does not restart or cut short a replay; tapping the table skips
it.

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

## Local modes (pass and play, vs Computer)

Picked on each game's card in the hub ("Board games" tab): Online, Pass and play, vs
Computer. The two local modes:

- run entirely in the browser on the shared engine (`initialState`, `applyMove`, `view`,
  `status`), so the rules are the same as online;
- keep **no server state** and need **no account** (the cards work signed out);
- store only the game in progress in `localStorage` (`octopus_local_<game>_v1`, wrapped in
  try/catch, one per game), so a reload offers "Resume". A finished game is removed.
  `octopus_local_prefs_v1` holds the chess "board flips / fixed" setting;
- **Pass and play** shows a "Player 2's turn" handover card between turns (and when a game is
  resumed); pool only shows it when the turn really changes hands. Chess flips the board to the
  player to move unless "Board: fixed" is chosen. There are no draw offers locally (resign works);
- **vs Computer** has Easy, Medium and Hard.

### The computer opponents never use a paid service

They are classic algorithms in `shared/bots/` (`chess.js`, `pool.js`) running in a Web Worker
(`client/src/play/botWorker.ts`, hosted by `bots.ts`) in the player's browser. They call no LLM,
no cortex, no `/api/local`, no `@anthropic-ai/sdk` and no other API, and the server is never
involved, so a game costs nothing. `test/no-paid-ai.test.js` fails if anything under `shared/`
or `client/src/play/` imports or fetches one (and, for the bot and engine code, if it touches
the network at all). A reply is held back to a minimum "thinking" time (0.7 s chess, 0.9 s
pool) so it never looks instant; the engine has the last word, so a move it refuses is
replaced by a legal one. `shared/bots/` has no `index.js` on purpose: the server's engine
loader only registers directories that have one, so the bots are never a game type.

**Chess bot.** Alpha-beta (negamax) with iterative deepening under a time budget, check
extension, move ordering (previous best, MVV-LVA, promotions, killer moves, history), quiescence
on captures, and material plus piece-square tables (the king table switches to an endgame table
when little material is left). Easy: depth 2, noisy root scores and a 30% chance of a random
legal move. Medium: up to depth 5, ~1.1 s. Hard: up to depth 12, ~2 s (about depth 6 on a
laptop-class CPU). Not rated against any engine. It has no transposition table, no opening book
and no repetition awareness, so it can walk into a draw by repetition.

**Pool bot (8-ball and 9-ball).** For every legal target ball and pocket it computes the
ghost-ball aim and a power estimate, tries a few power and follow/draw variants plus gentle
"safe" hits, and simulates each with the real deterministic physics and rules
(`simulateShot` + `resolveShot`). It scores what the engine reports: pocketing a ball it may,
keeping the turn, a foul (very bad), how easy its next shot is, how easy a shot it leaves the
opponent. Ball in hand tries placements for straight-in shots; the break tries a few cue
positions; the 8 is called. The chosen shot gets a level-dependent aim and power error.
Easy: 8 simulations, large error, random among the best few. Medium: 30, moderate. Hard: 70,
small error. Each is also capped by wall-clock (0.5 / 1.2 / 1.8 s). Not modelled: bank shots,
combinations, kicks, side spin (the engine has none).

## Resuming a match (seat identity)

- Signed in: a seat is the lower-cased username, so any device returns to it with full state;
  `GET /api/play/matches` ("Your matches" on the Play tab) lists it, scoped to the caller's seats.
- Guest: an HttpOnly seat cookie scoped to `/play/m/<id>` (30 days, refreshed on each state read);
  it resumes in that browser only. The match page says so and offers sign-in.
- A guest who signs in can `POST /play/m/:id/adopt` (needs the seat cookie AND a session): the seat
  becomes theirs, the cookie is cleared, the match lists under their account.
- Anyone else gets 404 on `/play/m/:id`; through the invite link they only ever watch.
- Matches live in the `Matches` table (SQLite on the data volume), so they survive a restart/deploy.
