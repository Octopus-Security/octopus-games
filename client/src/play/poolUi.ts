// The pool table with its status line, ball tray and draw/follow slider. Used by the
// online match page and by the local (pass and play, vs computer) page, so both look
// and behave the same. It knows nothing about who the players are.
import { groupOf } from '../../../shared/pool/index.js';
import { PoolBoard, statusText, ballColor, type PoolViewState, type PoolMove } from '../games/pool/PoolView';
import { h } from './dom';

export interface PoolPanelOpts {
  names: [string, string];
  /** The seat this device plays; null = both (pass and play); -1 = nobody (spectator). */
  localSeat: number | null;
  onMove: (move: PoolMove) => void;
  /** Overrides the status line (for example "Computer is thinking"). */
  statusOverride?: () => string | null;
}

export interface PoolPanel {
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
  const bg = striped ? `linear-gradient(#f4f1e8 0 28%, ${c} 28% 72%, #f4f1e8 72%)` : c;
  const el = h('span', 'inline-block rounded-full');
  el.style.cssText = `width:14px;height:14px;background:${bg};border:1px solid rgba(255,255,255,.25);`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function mountPool(container: HTMLElement, opts: PoolPanelOpts): PoolPanel {
  const el = h('div', 'flex flex-col w-full h-full bg-gray-950 text-white');
  const info = h('div', 'bg-gray-900 border-b border-gray-800 px-4 py-2');
  const statusEl = h('div', 'text-sm text-gray-200');
  statusEl.style.cssText = 'min-height:2.5em;line-height:1.25;';
  statusEl.id = 'poolStatus';
  statusEl.setAttribute('role', 'status');
  const trayEl = h('div', 'flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-gray-400');
  trayEl.id = 'poolTray';
  let spin = 0;
  const slider = h('input', '') as HTMLInputElement;
  slider.type = 'range'; slider.min = '-1'; slider.max = '1'; slider.step = '0.05'; slider.value = '0';
  slider.id = 'poolSpin';
  slider.style.cssText = 'width:96px;height:44px;';
  slider.setAttribute('aria-label', 'Draw or follow');
  slider.addEventListener('input', () => { spin = Number(slider.value); });
  const spinRow = h('label', 'ml-auto flex items-center gap-2 text-xs text-gray-400', 'Draw', slider, 'Follow');
  info.append(statusEl, h('div', 'flex items-center gap-3 flex-wrap', trayEl, spinRow));
  const host = h('div', '');
  host.style.cssText = 'flex:1 1 auto;min-height:0;position:relative;';
  el.append(info, host);
  container.replaceChildren(el);

  let view: PoolViewState | null = null;
  let notice = '';
  let noticeTimer = 0;

  const board = new PoolBoard(host, {
    localSeat: opts.localSeat,
    getSpin: () => spin,
    onNotice: (t) => panel.setNotice(t),
    onMove: (m) => opts.onMove(m),
  });

  function tray(v: PoolViewState): void {
    trayEl.replaceChildren();
    const turn = v.over ? -1 : v.turn ?? -1;
    if (v.variant === '9ball') {
      const left: number[] = [];
      for (let id = 1; id <= 9; id++) if (v.balls[id]) left.push(id);
      const row = h('span', 'flex items-center gap-1', 'On the table');
      for (const id of left) row.append(chip(id));
      trayEl.append(row);
      return;
    }
    for (const seat of [0, 1]) {
      const g = v.groups[seat];
      const row = h('span', `flex items-center gap-1 ${turn === seat ? 'text-white' : ''}`, opts.names[seat]);
      if (!g) row.append(h('span', '', turn === seat ? 'to play' : ''));
      else {
        const ids = (g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]).filter((i) => v.balls[i]);
        if (!ids.length) row.append(v.balls[8] ? chip(8) : h('span', '', '✓'));
        for (const i of ids) row.append(chip(i));
      }
      trayEl.append(row);
    }
  }

  const panel: PoolPanel = {
    el,
    opts,
    setView(v, animate) {
      view = v;
      board.setView(v, animate);
      panel.refresh();
    },
    setNotice(text) {
      notice = text;
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => { notice = ''; panel.refresh(); }, 4000);
      panel.refresh();
    },
    refresh() {
      if (!view) return;
      board.setLocalSeat(opts.localSeat);
      statusEl.textContent = notice || opts.statusOverride?.() || statusText(view, opts.names, opts.localSeat === -1 ? null : opts.localSeat);
      tray(view);
    },
    isAnimating: () => board.isAnimating(),
    destroy() {
      window.clearTimeout(noticeTimer);
      board.destroy();
    },
  };
  return panel;
}
