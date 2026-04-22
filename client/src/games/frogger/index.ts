import type { User } from '../../auth';

const W = 480, H = 560, CELL = 48;

interface Lane {
  type: 'road' | 'water' | 'safe';
  speed: number; // px/s, negative = left
  gap: number;   // min gap between vehicles
  objWidth: number;
  color: string;
  objColor: string;
  label: string;
}

interface Obj {
  x: number;
  lane: number;
}

const LANES: Lane[] = [
  { type: 'safe',  speed: 0,    gap: 0,   objWidth: 0,  color: '#14532d', objColor: '', label: '' },         // row 0 goal
  { type: 'water', speed: -90,  gap: 200, objWidth: 96, color: '#1e3a5f', objColor: '#b45309', label: '🪵' }, // row 1
  { type: 'water', speed: 70,   gap: 180, objWidth: 80, color: '#1e3a5f', objColor: '#b45309', label: '🪵' }, // row 2
  { type: 'water', speed: -110, gap: 160, objWidth: 64, color: '#1e3a5f', objColor: '#92400e', label: '🪵' }, // row 3
  { type: 'water', speed: 60,   gap: 200, objWidth: 96, color: '#1e3a5f', objColor: '#b45309', label: '🪵' }, // row 4
  { type: 'safe',  speed: 0,    gap: 0,   objWidth: 0,  color: '#14532d', objColor: '', label: '' },         // row 5 median
  { type: 'road',  speed: -80,  gap: 140, objWidth: 64, color: '#1c1c1c', objColor: '#dc2626', label: '🚗' }, // row 6
  { type: 'road',  speed: 110,  gap: 160, objWidth: 80, color: '#1c1c1c', objColor: '#7c3aed', label: '🚕' }, // row 7
  { type: 'road',  speed: -70,  gap: 120, objWidth: 64, color: '#1c1c1c', objColor: '#2563eb', label: '🚙' }, // row 8
  { type: 'road',  speed: 90,   gap: 180, objWidth: 96, color: '#1c1c1c', objColor: '#d97706', label: '🚛' }, // row 9
  { type: 'safe',  speed: 0,    gap: 0,   objWidth: 0,  color: '#14532d', objColor: '', label: '' },         // row 10 start
];

function makeLaneObjs(laneIdx: number): Obj[] {
  const lane = LANES[laneIdx];
  if (lane.type === 'safe') return [];
  const objs: Obj[] = [];
  let x = 0;
  while (x < W + lane.objWidth) {
    objs.push({ x, lane: laneIdx });
    x += lane.objWidth + lane.gap + Math.random() * lane.gap;
  }
  return objs;
}

export function launchFrogger(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  const wrapper = document.createElement('div');
  wrapper.className = 'min-h-screen bg-gray-950 text-white flex flex-col';
  wrapper.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-4">
      <button id="backBtn" class="text-sm text-gray-400 hover:text-white transition-colors">← Hub</button>
      <span class="font-bold text-lg">🐸 Frogger</span>
      <div class="ml-auto flex items-center gap-6 font-mono text-sm">
        <span>❤️ <span id="livesEl">3</span></span>
        <span>🏆 <span id="scoreEl">0</span></span>
        <span>Level <span id="levelEl">1</span></span>
        <button id="resetBtn" class="px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm">New Game</button>
      </div>
    </nav>
    <div class="flex-1 flex items-center justify-center p-4">
      <canvas id="canvas" width="${W}" height="${H}" style="border:2px solid #374151;border-radius:8px;display:block;"></canvas>
    </div>
    <div id="overlay" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-10">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl p-8 text-center">
        <div id="overlayEmoji" class="text-6xl mb-4"></div>
        <div id="overlayText" class="text-2xl font-bold mb-2"></div>
        <div id="overlaySub" class="text-gray-400 mb-6"></div>
        <button id="overlayBtn" class="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition-colors">Play Again</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  const canvas = wrapper.querySelector<HTMLCanvasElement>('#canvas')!;
  const ctx = canvas.getContext('2d')!;

  let lives = 3, score = 0, level = 1;
  let frogRow = 10, frogX = W / 2 - CELL / 2;
  let objs: Obj[][] = [];
  let raf = 0;
  let lastTime = 0;
  let dead = false;
  let reachedGoals = new Set<number>();

  function speedMul() { return 1 + (level - 1) * 0.15; }

  function initLevel() {
    objs = LANES.map((_, i) => makeLaneObjs(i));
    frogRow = 10;
    frogX = W / 2 - CELL / 2;
    dead = false;
    reachedGoals.clear();
  }

  function startGame() {
    lives = 3; score = 0; level = 1;
    updateHUD();
    hideOverlay();
    initLevel();
    lastTime = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function updateHUD() {
    wrapper.querySelector<HTMLElement>('#livesEl')!.textContent = String(lives);
    wrapper.querySelector<HTMLElement>('#scoreEl')!.textContent = String(score);
    wrapper.querySelector<HTMLElement>('#levelEl')!.textContent = String(level);
  }

  function showOverlay(emoji: string, text: string, sub: string) {
    const ov = wrapper.querySelector<HTMLElement>('#overlay')!;
    wrapper.querySelector<HTMLElement>('#overlayEmoji')!.textContent = emoji;
    wrapper.querySelector<HTMLElement>('#overlayText')!.textContent = text;
    wrapper.querySelector<HTMLElement>('#overlaySub')!.textContent = sub;
    ov.classList.remove('hidden');
  }

  function hideOverlay() {
    wrapper.querySelector<HTMLElement>('#overlay')!.classList.add('hidden');
  }

  function die() {
    lives--;
    updateHUD();
    if (lives <= 0) {
      cancelAnimationFrame(raf);
      showOverlay('💀', 'Game Over', `Score: ${score}`);
      return;
    }
    frogRow = 10;
    frogX = W / 2 - CELL / 2;
    dead = false;
  }

  function loop(ts: number) {
    if (!wrapper.isConnected) return;
    const dt = lastTime ? Math.min((ts - lastTime) / 1000, 0.05) : 0;
    lastTime = ts;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function update(dt: number) {
    if (dead) return;
    const mul = speedMul();

    // move objects
    for (let r = 0; r < LANES.length; r++) {
      const lane = LANES[r];
      if (lane.type === 'safe') continue;
      const speed = lane.speed * mul;
      for (const o of objs[r]) {
        o.x += speed * dt;
        // wrap
        if (speed > 0 && o.x > W + lane.objWidth) o.x = -lane.objWidth - lane.gap;
        if (speed < 0 && o.x < -lane.objWidth - lane.gap) o.x = W + lane.gap;
      }
    }

    // frog on log
    if (frogRow >= 1 && frogRow <= 4) {
      const lane = LANES[frogRow];
      const speed = lane.speed * mul;
      frogX += speed * dt;
    }

    // check frog out of bounds (water death or wall)
    if (frogX < 0 || frogX + CELL > W) {
      if (LANES[frogRow].type === 'water') { dead = true; setTimeout(die, 300); }
      frogX = Math.max(0, Math.min(W - CELL, frogX));
    }

    // collision / support check
    checkFrog();
  }

  function checkFrog() {
    if (dead) return;
    const lane = LANES[frogRow];
    const fx = frogX;

    if (lane.type === 'safe') {
      if (frogRow === 0) {
        // reached goal
        const slot = Math.floor(fx / (W / 5));
        if (!reachedGoals.has(slot)) {
          reachedGoals.add(slot);
          score += 50 * level;
          updateHUD();
        }
        if (reachedGoals.size >= 5) {
          level++;
          score += 200 * level;
          updateHUD();
          initLevel();
          return;
        }
        frogRow = 10;
        frogX = W / 2 - CELL / 2;
      }
      return;
    }

    if (lane.type === 'road') {
      for (const o of objs[frogRow]) {
        if (fx < o.x + LANES[frogRow].objWidth - 4 && fx + CELL > o.x + 4) {
          dead = true; setTimeout(die, 300); return;
        }
      }
      return;
    }

    if (lane.type === 'water') {
      let onLog = false;
      for (const o of objs[frogRow]) {
        if (fx + CELL - 8 > o.x && fx + 8 < o.x + LANES[frogRow].objWidth) {
          onLog = true; break;
        }
      }
      if (!onLog) { dead = true; setTimeout(die, 300); }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // lanes
    for (let r = 0; r < LANES.length; r++) {
      const lane = LANES[r];
      ctx.fillStyle = lane.color;
      ctx.fillRect(0, r * CELL, W, CELL);

      // lane dashes for road
      if (lane.type === 'road' && r !== 6) {
        ctx.fillStyle = '#374151';
        for (let x = 0; x < W; x += 60) ctx.fillRect(x, r * CELL + CELL - 2, 40, 2);
      }

      // water ripple
      if (lane.type === 'water') {
        ctx.fillStyle = '#1d4ed8';
        for (let x = 0; x < W; x += 30) ctx.fillRect(x, r * CELL + 8, 20, 4);
      }
    }

    // goal slots
    const slotW = W / 5;
    for (let s = 0; s < 5; s++) {
      ctx.fillStyle = reachedGoals.has(s) ? '#16a34a' : '#166534';
      ctx.fillRect(s * slotW + 4, 4, slotW - 8, CELL - 8);
      if (reachedGoals.has(s)) {
        ctx.font = '28px serif';
        ctx.textAlign = 'center';
        ctx.fillText('🐸', s * slotW + slotW / 2, CELL - 6);
      }
    }

    // objects
    for (let r = 0; r < LANES.length; r++) {
      const lane = LANES[r];
      if (lane.type === 'safe' || !lane.label) continue;
      for (const o of objs[r]) {
        if (lane.type === 'water') {
          ctx.fillStyle = lane.objColor;
          ctx.beginPath();
          ctx.roundRect(o.x, r * CELL + 6, lane.objWidth, CELL - 12, 6);
          ctx.fill();
        } else {
          ctx.font = `${CELL - 8}px serif`;
          if (lane.speed < 0) {
            ctx.save();
            ctx.translate(o.x + lane.objWidth / 2, 0);
            ctx.scale(-1, 1);
            ctx.textAlign = 'center';
            ctx.fillText(lane.label, 0, r * CELL + CELL - 6);
            ctx.restore();
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(lane.label, o.x + 2, r * CELL + CELL - 6);
          }
        }
      }
    }

    // frog
    if (!dead) {
      ctx.font = `${CELL - 4}px serif`;
      ctx.textAlign = 'left';
      ctx.fillText('🐸', frogX, frogRow * CELL + CELL - 4);
    } else {
      ctx.font = `${CELL - 4}px serif`;
      ctx.textAlign = 'left';
      ctx.fillText('💀', frogX, frogRow * CELL + CELL - 4);
    }
  }

  function move(dir: 'up' | 'down' | 'left' | 'right') {
    if (dead) return;
    const overlay = wrapper.querySelector<HTMLElement>('#overlay')!;
    if (!overlay.classList.contains('hidden')) return;
    if (dir === 'up' && frogRow > 0) { frogRow--; score += 10; updateHUD(); }
    if (dir === 'down' && frogRow < 10) frogRow++;
    if (dir === 'left') frogX = Math.max(0, frogX - CELL);
    if (dir === 'right') frogX = Math.min(W - CELL, frogX + CELL);
    checkFrog();
  }

  function onKey(e: KeyboardEvent) {
    if (!wrapper.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); move('up'); }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); move('down'); }
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); move('left'); }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); move('right'); }
  }

  // touch/swipe
  let touchX = 0, touchY = 0;
  canvas.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
    else move(dy > 0 ? 'down' : 'up');
    e.preventDefault();
  }, { passive: false });

  wrapper.querySelector('#backBtn')!.addEventListener('click', () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    wrapper.remove();
    hubEl.style.display = '';
  });
  wrapper.querySelector('#resetBtn')!.addEventListener('click', startGame);
  wrapper.querySelector('#overlayBtn')!.addEventListener('click', startGame);
  document.addEventListener('keydown', onKey);

  startGame();
}
