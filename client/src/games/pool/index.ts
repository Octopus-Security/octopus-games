// "Pool (practice)": the engine running in the browser, both seats on one device.
// No server, no saves. Multiplayer wiring lands separately.

import type { User } from '../../auth';
import { initialState, applyMove, view, status, IllegalMove, groupOf, type PoolState, type PoolMove } from '../../../../shared/pool/index.js';
import { PoolBoard, statusText, ballColor } from './PoolView';

function randomSeed(): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

const NAMES: [string, string] = ['Player 1', 'Player 2'];

export function launchPoolPractice(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  // The seed only picks the rack order; the engine itself never calls Math.random.
  let state: PoolState = initialState(randomSeed());
  let spin = 0;

  const wrapper = document.createElement('div');
  wrapper.className = 'bg-gray-950 text-white flex flex-col';
  wrapper.style.cssText = 'position:fixed;inset:0;height:100vh;height:100dvh;overflow:hidden;';
  wrapper.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 flex items-center gap-3" style="padding:6px 16px;min-height:44px;">
      <button id="poolBack" class="text-sm text-gray-400 hover:text-white transition-colors" style="min-height:44px;">← Hub</button>
      <span class="font-bold text-base whitespace-nowrap">🎱 Pool (practice)</span>
      <button id="poolNew" class="ml-auto px-3 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm transition-colors" style="min-height:44px;">New game</button>
    </nav>
    <div class="bg-gray-900 border-b border-gray-800" style="padding:6px 16px;">
      <div id="poolStatus" class="text-sm text-gray-200" style="min-height:2.5em;line-height:1.25;"></div>
      <div class="flex items-center gap-3 flex-wrap" style="margin-top:4px;">
        <div id="poolTray" class="flex items-center gap-3 text-xs text-gray-400"></div>
        <label class="ml-auto flex items-center gap-2 text-xs text-gray-400" style="min-height:32px;">
          Draw
          <input id="poolSpin" type="range" min="-1" max="1" step="0.05" value="0" style="width:96px;height:32px;" />
          Follow
        </label>
      </div>
    </div>
    <div id="poolHost" style="flex:1 1 auto;min-height:0;position:relative;"></div>
  `;
  document.body.appendChild(wrapper);

  const statusEl = wrapper.querySelector<HTMLElement>('#poolStatus')!;
  const trayEl = wrapper.querySelector<HTMLElement>('#poolTray')!;
  const host = wrapper.querySelector<HTMLElement>('#poolHost')!;
  const spinEl = wrapper.querySelector<HTMLInputElement>('#poolSpin')!;
  spinEl.addEventListener('input', () => { spin = Number(spinEl.value); });

  let notice = '';
  let noticeTimer = 0;
  const showNotice = (t: string) => {
    notice = t;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { notice = ''; refresh(); }, 4000);
    refresh();
  };

  const board = new PoolBoard(host, {
    localSeat: null,
    getSpin: () => spin,
    onNotice: showNotice,
    onMove: (move: PoolMove) => {
      try {
        const res = applyMove(state, move, state.turn);
        state = res.state;
        board.setView(view(state, null), true);
        refresh();
      } catch (e) {
        if (e instanceof IllegalMove || (e as Error).name === 'IllegalMove') showNotice((e as Error).message);
        else throw e;
      }
    },
  });

  function ballChip(id: number): string {
    const striped = groupOf(id) === 'stripe';
    const c = ballColor(id);
    const bg = striped ? `linear-gradient(#f4f1e8 0 28%, ${c} 28% 72%, #f4f1e8 72%)` : c;
    return `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${bg};border:1px solid rgba(255,255,255,.25);"></span>`;
  }

  function refresh() {
    const v = view(state, null);
    statusEl.textContent = notice || statusText(v, NAMES, null);
    const st = status(state);
    const mine = (seat: number) => {
      const g = state.groups[seat];
      if (!g) return `${NAMES[seat]}: ${st.turn === seat ? 'to play' : ''}`.trim();
      const ids = (g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]).filter((i) => state.balls[i]);
      const left = ids.map(ballChip).join('') + (state.balls[8] && ids.length === 0 ? ballChip(8) : '');
      return `<span class="flex items-center gap-1">${NAMES[seat]} ${left || '✓'}</span>`;
    };
    trayEl.innerHTML = `<span style="${st.turn === 0 ? 'color:#fff' : ''}">${mine(0)}</span><span style="${st.turn === 1 ? 'color:#fff' : ''}">${mine(1)}</span>`;
  }

  function newGame() {
    state = initialState(randomSeed());
    board.setView(view(state, null), false);
    refresh();
  }

  wrapper.querySelector('#poolNew')!.addEventListener('click', newGame);
  wrapper.querySelector('#poolBack')!.addEventListener('click', () => {
    board.destroy();
    wrapper.remove();
    hubEl.style.display = '';
  });

  board.setView(view(state, null), false);
  refresh();
}
