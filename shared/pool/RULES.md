# Pool rules as implemented

Two variants, chosen when a match is created (`initialState(seed, { variant })`, stored on
the state as `variant`; `'8ball'` is the default and what any state without the field is read
as). **9-ball is described in its own section at the end.**

Edition: **8-ball, called-8 variant, written from the common bar/league rules as
generally understood** (WPA-style foul and break structure, simplified). It is not
a transcription of any one federation's rulebook, and nobody has checked it
against one; treat the list of simplifications below as the authoritative
difference.

## Module

`shared/pool/index.js` exports the plugin
`{ type: 'pool', title: 'Pool', seats: 2, variants: ['8ball', '9ball'], initialState(seed, options?), applyMove(state, move, seat), view(state, seat | null), status(state) }`.
Everything is pure and JSON-serialisable. `applyMove` returns `{ state, events }`
and throws `IllegalMove` (`error.name === 'IllegalMove'`) for a move that is not
allowed; it never mutates its input.

Moves, exactly one per call:

| Move | Meaning |
|---|---|
| `{ angle, power, spinY?, spinX? }` | a shot. `angle` radians (0 = +x, y points down the screen), `power` in (0, 1], `spinY` -1 (draw) to +1 (follow), default 0 |
| `{ placeCue: { x, y } }` | position the cue ball while `state.inHand` is set; may be repeated |
| `{ callPocket: 0..5 }` | call the pocket for the 8 (0 top-left, 1 top-middle, 2 top-right, 3 bottom-left, 4 bottom-middle, 5 bottom-right) |

Table: 2000 x 1000 mm playing area, balls radius 26, six pockets. Speed is
`7000 * power^2` mm/s. Positions are rounded to 0.001 at the end of each shot and
the balls are at rest (no velocities are stored), so JSON round trips cannot drift.
`state.lastShot` holds the animation as `tracks`: 16 entries, `null` for a ball that
did not move, else `2 * frameCount` integers `x0,y0,x1,y1,...` in mm (`-1,-1` once
off the table), at most 241 frames, `frameDt` seconds per frame, plus the shot's
`events`. The entry is `shared/pool/index.js` (default export; `shared/package.json`
sets `"type": "module"`), and `seed` may be any string or number (hosts pass 16 hex).

## Rules

1. **Rack.** 15 balls, apex on the foot spot, the 8 in the middle of the third
   row, a solid in one back corner and a stripe in the other, the rest in a
   seeded order (mulberry32 over the seed; no `Math.random`).
2. **Break.** Seat 0 breaks, cue ball anywhere behind the head string (the
   `placeCue` is optional). A legal break pockets a ball or drives at least four
   object balls to a cushion; otherwise it is a foul (see simplifications).
   Pocketing a ball on a legal break keeps the turn. The table is **open** after
   the break whatever went in.
3. **Open table.** The first ball hit may be any solid or stripe, never the 8.
   On a shot with no foul, the group of the **first** object ball pocketed
   (events order) becomes the shooter's group and the opponent gets the other.
4. **Turn.** You keep the turn after a foul-free shot that pockets a ball of your
   own group (or any ball on the break). Pocketing only the opponent's balls, or
   nothing, passes the turn. Pocketed balls stay down.
5. **Fouls.** `scratch` (cue ball pocketed), `no-contact`, `wrong-ball` (first
   contact not a legal target: on an open table the 8; with groups, not your
   group; once your group is cleared, not the 8), `no-cushion` (after the first
   contact no ball reached a cushion and no object ball was pocketed),
   `illegal-break`, `off-table` (an object ball left the table; it is spotted).
6. **Ball in hand.** After any foul the opponent has the cue ball in hand
   **anywhere** on the cloth. The move is `placeCue`; it is checked for the
   cloth, overlap with other balls and the pocket mouths. A shot is allowed
   without placing: the cue ball then stays where the engine put it (where it
   lay, or the nearest free spot to the head spot if it was pocketed).
7. **The 8.** Legal only when your whole group is down. Before that shot you must
   send `{ callPocket }`; it is cleared after the shot. Pocketing the 8 in the
   called pocket with no foul wins. You **lose** if you pocket it early (group not
   cleared, open table included), in the wrong pocket, on the same shot as a
   scratch, with any other foul on the shot, or knock it off the table. Hitting the
   8 into a pocket on the break is not a result: it is spotted.
8. **Calling** is for the 8 only. All other pockets are "slop": any pocket counts.

## Simplifications (every one of them)

- **No side spin.** `spinX` is accepted and ignored. Side spin needs a third spin
  axis plus cushion throw and cue squirt to do anything real, and a control that
  does nothing visible is worse than none. Follow and draw (`spinY`) are modelled.
- **No ball-ball friction or throw, no cloth speed variation, no jumping.**
  Cushions reflect with a restitution and keep tangential velocity.
- **Illegal break is a foul** (cue ball in hand for the opponent, balls where they
  lie) rather than the opponent's choice of re-rack or accept.
- **8 on the break** is spotted on the foot spot (nearest free point), not a re-rack
  or an automatic win, and a scratch on the break is just a foul.
- **Ball in hand is anywhere**, including after a break scratch (a full rulebook
  limits it to behind the head string after a scratch on the break).
- **No push-shot, double-hit, touching-ball or moving-ball fouls**; the cue ball
  can only be struck once and from rest, so those cannot occur.
- **Jumping a ball off the table cannot happen** in this physics; the rule and the
  `off-table` foul exist and are tested by feeding the rules a hand-made result,
  but the cushions keep every ball on the cloth.
- **First contact** is the first ball the cue ball touches. Two balls touched in
  the same 1/480 s step are ordered by ball number.
- **Group decision with two kinds pocketed at once** takes the first in event order.
- **Pocketing the 8 and the last ball of your group on one shot** cannot be a win:
  the 8 is only legal when the group was already cleared when the shot began.
- **Scratching without pocketing the 8** on an 8-shot is an ordinary foul; only a
  scratch together with the 8 loses.
- **No time limit, no resignation, no draw, no three-foul rule.** The host owns those.
- **Pockets are capture discs** (a ball whose centre enters one is down) behind two
  jaw points at each mouth, not a modelled pocket interior. A ball that comes to
  rest hanging in a mouth drops into the nearest pocket.
- **Not verified against real pool.** The constants (restitution, friction, mouth
  widths) are plausible, not measured.

# 9-ball

`variant: '9ball'`. Same physics, table, moves (`placeCue` and shots; `callPocket` is refused
because nothing is called) and animation data as 8-ball. `view` adds `variant` and `lowest`
(the lowest numbered ball on the table), and `targets` is `'lowest'` for both seats.

## Rules

1. **Rack.** Balls 1-9 in a diamond (rows of 1, 2, 3, 2 and 1) with the **1 on the foot
   spot at the apex** and the **9 in the centre** of the widest row; the other seven are in
   a seeded order (`rackOrder9`, same mulberry32 as 8-ball, no `Math.random`).
2. **Break.** Seat 0 breaks, cue ball anywhere behind the head string. It is legal if a
   ball is pocketed or at least four object balls reach a cushion; otherwise it is an
   `illegal-break` foul. The first ball hit must be the 1 like any other shot.
3. **Lowest ball first.** On every shot the first ball the cue ball touches must be the
   lowest-numbered ball still on the table, else `wrong-ball`. No other foul is special:
   `scratch`, `no-contact`, `no-cushion` (after the first contact no ball reached a cushion
   and nothing was pocketed) and `off-table` are as in 8-ball.
4. **Turn.** After a foul-free shot that pockets **any** ball (any number, in any pocket)
   the same player shoots again. A foul-free shot that pockets nothing passes the turn.
   Pocketed balls stay down.
5. **Winning.** Pocketing the 9 on a **foul-free** shot wins, including a combination (the
   lowest ball driving the 9 in) and on the break. The reason is `nine-pocketed`.
6. **9 on a foul.** A 9 pocketed (or knocked off the table) on a shot with any foul is
   **spotted** on the foot spot (nearest free point if that is taken) and play goes on.
7. **Ball in hand anywhere.** After any foul the opponent has the cue ball in hand
   anywhere on the cloth (including after a scratch on the break).

## 9-ball simplifications (every one of them)

- **No push-out** after the break. A full rulebook lets the player after the break shoot a
  "push" and the opponent choose to take the position or pass; here the shot after the break
  is an ordinary shot.
- **No three-foul rule** (three fouls in a row by one player lose the game). Not tracked.
- **Ball in hand is anywhere after a scratch on the break** as well (full rules: behind the
  head string).
- **A ball driven off the table is spotted** on the foot spot and is a foul (physics all but
  prevents it, as in 8-ball).
- **A shot that pockets the 9 and fouls does not win**, whatever else it did; the 9 is spotted.
- **The break must hit the 1 first** (it always does in practice from behind the head string
  at the apex); there is no separate break-contact rule beyond rule 2.
- **Win on the break** also needs the break to be foul-free: a 9 on the break that comes
  with a scratch is spotted.
- Everything in the 8-ball simplification list about physics (no side spin, no ball-ball
  throw, capture-disc pockets, not measured against real pool) applies unchanged.
