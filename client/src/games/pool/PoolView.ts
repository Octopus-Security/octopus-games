// Canvas renderer and input for the pool engine in shared/pool. It knows nothing
// about who is playing: it draws a PoolViewState, turns drags into moves and hands
// them to onMove, and plays back state.lastShot's tracks when a new shot arrives.
// The same class serves the practice page (both seats on one device) and, later,
// the multiplayer table (localSeat = your seat).

import {
  W, H, R, POCKETS, HEAD_X, FOOT_X, aimGuide, cuePlacementProblem,
  type PoolView as PoolViewState, type PoolMove,
} from '../../../../shared/pool/index.js';

export type { PoolViewState, PoolMove };

const RAIL = 78; // wooden rail thickness, table units
const MAX_PULL = 560; // drag distance for full power, table units
const MIN_PULL = 70; // drags shorter than this cancel the shot
const POCKET_TAP = 120; // how close to a pocket a tap must be to call it

export const BALL_COLORS = [
  '#f4f1e8', '#f2c230', '#2458c9', '#d13a2f', '#6b3a99',
  '#ee7d22', '#23874f', '#862a35', '#17181c',
];
export function ballColor(id: number): string {
  return BALL_COLORS[id <= 8 ? id : id - 8];
}

export interface PoolBoardOptions {
  /** Which seat this device plays; null = both seats (hot seat). */
  localSeat: number | null;
  onMove: (move: PoolMove) => void;
  onNotice?: (text: string) => void;
  /** Follow/draw from -1 to +1, read when a shot is released. */
  getSpin?: () => number;
}

type Mode = 'idle' | 'aim' | 'dragcue' | 'tapcall';

interface Anim { tracks: (number[] | null)[]; count: number; dt: number; start: number }

export class PoolBoard {
  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: PoolBoardOptions;
  private view: PoolViewState | null = null;
  private seenShots = -1;
  private anim: Anim | null = null;
  private raf = 0;
  private ro: ResizeObserver;
  private vertical = false;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  private mode: Mode = 'idle';
  private pointerId = -1;
  private aimAngle = 0;
  private aimPower = 0;
  private dragCue: [number, number] | null = null;
  private tapPocket = -1;
  private pulse = 0;

  constructor(host: HTMLElement, opts: PoolBoardOptions) {
    this.host = host;
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.remove();
  }

  /** Give the board a new state. A shot newer than the last seen one is played back. */
  setView(v: PoolViewState, animate = true): void {
    const isNewShot = this.seenShots >= 0 && v.shots > this.seenShots && !!v.lastShot && animate;
    this.view = v;
    this.seenShots = v.shots;
    this.mode = 'idle';
    this.dragCue = null;
    this.aimPower = 0;
    if (isNewShot && v.lastShot && v.lastShot.frameCount > 1) {
      this.anim = { tracks: v.lastShot.tracks, count: v.lastShot.frameCount, dt: v.lastShot.frameDt, start: performance.now() };
    } else {
      this.anim = null;
    }
  }

  isAnimating(): boolean {
    return this.anim !== null;
  }

  // ------------------------------------------------------------ layout

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssW = Math.max(1, this.host.clientWidth);
    this.cssH = Math.max(1, this.host.clientHeight);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.vertical = this.cssW < this.cssH;
    const tw = W + 2 * RAIL, th = H + 2 * RAIL;
    const sw = this.vertical ? th : tw, sh = this.vertical ? tw : th;
    const gutter = this.cssW > 400 ? 8 : 4;
    this.scale = Math.min((this.cssW - gutter * 2) / sw, (this.cssH - gutter * 2) / sh);
    this.ox = (this.cssW - sw * this.scale) / 2;
    this.oy = (this.cssH - sh * this.scale) / 2;
  }

  private fromScreen(px: number, py: number): [number, number] {
    const s = this.scale;
    return this.vertical
      ? [W + RAIL - (py - this.oy) / s, (px - this.ox) / s - RAIL]
      : [(px - this.ox) / s - RAIL, (py - this.oy) / s - RAIL];
  }

  private applyTransform(): void {
    const s = this.scale * this.dpr;
    const d = this.dpr;
    if (this.vertical) {
      this.ctx.setTransform(0, -s, s, 0, (this.ox + RAIL * this.scale) * d, (this.oy + (W + RAIL) * this.scale) * d);
    } else {
      this.ctx.setTransform(s, 0, 0, s, (this.ox + RAIL * this.scale) * d, (this.oy + RAIL * this.scale) * d);
    }
  }

  // ------------------------------------------------------------ input

  private canShoot(): boolean {
    const v = this.view;
    if (!v || v.over || this.anim) return false;
    if (this.opts.localSeat !== null && this.opts.localSeat !== v.turn) return false;
    return !!v.balls[0];
  }

  private pointerTable(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return this.fromScreen(e.clientX - r.left, e.clientY - r.top);
  }

  private onDown = (e: PointerEvent): void => {
    if (this.anim) {
      this.anim = null; // tap to skip the playback
      return;
    }
    const v = this.view;
    if (!v || !this.canShoot() || this.mode !== 'idle') return;
    e.preventDefault();
    const [x, y] = this.pointerTable(e);
    const cue = v.balls[0]!;
    this.pointerId = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }

    if (v.mustCall) {
      const p = this.nearestPocket(x, y);
      if (p >= 0) { this.mode = 'tapcall'; this.tapPocket = p; return; }
    }
    const dCue = Math.hypot(x - cue[0], y - cue[1]);
    if (v.inHand && dCue < 2.2 * R) {
      this.mode = 'dragcue';
      this.dragCue = [cue[0], cue[1]];
      return;
    }
    this.mode = 'aim';
    this.updateAim(x, y);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId || this.mode === 'idle') return;
    const [x, y] = this.pointerTable(e);
    const v = this.view!;
    if (this.mode === 'aim') this.updateAim(x, y);
    else if (this.mode === 'dragcue') {
      const cx = Math.min(W - R, Math.max(R, x)), cy = Math.min(H - R, Math.max(R, y));
      if (!cuePlacementProblem(v.balls, cx, cy, !!v.inHand?.kitchen)) this.dragCue = [cx, cy];
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const mode = this.mode;
    const v = this.view;
    this.mode = 'idle';
    this.pointerId = -1;
    if (!v) return;
    const [x, y] = this.pointerTable(e);
    if (mode === 'tapcall') {
      if (this.nearestPocket(x, y) === this.tapPocket) this.opts.onMove({ callPocket: this.tapPocket });
    } else if (mode === 'dragcue' && this.dragCue) {
      const [cx, cy] = this.dragCue;
      this.dragCue = null;
      if (Math.hypot(cx - v.balls[0]![0], cy - v.balls[0]![1]) > 1) this.opts.onMove({ placeCue: { x: cx, y: cy } });
    } else if (mode === 'aim') {
      this.updateAim(x, y);
      const power = this.aimPower;
      this.aimPower = 0;
      if (power > 0) {
        if (v.mustCall) {
          this.opts.onNotice?.('Call a pocket for the 8 first: tap one of the six pockets.');
          return;
        }
        this.opts.onMove({ angle: this.aimAngle, power, spinY: this.opts.getSpin ? this.opts.getSpin() : 0 });
      }
    }
  };

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.mode = 'idle';
    this.pointerId = -1;
    this.dragCue = null;
    this.aimPower = 0;
  };

  private updateAim(x: number, y: number): void {
    const cue = this.view!.balls[0]!;
    const dx = cue[0] - x, dy = cue[1] - y;
    const dist = Math.hypot(dx, dy);
    this.aimAngle = Math.atan2(dy, dx); // you pull back; the ball goes the other way
    this.aimPower = dist < MIN_PULL ? 0 : Math.min(1, (dist - MIN_PULL * 0.5) / (MAX_PULL - MIN_PULL * 0.5));
    if (dist >= MIN_PULL && this.aimPower < 0.03) this.aimPower = 0.03;
    this.aimDrawDist = dist;
  }
  private aimDrawDist = 0;

  private nearestPocket(x: number, y: number): number {
    let best = -1, bd = POCKET_TAP;
    for (let i = 0; i < POCKETS.length; i++) {
      const d = Math.hypot(x - POCKETS[i].x, y - POCKETS[i].y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ------------------------------------------------------------ frame loop

  /** Ball positions to draw right now: [x, y, scale] or null for gone. */
  private positions(): ([number, number, number] | null)[] {
    const out: ([number, number, number] | null)[] = [];
    const v = this.view;
    if (!v) return out;
    if (this.anim) {
      const a = this.anim;
      const f = (performance.now() - a.start) / 1000 / a.dt;
      if (f >= a.count - 1) {
        this.anim = null;
      } else {
        const i = Math.floor(f), t = f - i;
        for (let b = 0; b < 16; b++) {
          const tr = a.tracks[b];
          if (!tr) { const p = v.balls[b]; out.push(p ? [p[0], p[1], 1] : null); continue; }
          const x0 = tr[2 * i], y0 = tr[2 * i + 1], x1 = tr[2 * i + 2], y1 = tr[2 * i + 3];
          if (x0 < 0) out.push(null);
          else if (x1 < 0) out.push([x0, y0, 1 - t]);
          else out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1]);
        }
        return out;
      }
    }
    for (let b = 0; b < 16; b++) {
      const p = v.balls[b];
      if (b === 0 && this.dragCue) out.push([this.dragCue[0], this.dragCue[1], 1]);
      else out.push(p ? [p[0], p[1], 1] : null);
    }
    return out;
  }

  private loop = (): void => {
    this.pulse = (performance.now() / 1000) % 2;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  // ------------------------------------------------------------ drawing

  private draw(): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.cssW, this.cssH);
    this.applyTransform();
    this.drawTable(c);
    const v = this.view;
    if (!v) return;
    const pos = this.positions();
    this.drawPocketHints(c, v);
    const showAim = this.mode === 'aim' && this.canShoot() && pos[0];
    if (showAim) this.drawGuide(c, pos);
    for (let i = 1; i < 16; i++) if (pos[i]) this.drawBall(c, i, pos[i]!);
    if (pos[0]) {
      if (v.inHand && !this.anim) this.drawGlow(c, pos[0]![0], pos[0]![1]);
      this.drawBall(c, 0, pos[0]!);
    }
    if (showAim) this.drawCue(c, pos[0]!);
  }

  private drawTable(c: CanvasRenderingContext2D): void {
    const o = RAIL;
    // rails
    const g = c.createLinearGradient(-o, -o, W + o, H + o);
    g.addColorStop(0, '#5a3a22'); g.addColorStop(0.5, '#6e4a2c'); g.addColorStop(1, '#4b3019');
    c.fillStyle = g;
    roundRect(c, -o, -o, W + 2 * o, H + 2 * o, 46);
    c.fill();
    c.strokeStyle = '#2d1c10'; c.lineWidth = 6;
    roundRect(c, -o + 3, -o + 3, W + 2 * o - 6, H + 2 * o - 6, 44);
    c.stroke();
    // cushions + cloth
    c.fillStyle = '#0b4a3c';
    c.fillRect(-24, -24, W + 48, H + 48);
    const cl = c.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W * 0.62);
    cl.addColorStop(0, '#12806a'); cl.addColorStop(1, '#0c5f4e');
    c.fillStyle = cl;
    c.fillRect(0, 0, W, H);
    // pockets (drawn over the cushion edge)
    for (const p of POCKETS) {
      c.fillStyle = '#d9b45a';
      c.beginPath(); c.arc(p.x, p.y, p.r * 0.86 + 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#05080a';
      c.beginPath(); c.arc(p.x, p.y, p.r * 0.86, 0, Math.PI * 2); c.fill();
    }
    // diamonds
    c.fillStyle = '#e8d7a8';
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      for (const y of [-o / 2, H + o / 2]) dot(c, (W / 8) * i, y, 8);
    }
    for (let i = 1; i < 4; i++) {
      if (i === 2) continue;
      for (const x of [-o / 2, W + o / 2]) dot(c, x, (H / 4) * i, 8);
    }
    // head string and spots
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(HEAD_X, 20); c.lineTo(HEAD_X, H - 20); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    dot(c, HEAD_X, H / 2, 6); dot(c, FOOT_X, H / 2, 6);
  }

  private drawPocketHints(c: CanvasRenderingContext2D, v: PoolViewState): void {
    if (v.over) return;
    if (v.mustCall) {
      const a = 0.35 + 0.35 * Math.sin(this.pulse * Math.PI);
      c.strokeStyle = `rgba(255, 226, 120, ${a})`; c.lineWidth = 9;
      for (const p of POCKETS) { c.beginPath(); c.arc(p.x, p.y, p.r * 0.86 + 20, 0, Math.PI * 2); c.stroke(); }
    }
    if (v.called !== null) {
      const p = POCKETS[v.called];
      c.strokeStyle = '#ffe278'; c.lineWidth = 12;
      c.beginPath(); c.arc(p.x, p.y, p.r * 0.86 + 20, 0, Math.PI * 2); c.stroke();
    }
  }

  private drawGlow(c: CanvasRenderingContext2D, x: number, y: number): void {
    const a = 0.25 + 0.2 * Math.sin(this.pulse * Math.PI);
    c.fillStyle = `rgba(255,255,255,${a})`;
    c.beginPath(); c.arc(x, y, R * 1.9, 0, Math.PI * 2); c.fill();
  }

  private drawBall(c: CanvasRenderingContext2D, id: number, p: [number, number, number]): void {
    const [x, y, k] = p;
    const r = R * k;
    if (r <= 0.5) return;
    c.save();
    c.translate(x, y);
    if (this.vertical) c.rotate(Math.PI / 2); // keep numbers upright on the screen
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath(); c.ellipse(r * 0.18, r * 0.28, r, r * 0.95, 0, 0, Math.PI * 2); c.fill();
    c.save();
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
    const col = ballColor(id);
    if (id >= 9) {
      c.fillStyle = '#f4f1e8'; c.fillRect(-r, -r, 2 * r, 2 * r);
      c.fillStyle = col; c.fillRect(-r, -r * 0.55, 2 * r, r * 1.1);
    } else {
      c.fillStyle = col; c.fillRect(-r, -r, 2 * r, 2 * r);
    }
    if (id !== 0) {
      c.fillStyle = '#f4f1e8';
      c.beginPath(); c.arc(0, 0, r * 0.42, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#17181c';
      c.font = `bold ${Math.round(r * 0.62)}px system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(id), 0, r * 0.04);
    }
    const hl = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, -r * 0.1, -r * 0.1, r * 1.1);
    hl.addColorStop(0, 'rgba(255,255,255,0.55)'); hl.addColorStop(0.35, 'rgba(255,255,255,0)');
    hl.addColorStop(1, 'rgba(0,0,0,0.38)');
    c.fillStyle = hl; c.fillRect(-r, -r, 2 * r, 2 * r);
    c.restore();
    c.restore();
  }

  private drawGuide(c: CanvasRenderingContext2D, pos: ([number, number, number] | null)[]): void {
    const v = this.view!;
    if (this.aimPower <= 0 && this.aimDrawDist < 20) return;
    const balls = v.balls.map((b, i) => (pos[i] && i === 0 ? [pos[0]![0], pos[0]![1]] as [number, number] : b));
    const g = aimGuide(balls, this.aimAngle);
    const cx = balls[0]![0], cy = balls[0]![1];
    c.save();
    c.setLineDash([22, 18]);
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(g.point[0], g.point[1]); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 4;
    c.beginPath(); c.arc(g.point[0], g.point[1], R, 0, Math.PI * 2); c.stroke();
    if (g.ball !== null && g.objectDir) {
      const op = balls[g.ball]!;
      c.strokeStyle = 'rgba(255,226,120,0.85)'; c.lineWidth = 5;
      c.beginPath(); c.moveTo(op[0], op[1]); c.lineTo(op[0] + g.objectDir.x * 260, op[1] + g.objectDir.y * 260); c.stroke();
      if (g.cueDir) {
        c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 4;
        c.beginPath(); c.moveTo(g.point[0], g.point[1]);
        c.lineTo(g.point[0] + g.cueDir.x * 150, g.point[1] + g.cueDir.y * 150); c.stroke();
      }
    }
    c.restore();
  }

  private drawCue(c: CanvasRenderingContext2D, cue: [number, number, number]): void {
    const dx = Math.cos(this.aimAngle), dy = Math.sin(this.aimAngle);
    const gap = R + 18 + this.aimPower * 320;
    const len = 1100;
    const x0 = cue[0] - dx * gap, y0 = cue[1] - dy * gap;
    const x1 = x0 - dx * len, y1 = y0 - dy * len;
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 20;
    c.beginPath(); c.moveTo(x0 + 8, y0 + 10); c.lineTo(x1 + 8, y1 + 10); c.stroke();
    const grad = c.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, '#e9d8a6'); grad.addColorStop(0.08, '#c9a26a'); grad.addColorStop(1, '#4a2f1b');
    c.strokeStyle = grad; c.lineWidth = 17;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = '#7fb6d8'; c.lineWidth = 17;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 - dx * 18, y0 - dy * 18); c.stroke();
    c.restore();
    // power bar beside the cue ball
    const bx = cue[0] - dx * (gap + 140), by = cue[1] - dy * (gap + 140);
    c.fillStyle = `hsl(${120 - 120 * this.aimPower}, 75%, 55%)`;
    c.beginPath(); c.arc(bx, by, 14 + 22 * this.aimPower, 0, Math.PI * 2); c.fill();
  }
}

function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------------------------------------------------------------- status text

const REASONS: Record<string, string> = {
  'eight-pocketed': 'sank the 8',
  'eight-early': 'the 8 went down too early',
  'eight-wrong-pocket': 'the 8 went in the wrong pocket',
  'eight-scratch': 'scratched on the 8',
  'eight-off-table': 'the 8 left the table',
  'eight-foul': 'fouled while sinking the 8',
};
const FOULS: Record<string, string> = {
  scratch: 'scratch',
  'no-contact': 'no ball hit',
  'wrong-ball': 'wrong ball first',
  'no-cushion': 'no cushion after contact',
  'illegal-break': 'break did not reach four cushions',
  'off-table': 'ball off the table',
};

export function statusText(v: PoolViewState, names: [string, string], localSeat: number | null): string {
  const nm = (s: number) => (localSeat !== null && s === localSeat ? 'You' : names[s]);
  if (v.over) {
    const why = REASONS[v.reason ?? ''] ?? v.reason ?? '';
    return `${nm(v.winner ?? 0)} won: ${why}.`;
  }
  const t = v.turn ?? 0;
  const foul = v.lastShot && v.lastShot.fouls.length
    ? `Foul (${v.lastShot.fouls.map((f) => FOULS[f] ?? f).join(', ')}). ` : '';
  const who = localSeat !== null && t !== localSeat ? `${names[t]} to shoot` : `${nm(t)}${nm(t) === 'You' ? ' to shoot' : ', your shot'}`;
  const tgt = v.targets[t];
  const group = tgt === 'open' ? 'open table' : tgt === 'eight' ? 'shoot the 8' : `${tgt}s`;
  let hint = 'Drag back from anywhere to aim, release to shoot.';
  if (v.mustCall) hint = 'Tap a pocket to call it for the 8.';
  else if (v.inHand) hint = 'Ball in hand: drag the cue ball to move it, or aim as usual.';
  return `${foul}${who} (${group}). ${hint}`;
}
