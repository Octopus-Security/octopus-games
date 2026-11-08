// Local play for chess and pool: "Pass and play" (two people, one device) and
// "vs Computer". Everything runs in this browser: the same shared engines the
// server uses (initialState, applyMove, view, status) decide every rule, no server
// state is kept and no account is needed. The only thing stored is the game in
// progress, in localStorage, so a reload can offer to resume it.
import chessEngine from '../../../shared/chess/index.js';
import * as Pool from '../../../shared/pool/index.js';
import type { PoolMove } from '../games/pool/PoolView';
import { h, button, BTN_PRIMARY } from './dom';
import { createGameScreen, type GameScreen } from './gameScreen';
import { renderChess } from './chess';
import { mountPool, type PoolPanel } from './poolUi';
import { BotHost, LEVEL_NAMES, type Level } from './bots';
import type { MatchState } from './api';
import { setGameIcon, resetGameIcon } from '../gameIcons';

export type LocalGame = 'chess' | 'pool';
export type LocalMode = 'pass' | 'cpu';
export type Variant = '8ball' | '9ball';

export interface LocalConfig {
  game: LocalGame;
  mode: LocalMode;
  level: Level;
  variant: Variant;
  /** Which seat the person plays against the computer (chess: 0 white, 1 black; pool: 0 breaks). */
  humanSeat: 0 | 1;
}

export interface SavedLocal { v: 1; cfg: LocalConfig; state: any }

export const CLOSED_EVENT = 'octopus-local-closed';
const saveKey = (g: LocalGame): string => `octopus_local_${g}_v1`;
const PREFS_KEY = 'octopus_local_prefs_v1';

export function loadSaved(game: LocalGame): SavedLocal | null {
  try {
    const raw = localStorage.getItem(saveKey(game));
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedLocal;
    if (s && s.v === 1 && s.cfg && s.cfg.game === game && s.state) return s;
  } catch { /* storage blocked or corrupt */ }
  return null;
}
function save(cfg: LocalConfig, state: unknown): void {
  try { localStorage.setItem(saveKey(cfg.game), JSON.stringify({ v: 1, cfg, state } satisfies SavedLocal)); } catch { /* ignore */ }
}
export function clearSaved(game: LocalGame): void {
  try { localStorage.removeItem(saveKey(game)); } catch { /* ignore */ }
}
function loadPrefs(): { flip: boolean } {
  try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); return { flip: p.flip !== false }; } catch { return { flip: true }; }
}
function savePrefs(p: { flip: boolean }): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function describeSaved(s: SavedLocal): string {
  const mode = s.cfg.mode === 'pass' ? 'pass and play' : `vs Computer (${LEVEL_NAMES[s.cfg.level]})`;
  const v = s.cfg.game === 'pool' ? `${s.cfg.variant === '9ball' ? '9-ball' : '8-ball'}, ` : '';
  return `${v}${mode}`;
}

const randomSeed = (): string => { let s = ''; for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16); return s; };
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

// ── the full-screen shell ─────────────────────────────────────────────────────
interface Shell {
  screen: GameScreen;
  wrapper: HTMLElement;
  stage: HTMLElement;
  handover(title: string, sub: string, onReady: () => void): void;
  dismissHandover(): void;
  restoreHub(): void;
  flipBtn: HTMLButtonElement | null;
  newBtn: HTMLButtonElement;
  backBtn: HTMLButtonElement;
}

function buildShell(kind: 'chess' | 'pool', title: string, badge: string, withFlip: boolean): Shell {
  const backBtn = h('button', 'g-btn g-btn-ghost', h('span', '', '←'), h('span', '', 'Back')) as HTMLButtonElement;
  backBtn.type = 'button'; backBtn.id = 'localBack';
  backBtn.setAttribute('aria-label', 'Back to all games');
  const newBtn = h('button', 'g-btn', h('span', '', 'New', h('span', 'g-long', ' game'))) as HTMLButtonElement;
  newBtn.type = 'button'; newBtn.id = 'localNew';
  let flipBtn: HTMLButtonElement | null = null;
  const actions: HTMLElement[] = [];
  if (withFlip) {
    flipBtn = h('button', 'g-btn') as HTMLButtonElement;
    flipBtn.type = 'button'; flipBtn.id = 'localFlip';
    actions.push(flipBtn);
  }
  actions.push(newBtn);
  const screen = createGameScreen({ kind, title, badge, back: backBtn, actions, fixed: true });
  const wrapper = screen.el;
  wrapper.id = 'localGame';
  // The hub stays mounted underneath; hide it so the page has nothing of its own to scroll.
  const hub = document.getElementById('app');
  const hubDisplay = hub ? hub.style.display : '';
  if (hub) hub.style.display = 'none';
  const stage = screen.stage;
  document.body.appendChild(wrapper);

  let overlay: HTMLElement | null = null;
  const shell: Shell = {
    screen, wrapper, stage, flipBtn, newBtn, backBtn,
    restoreHub() { if (hub) hub.style.display = hubDisplay; },
    dismissHandover() { overlay?.remove(); overlay = null; },
    handover(t, sub, onReady) {
      shell.dismissHandover();
      const card = h('div', 'flex flex-col items-center gap-4 text-center px-6',
        h('div', 'text-4xl font-extrabold', t), h('div', 'text-lg text-gray-300', sub),
        button('Ready, show the board', BTN_PRIMARY, () => { shell.dismissHandover(); onReady(); }));
      overlay = h('div', 'g-overlay');
      overlay.id = 'handover';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', t);
      overlay.append(card);
      stage.append(overlay);
      (overlay.querySelector('button') as HTMLButtonElement | null)?.focus();
    },
  };
  return shell;
}

interface Running { destroy(): void; restart(): void }

// ── chess ─────────────────────────────────────────────────────────────────────
function runChess(cfg: LocalConfig, saved: SavedLocal | null, shell: Shell): Running {
  const pass = cfg.mode === 'pass';
  const lvl = LEVEL_NAMES[cfg.level];
  const names: [string, string] = pass ? ['Player 1 (White)', 'Player 2 (Black)']
    : cfg.humanSeat === 0 ? ['You', `Computer (${lvl})`] : [`Computer (${lvl})`, 'You'];
  const botSeat = pass ? -1 : 1 - cfg.humanSeat;
  const bots = new BotHost();
  const prefs = loadPrefs();
  let state = saved?.state ?? chessEngine.initialState();
  let gen = 0;
  let thinking = false;

  const flipText = (): string => (prefs.flip ? 'Board: flips' : 'Board: fixed');
  if (shell.flipBtn) {
    shell.flipBtn.textContent = flipText();
    shell.flipBtn.setAttribute('aria-pressed', String(prefs.flip));
    shell.flipBtn.addEventListener('click', () => { prefs.flip = !prefs.flip; savePrefs(prefs); shell.flipBtn!.textContent = flipText(); shell.flipBtn!.setAttribute('aria-pressed', String(prefs.flip)); draw(); });
  }

  function draw(): void {
    const st = chessEngine.status(state);
    const seat = pass ? (state.turn as 0 | 1) : cfg.humanSeat;
    const view = chessEngine.view(state, seat);
    const match: MatchState = {
      id: 'local', type: 'chess', status: st.over ? 'finished' : 'active', version: state.history.length, createdBy: '',
      seats: [{ name: names[0], kind: 'user', joined: true }, { name: names[1], kind: 'user', joined: true }],
      you: { seat, role: 'player', kind: 'user', creator: true },
      game: { turn: st.turn as 0 | 1 | null, over: st.over, winner: st.winner as 0 | 1 | null, reason: st.reason },
      view,
    };
    renderChess(shell.screen, { match, send, local: true, pass, flip: pass && !prefs.flip ? false : undefined, cpuSeat: botSeat >= 0 ? botSeat : undefined, thinking: !st.over && thinking });
    if (st.over) clearSaved('chess'); else save(cfg, state);
  }

  async function send(move: Record<string, unknown>): Promise<string | null> {
    if (thinking) return 'Wait for the computer to move.';
    try {
      state = chessEngine.applyMove(state, move as any, pass ? state.turn : cfg.humanSeat).state;
    } catch (e) { return (e as Error).message; }
    afterMove();
    return null;
  }

  function afterMove(): void {
    draw();
    const st = chessEngine.status(state);
    if (st.over) return;
    if (pass) {
      const t = state.turn as 0 | 1;
      shell.handover(`${names[t].split(' (')[0]}'s turn`, `${t === 0 ? 'White' : 'Black'} to move. Pass the device.`, () => { /* board is already current */ });
    } else if (state.turn === botSeat) void botTurn();
  }

  async function botTurn(): Promise<void> {
    const my = ++gen;
    thinking = true;
    draw();
    let mv: { from: string; to: string; promotion?: string } | null = null;
    try { mv = await bots.chess(state.fen, cfg.level); } catch { mv = null; }
    if (my !== gen) return;
    thinking = false;
    const legal: { from: string; to: string; promotion?: string }[] = chessEngine.view(state, state.turn).legalMoves;
    // The engine has the last word: a move it refuses is replaced by a legal one.
    const ok = mv && legal.some(l => l.from === mv!.from && l.to === mv!.to && (l.promotion || '') === (mv!.promotion || ''));
    const pick = ok ? mv! : legal[0];
    if (pick) {
      try { state = chessEngine.applyMove(state, { from: pick.from, to: pick.to, ...(pick.promotion ? { promotion: pick.promotion } : {}) }, state.turn).state; } catch { /* nothing else to do */ }
    }
    draw();
  }

  // start
  if (saved && pass && !chessEngine.status(state).over) {
    draw();
    shell.handover(`${names[state.turn].split(' (')[0]}'s turn`, `Game resumed. ${state.turn === 0 ? 'White' : 'Black'} to move.`, () => {});
  } else {
    draw();
    if (!pass && state.turn === botSeat && !chessEngine.status(state).over) void botTurn();
  }

  return {
    destroy() { gen++; bots.destroy(); },
    restart() {
      gen++;
      thinking = false;
      shell.dismissHandover();
      state = chessEngine.initialState();
      clearSaved('chess');
      draw();
      if (!pass && state.turn === botSeat) void botTurn();
    },
  };
}

// ── pool ──────────────────────────────────────────────────────────────────────
function runPool(cfg: LocalConfig, saved: SavedLocal | null, shell: Shell): Running {
  const pass = cfg.mode === 'pass';
  const lvl = LEVEL_NAMES[cfg.level];
  const names: [string, string] = pass ? ['Player 1', 'Player 2']
    : cfg.humanSeat === 0 ? ['You', `Computer (${lvl})`] : [`Computer (${lvl})`, 'You'];
  const botSeat = pass ? -1 : 1 - cfg.humanSeat;
  const bots = new BotHost();
  let state: Pool.PoolState = saved?.state ?? Pool.initialState(randomSeed(), { variant: cfg.variant });
  let gen = 0;
  let thinking = false;
  let holding = false; // pass and play: a handover card is up and the board is not for use yet

  const panel: PoolPanel = mountPool(shell.screen, {
    names,
    localSeat: pass ? null : cfg.humanSeat,
    cpuSeat: pass ? undefined : botSeat,
    thinking: () => thinking,
    onMove: (m) => { if (!thinking && !holding) void play(m); },
  });

  function persist(): void { if (state.over) clearSaved('pool'); else save(cfg, state); }
  function setView(animate: boolean): void { persist(); panel.setView(Pool.view(state, null), animate); }

  function apply(move: PoolMove): boolean {
    try {
      state = Pool.applyMove(state, move, state.turn).state;
      return true;
    } catch (e) {
      if ((e as Error).name === 'IllegalMove') panel.setNotice((e as Error).message); else throw e;
      return false;
    }
  }

  async function animationDone(): Promise<void> {
    for (let i = 0; i < 300 && panel.isAnimating(); i++) await sleep(50);
  }

  async function play(move: PoolMove): Promise<void> {
    const shots = state.shots;
    if (!apply(move)) return;
    setView(true);
    if (state.shots !== shots) await settle();
  }

  /** After a shot has been played back: whose move is it, and who needs to look at the screen. */
  async function settle(): Promise<void> {
    const my = gen;
    await animationDone();
    if (my !== gen || state.over) return;
    if (!pass && state.turn === botSeat) { void botTurn(); return; }
    if (pass && state.turn !== lastHolder) showHandover();
  }

  let lastHolder = saved ? -1 : 0;
  function showHandover(): void {
    holding = true;
    const t = state.turn;
    const foul = state.lastShot && state.lastShot.fouls.length ? 'Foul, so ball in hand. ' : '';
    shell.handover(`${names[t]}'s turn`, `${foul}Pass the device to ${names[t]}.`, () => { holding = false; lastHolder = t; panel.refresh(); });
  }

  async function botTurn(): Promise<void> {
    const my = ++gen;
    thinking = true;
    panel.refresh();
    let res: { moves: PoolMove[] } | null = null;
    try { res = await bots.pool(state, cfg.level); } catch { res = null; }
    if (my !== gen) return;
    thinking = false;
    const moves: PoolMove[] = res ? res.moves : [];
    let shot = false;
    for (const mv of moves) {
      if (!apply(mv)) break;
      shot = 'angle' in mv;
      setView(true);
      if (!shot) await sleep(350);
    }
    if (!shot && !state.over) {
      // Last resort: the engine refused the plan, so play a gentle shot toward any legal ball.
      const cue = state.balls[0];
      const t = state.balls.find((b, i) => i > 0 && b);
      if (cue && t && apply({ angle: Math.atan2(t[1] - cue[1], t[0] - cue[0]), power: 0.35 })) { shot = true; setView(true); }
    }
    panel.refresh();
    if (shot) await settle();
  }

  if (saved && !state.over) {
    setView(false);
    if (pass) showHandover();
    else if (state.turn === botSeat) void botTurn();
  } else {
    setView(false);
    if (!pass && state.turn === botSeat) void botTurn();
  }

  return {
    destroy() { gen++; bots.destroy(); panel.destroy(); },
    restart() {
      gen++;
      thinking = false;
      holding = false;
      lastHolder = 0;
      shell.dismissHandover();
      state = Pool.initialState(randomSeed(), { variant: cfg.variant });
      clearSaved('pool');
      setView(false);
      if (!pass && state.turn === botSeat) void botTurn();
    },
  };
}

// ── entry point ───────────────────────────────────────────────────────────────
export function launchLocal(cfg: LocalConfig, saved: SavedLocal | null = null): void {
  const gameName = cfg.game === 'chess' ? 'Chess' : cfg.variant === '9ball' ? '9-ball' : '8-ball';
  const modeName = cfg.mode === 'pass' ? 'Pass and play' : `vs Computer (${LEVEL_NAMES[cfg.level]})`;
  const shell = buildShell(cfg.game, `${cfg.game === 'chess' ? '♞' : '🎱'} ${gameName}`, modeName, cfg.game === 'chess' && cfg.mode === 'pass');
  document.title = `${gameName} · Octopus Games`;
  setGameIcon(cfg.game);
  const running = cfg.game === 'chess' ? runChess(cfg, saved, shell) : runPool(cfg, saved, shell);
  shell.newBtn.addEventListener('click', () => running.restart());
  shell.backBtn.addEventListener('click', () => {
    running.destroy();
    shell.wrapper.remove();
    shell.restoreHub();
    resetGameIcon();
    window.dispatchEvent(new Event(CLOSED_EVENT));
  });
}
