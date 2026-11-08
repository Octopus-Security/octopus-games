// The pool table, drawn into a game screen (see gameScreen.ts): the turn banner, a panel
// for each player with the balls they have left, the draw/follow control and the table.
// Used by the online match page and by the local (pass and play, vs computer) page, so
// both look and behave the same. It knows nothing about who the players are beyond the
// names it is given.
import { groupOf } from '../../../shared/pool/index.js';
import { powerFromDrag, powerFromHold, isShot } from '../../../shared/pool/aim.js';
import { PoolBoard, ballColor, REASONS, FOULS, type PoolViewState, type PoolMove } from '../games/pool/PoolView';
import { h } from './dom';
import type { Banner, GameScreen, PlayerCard } from './gameScreen';

export interface PoolPanelOpts {
  names: [string, string];
  /** The seat this device plays; null = both (pass and play); -1 = nobody (spectator). */
  localSeat: number | null;
  onMove: (move: PoolMove) => void;
  /** Replaces the banner with a plain waiting message (for example "Waiting for someone to open the invite link"). */
  statusOverride?: () => string | null;
  /** The seat the computer plays, if any. */
  cpuSeat?: number;
  /** True while the computer is working out its shot. */
  thinking?: () => boolean;
  /** One line of how-to under the table (desktop only). */
  hint?: string;
}

export interface PoolPanel {
  /** The element the table is drawn into. */
  el: HTMLElement;
  opts: PoolPanelOpts;
  setView(v: PoolViewState, animate: boolean): void;
  setNotice(text: string): void;
  refresh(): void;
  isAnimating(): boolean;
  destroy(): void;
}

function chip(id: number): HTMLElement {
  const striped = groupOf(id) === 'stripe';
  const c = ballColor(id);
  const bg = striped ? `linear-gradient(#f4f1e8 0 26%, ${c} 26% 74%, #f4f1e8 74%)` : c;
  const el = h('span', 'g-ball');
  el.style.background = bg;
  el.title = `Ball ${id}`;
  return el;
}

const DEFAULT_HINT = 'Touch the table to aim (arrow keys fine-tune), then pull back the power control and let go to shoot. Hold Space to charge.';
const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];

/** What a seat is shooting at, in words. */
function targetWords(v: PoolViewState, seat: number): string {
  if (v.variant === '9ball') return `Lowest ball first: the ${v.lowest}`;
  const t = v.targets[seat];
  if (t === 'open') return 'Open table: hit any ball';
  if (t === 'eight') return 'Shoot the 8-ball';
  if (t === 'solid') return 'Solids (1-7)';
  if (t === 'stripe') return 'Stripes (9-15)';
  return '';
}

export function poolBanner(v: PoolViewState, o: PoolPanelOpts): Banner {
  const nm = (s: number): string => o.names[s];
  const local = o.localSeat;
  const playing = local !== null && local >= 0;
  if (v.over) {
    const w = v.winner ?? 0;
    const why = REASONS[v.reason ?? ''] ?? v.reason ?? '';
    const cap = why ? why[0].toUpperCase() + why.slice(1) : '';
    if (playing) return w === local ? { tone: 'win', icon: '🏆', title: 'You won!', sub: cap }
      : { tone: 'loss', icon: '😞', title: 'You lost', sub: `${nm(w)} won: ${why}` };
    return { tone: 'win', icon: '🏆', title: `${nm(w)} wins!`, sub: cap };
  }
  const t = v.turn ?? 0;
  const goal = targetWords(v, t);
  if (o.cpuSeat === t) {
    return o.thinking?.()
      ? { tone: 'think', icon: '🤖', title: 'Computer is thinking', dots: true, sub: goal }
      : { tone: 'them', icon: '🤖', title: "Computer's turn", sub: goal };
  }
  if (local === null) { // one device, two people
    if (v.mustCall) return { tone: 'you', icon: '🎯', title: `${nm(t)}: call a pocket for the 8`, sub: 'Tap a pocket on the table' };
    if (v.inHand) return { tone: 'you', icon: '✋', title: `${nm(t)}: ball in hand`, sub: `${goal}. Place the cue ball, then shoot.` };
    return { tone: 'you', icon: '🎱', title: `${nm(t)}'s turn`, sub: goal };
  }
  if (local === t) {
    if (v.mustCall) return { tone: 'you', icon: '🎯', title: 'Call a pocket for the 8-ball', sub: 'Tap the pocket you will sink it in' };
    if (v.inHand) return { tone: 'you', icon: '✋', title: 'Ball in hand: place the cue ball', sub: `${goal}. Drag the cue ball, or aim as usual.` };
    return { tone: 'you', icon: '🎱', title: 'Your turn', sub: goal };
  }
  if (local < 0) return { tone: 'them', icon: '👀', title: `${nm(t)}'s turn`, sub: 'You are watching' };
  return { tone: 'wait', icon: '⏳', title: `Waiting for ${nm(t)}`, dots: true, sub: goal };
}

function playerCard(v: PoolViewState, o: PoolPanelOpts, seat: number): PlayerCard {
  const cpu = o.cpuSeat === seat;
  const g = v.groups[seat];
  const active = !v.over && v.turn === seat;
  const extra: HTMLElement[] = [];
  let role: string;
  if (v.variant === '9ball') role = '9-ball';
  else if (!g) role = 'Open table';
  else {
    const ids = (g === 'solid' ? SOLIDS : STRIPES).filter((i) => v.balls[i]);
    role = `${g === 'solid' ? 'Solids' : 'Stripes'} · ${ids.length ? `${ids.length} left` : v.balls[8] ? 'on the 8' : 'done'}`;
    for (const i of ids) extra.push(chip(i));
    if (!ids.length && v.balls[8]) extra.push(chip(8));
  }
  const mine = o.localSeat === seat;
  return {
    name: o.names[seat],
    role,
    disc: cpu ? '🤖' : (o.names[seat].trim()[0] || '?').toUpperCase(),
    active,
    flag: cpu ? (o.thinking?.() ? 'Thinking' : 'Shooting') : mine ? 'Your turn' : 'Shooting',
    extra,
  };
}

export function mountPool(screen: GameScreen, opts: PoolPanelOpts): PoolPanel {
  const host = h('div', '');
  host.style.cssText = 'position:absolute;inset:0;';
  screen.stage.replaceChildren(host);

  // draw / follow, kept big enough to use with a thumb
  let spin = 0;
  const slider = h('input', '') as HTMLInputElement;
  slider.type = 'range'; slider.min = '-1'; slider.max = '1'; slider.step = '0.05'; slider.value = '0';
  slider.id = 'poolSpin';
  slider.setAttribute('aria-label', 'Draw or follow');
  slider.addEventListener('input', () => { spin = Number(slider.value); });
  const spinBox = h('label', 'g-spin', h('span', '', 'Spin'), h('span', '', 'Draw'), slider, h('span', '', 'Follow'));
  const hintEl = h('span', 'g-hint', opts.hint || DEFAULT_HINT);
  const left = h('span', 'g-table-left');
  left.id = 'poolTray';
  // Power: a separate pull-back control, so aiming never needs the pointer to leave the table.
  const fill = h('span', 'g-power-fill');
  const readout = h('span', 'g-power-read', 'Pull back to shoot');
  const power = h('div', 'g-power', fill, readout);
  power.id = 'poolPower';
  power.tabIndex = 0;
  power.setAttribute('role', 'slider');
  power.setAttribute('aria-label', 'Shot power: drag left or down, release to shoot. Hold Space to charge.');
  power.setAttribute('aria-valuemin', '0');
  power.setAttribute('aria-valuemax', '100');
  power.setAttribute('aria-valuenow', '0');
  power.style.touchAction = 'none';
  screen.tools.replaceChildren(spinBox, power, left, hintEl);

  let view: PoolViewState | null = null;
  let toastedShot = -1;
  let idleTimer = 0;

  const board = new PoolBoard(host, {
    localSeat: opts.localSeat,
    getSpin: () => spin,
    onNotice: (t) => panel.setNotice(t),
    onMove: (m) => opts.onMove(m),
  });

  // ---- power control (pointer: touch, mouse, pen) and keyboard
  let powerPointer = -1;
  let startX = 0, startY = 0;
  let spaceFrom = 0, spaceRaf = 0;
  const showPower = (p: number): void => {
    const pct = Math.round(p * 100);
    fill.style.width = `${pct}%`;
    fill.style.background = `hsl(${120 - 120 * p}, 75%, 50%)`;
    power.setAttribute('aria-valuenow', String(pct));
    readout.textContent = p > 0 ? `${pct}%` : 'Pull back to shoot';
    board.setPower(p);
  };
  const endCharge = (shoot: boolean, p: number): void => {
    powerPointer = -1;
    window.cancelAnimationFrame(spaceRaf);
    spaceFrom = 0;
    power.classList.remove('is-active');
    showPower(0);
    if (shoot && isShot(p)) board.fire(p);
  };
  power.addEventListener('pointerdown', (e) => {
    if (powerPointer !== -1 || spaceFrom || !board.canShoot()) return;
    e.preventDefault();
    powerPointer = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    try { power.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    power.classList.add('is-active');
    showPower(0);
  });
  power.addEventListener('pointermove', (e) => {
    if (e.pointerId !== powerPointer) return;
    showPower(powerFromDrag(e.clientX - startX, e.clientY - startY));
  });
  power.addEventListener('pointerup', (e) => {
    if (e.pointerId !== powerPointer) return;
    endCharge(true, powerFromDrag(e.clientX - startX, e.clientY - startY));
  });
  power.addEventListener('pointercancel', (e) => { if (e.pointerId === powerPointer) endCharge(false, 0); });
  power.addEventListener('lostpointercapture', (e) => { if (e.pointerId === powerPointer) endCharge(false, 0); });

  const typing = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || !host.isConnected) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (!board.canShoot()) return;
      e.preventDefault();
      board.nudgeAim(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1, e.shiftKey);
    } else if (e.key === ' ' || e.code === 'Space') {
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON' || !board.canShoot()) return;
      e.preventDefault();
      if (e.repeat || spaceFrom || powerPointer !== -1) return;
      spaceFrom = performance.now();
      power.classList.add('is-active');
      const tick = (): void => {
        if (!spaceFrom) return;
        showPower(powerFromHold(performance.now() - spaceFrom));
        spaceRaf = window.requestAnimationFrame(tick);
      };
      tick();
    } else if (e.key === 'Escape' && (spaceFrom || powerPointer !== -1)) {
      endCharge(false, 0);
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (!spaceFrom || (e.key !== ' ' && e.code !== 'Space')) return;
    e.preventDefault();
    endCharge(true, powerFromHold(performance.now() - spaceFrom));
  };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  function foulToast(v: PoolViewState, animate: boolean): void {
    const ls = v.lastShot;
    if (!ls || !ls.fouls.length || v.shots === toastedShot) return;
    const first = toastedShot === -1;
    toastedShot = v.shots;
    if (first && !animate) return; // resuming or loading a game: the foul is old news
    const who = opts.localSeat === ls.seat ? 'you' : opts.names[ls.seat];
    const text = `Foul by ${who}: ${ls.fouls.map((f) => FOULS[f] ?? f).join(', ')}`;
    let n = 0;
    window.clearInterval(idleTimer);
    idleTimer = window.setInterval(() => { // after the shot has played out
      if (board.isAnimating() && ++n < 200) return;
      window.clearInterval(idleTimer);
      screen.toast(text, 'foul');
    }, 120);
  }

  const panel: PoolPanel = {
    el: host,
    opts,
    setView(v, animate) {
      view = v;
      board.setView(v, animate);
      foulToast(v, animate);
      panel.refresh();
    },
    setNotice(text) { screen.toast(text, 'info'); },
    refresh() {
      if (!view) return;
      board.setLocalSeat(opts.localSeat);
      power.setAttribute('aria-disabled', board.canShoot() ? 'false' : 'true');
      hintEl.textContent = opts.hint || DEFAULT_HINT;
      const wait = opts.statusOverride?.();
      screen.setBanner(wait ? { tone: 'wait', icon: '⏳', title: wait, dots: /^Waiting/.test(wait) } : poolBanner(view, opts));
      const spectator = opts.localSeat === -1;
      const me = opts.localSeat !== null && opts.localSeat >= 0 ? opts.localSeat : 0;
      // you at the bottom; in pass and play, seat 0 at the bottom too
      const bottomSeat = spectator ? 1 : me;
      const topSeat = 1 - bottomSeat;
      screen.setPlayers(playerCard(view, opts, topSeat), playerCard(view, opts, bottomSeat));
      left.replaceChildren();
      if (view.variant === '9ball') {
        left.append('On the table');
        for (let id = 1; id <= 9; id++) if (view.balls[id]) left.append(chip(id));
        left.hidden = false;
      } else left.hidden = true;
    },
    isAnimating: () => board.isAnimating(),
    destroy() {
      window.clearInterval(idleTimer);
      window.cancelAnimationFrame(spaceRaf);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      board.destroy();
    },
  };
  return panel;
}
