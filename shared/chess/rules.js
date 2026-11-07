// Chess rules, no dependencies. Board squares are indexed 0..63 in FEN order:
// 0 = a8, 7 = h8, 56 = a1, 63 = h1. A piece is one character, uppercase for
// white and lowercase for black; an empty square is ''.
// This file is the position machinery (parse, generate, make/undo, SAN). The
// game-type plugin that the server loads lives in ./index.js.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const KING = [...DIAG, ...ORTH];

const isWhite = p => p >= 'A' && p <= 'Z';
const colorOf = p => (isWhite(p) ? 'w' : 'b');
const inBoard = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;

export const sqName = i => 'abcdefgh'[i & 7] + (8 - (i >> 3));
export function sqIndex(name) {
  if (typeof name !== 'string' || !/^[a-h][1-8]$/.test(name)) return -1;
  return (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);
}

// Which castling rights a move touching this square can destroy.
const RIGHTS_LOST = { 0: 'q', 7: 'k', 56: 'Q', 63: 'K', 4: 'kq', 60: 'KQ' };

export function parseFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 4) throw new Error('bad FEN');
  const rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error('bad FEN board');
  const b = [];
  for (const row of rows) {
    let n = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) { for (let k = 0; k < Number(ch); k++) b.push(''); n += Number(ch); }
      else if (/[pnbrqkPNBRQK]/.test(ch)) { b.push(ch); n++; }
      else throw new Error('bad FEN piece');
    }
    if (n !== 8) throw new Error('bad FEN row');
  }
  const turn = parts[1] === 'b' ? 'b' : 'w';
  const castle = parts[2] === '-' ? '' : parts[2].replace(/[^KQkq]/g, '');
  const ep = parts[3] === '-' ? -1 : sqIndex(parts[3]);
  return { b, turn, castle, ep, half: Number(parts[4] || 0) || 0, full: Number(parts[5] || 1) || 1 };
}

const CASTLE_ORDER = 'KQkq';
function castleStr(pos) {
  const s = [...CASTLE_ORDER].filter(c => pos.castle.includes(c)).join('');
  return s || '-';
}

// En passant square, but only when a pawn of the side to move could actually
// take there legally. Used for FEN output and for repetition keys.
function effectiveEp(pos) {
  if (pos.ep < 0) return -1;
  return legalMoves(pos).some(m => m.flag === 'ep') ? pos.ep : -1;
}

export function toFen(pos) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let s = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.b[r * 8 + f];
      if (!p) empty++; else { if (empty) { s += empty; empty = 0; } s += p; }
    }
    if (empty) s += empty;
    rows.push(s);
  }
  const ep = effectiveEp(pos);
  return `${rows.join('/')} ${pos.turn} ${castleStr(pos)} ${ep < 0 ? '-' : sqName(ep)} ${pos.half} ${pos.full}`;
}

/** First four FEN fields: what makes two positions "the same" for repetition. */
export function positionKey(pos) {
  return toFen(pos).split(' ').slice(0, 4).join(' ');
}

export function isAttacked(pos, sq, by) {
  const b = pos.b;
  const r = sq >> 3, f = sq & 7;
  // pawns: a white pawn attacks toward row-1, so it sits one row below (r+1)
  const pr = by === 'w' ? r + 1 : r - 1;
  const pawn = by === 'w' ? 'P' : 'p';
  for (const df of [-1, 1]) if (inBoard(pr, f + df) && b[pr * 8 + f + df] === pawn) return true;
  const knight = by === 'w' ? 'N' : 'n';
  for (const [dr, df] of KNIGHT) if (inBoard(r + dr, f + df) && b[(r + dr) * 8 + f + df] === knight) return true;
  const king = by === 'w' ? 'K' : 'k';
  for (const [dr, df] of KING) if (inBoard(r + dr, f + df) && b[(r + dr) * 8 + f + df] === king) return true;
  const bishop = by === 'w' ? 'B' : 'b', rook = by === 'w' ? 'R' : 'r', queen = by === 'w' ? 'Q' : 'q';
  for (const [dr, df] of DIAG) {
    let rr = r + dr, ff = f + df;
    while (inBoard(rr, ff)) {
      const p = b[rr * 8 + ff];
      if (p) { if (p === bishop || p === queen) return true; break; }
      rr += dr; ff += df;
    }
  }
  for (const [dr, df] of ORTH) {
    let rr = r + dr, ff = f + df;
    while (inBoard(rr, ff)) {
      const p = b[rr * 8 + ff];
      if (p) { if (p === rook || p === queen) return true; break; }
      rr += dr; ff += df;
    }
  }
  return false;
}

const other = c => (c === 'w' ? 'b' : 'w');

export function kingSquare(pos, color) {
  const k = color === 'w' ? 'K' : 'k';
  return pos.b.indexOf(k);
}

export function inCheck(pos, color = pos.turn) {
  const k = kingSquare(pos, color);
  return k >= 0 && isAttacked(pos, k, other(color));
}

function pseudoMoves(pos) {
  const out = [];
  const b = pos.b, us = pos.turn, white = us === 'w';
  const push = (from, to, flag, promoRow) => {
    if (promoRow) for (const promo of ['q', 'r', 'b', 'n']) out.push({ from, to, promo, flag });
    else out.push({ from, to, promo: '', flag });
  };
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== us) continue;
    const r = i >> 3, f = i & 7;
    const t = p.toLowerCase();
    if (t === 'p') {
      const dir = white ? -1 : 1, startRow = white ? 6 : 1, promoRow = white ? 0 : 7;
      const one = i + dir * 8;
      if (!b[one]) {
        push(i, one, '', r + dir === promoRow);
        if (r === startRow && !b[i + dir * 16]) push(i, i + dir * 16, 'dbl', false);
      }
      for (const df of [-1, 1]) {
        if (!inBoard(r + dir, f + df)) continue;
        const to = (r + dir) * 8 + f + df;
        if (b[to] && colorOf(b[to]) !== us) push(i, to, '', r + dir === promoRow);
        else if (!b[to] && to === pos.ep) push(i, to, 'ep', false);
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of t === 'n' ? KNIGHT : KING) {
        if (!inBoard(r + dr, f + df)) continue;
        const to = (r + dr) * 8 + f + df;
        if (!b[to] || colorOf(b[to]) !== us) push(i, to, '', false);
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : KING;
      for (const [dr, df] of dirs) {
        let rr = r + dr, ff = f + df;
        while (inBoard(rr, ff)) {
          const to = rr * 8 + ff;
          if (!b[to]) push(i, to, '', false);
          else { if (colorOf(b[to]) !== us) push(i, to, '', false); break; }
          rr += dr; ff += df;
        }
      }
    }
  }
  // Castling: rights, empty path, a rook at home, king not in / through / into check.
  const them = other(us);
  if (white && b[60] === 'K' && !isAttacked(pos, 60, them)) {
    if (pos.castle.includes('K') && b[63] === 'R' && !b[61] && !b[62] && !isAttacked(pos, 61, them) && !isAttacked(pos, 62, them)) out.push({ from: 60, to: 62, promo: '', flag: 'castleK' });
    if (pos.castle.includes('Q') && b[56] === 'R' && !b[59] && !b[58] && !b[57] && !isAttacked(pos, 59, them) && !isAttacked(pos, 58, them)) out.push({ from: 60, to: 58, promo: '', flag: 'castleQ' });
  }
  if (!white && b[4] === 'k' && !isAttacked(pos, 4, them)) {
    if (pos.castle.includes('k') && b[7] === 'r' && !b[5] && !b[6] && !isAttacked(pos, 5, them) && !isAttacked(pos, 6, them)) out.push({ from: 4, to: 6, promo: '', flag: 'castleK' });
    if (pos.castle.includes('q') && b[0] === 'r' && !b[3] && !b[2] && !b[1] && !isAttacked(pos, 3, them) && !isAttacked(pos, 2, them)) out.push({ from: 4, to: 2, promo: '', flag: 'castleQ' });
  }
  return out;
}

export function make(pos, m) {
  const b = pos.b, us = pos.turn;
  const u = { castle: pos.castle, ep: pos.ep, half: pos.half, full: pos.full, cap: '', capSq: m.to, moved: b[m.from] };
  if (m.flag === 'ep') { u.capSq = m.to + (us === 'w' ? 8 : -8); u.cap = b[u.capSq]; b[u.capSq] = ''; }
  else u.cap = b[m.to];
  b[m.to] = m.promo ? (us === 'w' ? m.promo.toUpperCase() : m.promo) : u.moved;
  b[m.from] = '';
  if (m.flag === 'castleK') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = ''; }
  else if (m.flag === 'castleQ') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = ''; }
  let castle = pos.castle;
  for (const sq of [m.from, m.to]) {
    const lost = RIGHTS_LOST[sq];
    if (lost) for (const c of lost) castle = castle.replace(c, '');
  }
  pos.castle = castle;
  pos.ep = m.flag === 'dbl' ? (m.from + m.to) >> 1 : -1;
  pos.half = (u.moved.toLowerCase() === 'p' || u.cap) ? 0 : pos.half + 1;
  if (us === 'b') pos.full++;
  pos.turn = other(us);
  return u;
}

export function undo(pos, m, u) {
  const b = pos.b;
  pos.turn = other(pos.turn);
  const us = pos.turn;
  b[m.from] = u.moved;
  b[m.to] = '';
  if (m.flag === 'ep') b[u.capSq] = u.cap; else b[m.to] = u.cap;
  if (m.flag === 'castleK') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = ''; }
  else if (m.flag === 'castleQ') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = ''; }
  pos.castle = u.castle; pos.ep = u.ep; pos.half = u.half; pos.full = u.full;
  void us;
}

export function legalMoves(pos) {
  const us = pos.turn;
  const out = [];
  for (const m of pseudoMoves(pos)) {
    const u = make(pos, m);
    const ks = kingSquare(pos, us);
    const ok = ks >= 0 && !isAttacked(pos, ks, pos.turn);
    undo(pos, m, u);
    if (ok) out.push(m);
  }
  return out;
}

export function perft(pos, depth) {
  const moves = legalMoves(pos);
  if (depth <= 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const u = make(pos, m);
    n += perft(pos, depth - 1);
    undo(pos, m, u);
  }
  return n;
}

/** Standard algebraic notation for legal move `m` in `pos` (pos is restored). */
export function toSan(pos, m, legal = legalMoves(pos)) {
  const piece = pos.b[m.from];
  const t = piece.toLowerCase();
  let san;
  if (m.flag === 'castleK') san = 'O-O';
  else if (m.flag === 'castleQ') san = 'O-O-O';
  else {
    const capture = !!pos.b[m.to] || m.flag === 'ep';
    if (t === 'p') {
      san = (capture ? 'abcdefgh'[m.from & 7] + 'x' : '') + sqName(m.to);
      if (m.promo) san += '=' + m.promo.toUpperCase();
    } else {
      san = t.toUpperCase();
      const rivals = legal.filter(o => o !== m && o.to === m.to && pos.b[o.from] === piece);
      if (rivals.length) {
        const sameFile = rivals.some(o => (o.from & 7) === (m.from & 7));
        const sameRank = rivals.some(o => (o.from >> 3) === (m.from >> 3));
        if (!sameFile) san += 'abcdefgh'[m.from & 7];
        else if (!sameRank) san += 8 - (m.from >> 3);
        else san += sqName(m.from);
      }
      san += (capture ? 'x' : '') + sqName(m.to);
    }
  }
  const u = make(pos, m);
  if (inCheck(pos)) san += legalMoves(pos).length ? '+' : '#';
  undo(pos, m, u);
  return san;
}

/** Insufficient mating material: K v K, K+minor v K, or only same-coloured bishops. */
export function insufficientMaterial(pos) {
  const rest = [];
  pos.b.forEach((p, i) => { if (p && p.toLowerCase() !== 'k') rest.push([p.toLowerCase(), i]); });
  if (!rest.length) return true;
  if (rest.length === 1) return rest[0][0] === 'b' || rest[0][0] === 'n';
  if (rest.every(([t]) => t === 'b')) {
    const shade = i => ((i >> 3) + (i & 7)) & 1;
    return rest.every(([, i]) => shade(i) === shade(rest[0][1]));
  }
  return false;
}
