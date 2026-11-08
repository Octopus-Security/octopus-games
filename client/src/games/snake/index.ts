import type { User } from '../../auth';
import { newGame, queueTurn, step, tickMs, type Dir, type SnakeState } from './logic.js';

const COLS = 20, ROWS = 20;
const BEST_KEY = 'octopus_snake_best_v1';

function loadBest(): number {
  try { return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0); } catch { return 0; }
}
function saveBest(n: number): void {
  try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* storage blocked */ }
}

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

export function launchSnake(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  const wrapper = document.createElement('div');
  wrapper.className = 'bg-gray-950 text-white flex flex-col';
  wrapper.style.cssText = 'position:fixed;inset:0;overflow:hidden;overscroll-behavior:none;';
  wrapper.innerHTML = `
    <style>
      .sn-pad { display:none; grid-template-columns:repeat(3,56px); grid-template-rows:repeat(2,56px); gap:6px; justify-content:center; padding:6px 0 calc(8px + env(safe-area-inset-bottom)); }
      .sn-pad button { min-width:44px; min-height:44px; font-size:1.5rem; background:#1f2937; border:1px solid #374151; border-radius:12px; touch-action:manipulation; color:#e5e7eb; }
      .sn-pad button:active { background:var(--o-accent, #34d399); color:#052e16; }
      @media (pointer:coarse), (max-width:700px) { .sn-pad { display:grid; } }
    </style>
    <nav class="bg-gray-900 border-b border-gray-800 px-3 sm:px-6 py-2 flex items-center gap-3 flex-wrap">
      <button id="backBtn" class="text-sm text-gray-400 hover:text-white transition-colors" style="min-height:44px;padding:0 6px">← Hub</button>
      <span class="font-bold text-lg">🐍 Snake</span>
      <div class="ml-auto flex items-center gap-3 sm:gap-6 font-mono text-sm">
        <span>🏆 <span id="scoreEl">0</span></span>
        <span>Best <span id="bestEl">0</span></span>
        <button id="pauseBtn" class="px-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm" style="min-height:44px" aria-label="Pause">Pause</button>
        <button id="resetBtn" class="px-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm" style="min-height:44px">New Game</button>
      </div>
    </nav>
    <div id="area" class="flex-1 flex items-center justify-center p-2" style="min-height:0">
      <div style="position:relative">
        <canvas id="canvas" style="border:2px solid #374151;border-radius:8px;display:block;touch-action:none;" aria-label="Snake board"></canvas>
        <div id="overlay" class="hidden absolute inset-0 bg-black/60 flex items-center justify-center" style="border-radius:8px">
          <div class="bg-gray-900 border border-gray-700 rounded-2xl p-6 text-center">
            <div id="overlayEmoji" class="text-5xl mb-3"></div>
            <div id="overlayText" class="text-2xl font-bold mb-1"></div>
            <div id="overlaySub" class="text-gray-400 mb-4"></div>
            <button id="overlayBtn" class="px-6 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition-colors" style="min-height:44px">Play Again</button>
          </div>
        </div>
      </div>
    </div>
    <div class="sn-pad" aria-label="Direction pad">
      <span></span><button data-d="up" aria-label="Up">▲</button><span></span>
      <button data-d="left" aria-label="Left">◀</button><button data-d="down" aria-label="Down">▼</button><button data-d="right" aria-label="Right">▶</button>
    </div>
  `;
  document.body.appendChild(wrapper);

  const q = <T extends HTMLElement>(s: string) => wrapper.querySelector<T>(s)!;
  const canvas = q<HTMLCanvasElement>('#canvas');
  const area = q('#area');
  const ctx = canvas.getContext('2d')!;
  const scoreEl = q('#scoreEl'), bestEl = q('#bestEl'), pauseBtn = q('#pauseBtn');

  let state: SnakeState = newGame(COLS, ROWS);
  let best = loadBest();
  let paused = false, started = false;
  let timer = 0;
  let cell = 20;

  function fit(): void {
    const aw = area.clientWidth - 16, ah = area.clientHeight - 16;
    const size = Math.max(160, Math.floor(Math.min(aw, ah) / COLS) * COLS);
    cell = size / COLS;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  const ro = new ResizeObserver(fit);
  ro.observe(area);

  function draw(): void {
    const size = cell * COLS;
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#111a2e';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if ((x + y) % 2) ctx.fillRect(x * cell, y * cell, cell, cell);
    if (state.food) {
      ctx.fillStyle = '#f87171';
      ctx.beginPath(); ctx.arc((state.food.x + 0.5) * cell, (state.food.y + 0.5) * cell, cell * 0.34, 0, Math.PI * 2); ctx.fill();
    }
    state.snake.forEach((c, i) => {
      ctx.fillStyle = i === 0 ? '#6ee7b7' : (i % 2 ? '#34d399' : '#10b981');
      const pad = i === 0 ? 1 : 2;
      ctx.beginPath(); ctx.roundRect(c.x * cell + pad, c.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.25); ctx.fill();
    });
    const h = state.snake[0];
    ctx.fillStyle = '#052e16';
    const dx = state.dir === 'left' ? -1 : state.dir === 'right' ? 1 : 0, dy = state.dir === 'up' ? -1 : state.dir === 'down' ? 1 : 0;
    for (const s of [-1, 1]) {
      const ex = (h.x + 0.5) * cell + dx * cell * 0.15 + (dy ? s * cell * 0.2 : 0);
      const ey = (h.y + 0.5) * cell + dy * cell * 0.15 + (dx ? s * cell * 0.2 : 0);
      ctx.beginPath(); ctx.arc(ex, ey, cell * 0.08, 0, Math.PI * 2); ctx.fill();
    }
  }

  function hud(): void {
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(best);
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  }

  function showOverlay(emoji: string, text: string, sub: string, btn: string): void {
    q('#overlayEmoji').textContent = emoji; q('#overlayText').textContent = text;
    q('#overlaySub').textContent = sub; q('#overlayBtn').textContent = btn;
    q('#overlay').classList.remove('hidden');
  }
  const hideOverlay = (): void => q('#overlay').classList.add('hidden');

  function schedule(): void {
    window.clearTimeout(timer);
    if (!started || paused || state.over || !wrapper.isConnected) return;
    timer = window.setTimeout(tick, tickMs(state.eaten));
  }

  function tick(): void {
    step(state);
    if (state.score > best) { best = state.score; saveBest(best); }
    hud(); draw();
    if (state.over) {
      showOverlay(state.won ? '🏆' : '💀', state.won ? 'You filled the board!' : 'Game Over', `Score: ${state.score}  ·  Best: ${best}`, 'Play Again');
      return;
    }
    schedule();
  }

  function newRound(): void {
    state = newGame(COLS, ROWS);
    paused = false; started = false;
    hideOverlay(); hud(); draw();
    showOverlay('🐍', 'Snake', 'Arrows / WASD / swipe to start', 'Start');
  }
  function begin(): void {
    hideOverlay(); started = true; paused = false; hud(); schedule();
  }
  function setPaused(p: boolean): void {
    if (!started || state.over) return;
    paused = p; hud();
    if (p) { window.clearTimeout(timer); showOverlay('⏸️', 'Paused', 'P or Esc to resume', 'Resume'); }
    else { hideOverlay(); schedule(); }
  }
  function turn(d: Dir): void {
    if (!started && !state.over) begin();
    if (paused) return;
    queueTurn(state, d);
  }

  function onKey(e: KeyboardEvent): void {
    if (!wrapper.isConnected) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = KEYS[e.key];
    if (d) { e.preventDefault(); turn(d); return; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); setPaused(!paused); }
    else if (e.key === ' ') e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  // swipe on the board
  let sx = 0, sy = 0, sid = -1;
  canvas.addEventListener('pointerdown', (e) => { sid = e.pointerId; sx = e.clientX; sy = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ } });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    sx = e.clientX; sy = e.clientY; // allow a chained swipe in one stroke
  });
  const endSwipe = (e: PointerEvent): void => { if (e.pointerId === sid) sid = -1; };
  canvas.addEventListener('pointerup', endSwipe);
  canvas.addEventListener('pointercancel', endSwipe);

  wrapper.querySelectorAll<HTMLButtonElement>('.sn-pad button').forEach((b) =>
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); turn(b.dataset.d as Dir); }));

  pauseBtn.addEventListener('click', () => setPaused(!paused));
  q('#resetBtn').addEventListener('click', newRound);
  q('#overlayBtn').addEventListener('click', () => {
    if (paused) setPaused(false);
    else if (state.over) { newRound(); begin(); }
    else begin();
  });
  q('#backBtn').addEventListener('click', () => {
    window.clearTimeout(timer);
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    wrapper.remove();
    hubEl.style.display = '';
  });

  hud();
  fit();
  newRound();
}
