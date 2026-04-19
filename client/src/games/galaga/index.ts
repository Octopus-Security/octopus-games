import type { User } from '../../auth';

const W = 480, H = 600;

interface Bullet { x: number; y: number; vy: number; }
interface Enemy {
  x: number; y: number;
  row: number; col: number;
  hp: number;
  diving: boolean;
  diveAngle: number;
  diveSpeed: number;
  alive: boolean;
  emoji: string;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; }
interface Star { x: number; y: number; speed: number; size: number; }

const ENEMY_EMOJIS = ['👾', '🛸', '🦠'];

function makeStars(): Star[] {
  return Array.from({ length: 80 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    speed: 20 + Math.random() * 60,
    size: Math.random() < 0.3 ? 2 : 1,
  }));
}

function makeEnemies(level: number): Enemy[] {
  const enemies: Enemy[] = [];
  const rows = Math.min(3 + Math.floor(level / 2), 5);
  const cols = 10;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      enemies.push({
        x: 48 + c * 40,
        y: 60 + r * 44,
        row: r, col: c,
        hp: 1,
        diving: false,
        diveAngle: 0,
        diveSpeed: 0,
        alive: true,
        emoji: ENEMY_EMOJIS[Math.min(r, ENEMY_EMOJIS.length - 1)],
      });
    }
  }
  return enemies;
}

export function launchGalaga(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  const wrapper = document.createElement('div');
  wrapper.className = 'min-h-screen bg-gray-950 text-white flex flex-col';
  wrapper.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-4">
      <button id="backBtn" class="text-sm text-gray-400 hover:text-white transition-colors">← Hub</button>
      <span class="font-bold text-lg">👾 Galaga</span>
      <div class="ml-auto flex items-center gap-6 font-mono text-sm">
        <span>❤️ <span id="livesEl">3</span></span>
        <span>🏆 <span id="scoreEl">0</span></span>
        <span>Level <span id="levelEl">1</span></span>
        <button id="resetBtn" class="px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm">New Game</button>
      </div>
    </nav>
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="flex flex-col items-center gap-3">
        <canvas id="canvas" width="${W}" height="${H}" style="border:2px solid #374151;border-radius:8px;display:block;"></canvas>
        <div class="flex gap-3">
          <button id="leftBtn"  class="w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 text-xl active:bg-gray-600">◀</button>
          <button id="fireBtn"  class="w-14 h-14 rounded-xl bg-red-800 border border-red-700 text-xl active:bg-red-600">🔴</button>
          <button id="rightBtn" class="w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 text-xl active:bg-gray-600">▶</button>
        </div>
      </div>
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
  let shipX = W / 2;
  const shipY = H - 50;
  let bullets: Bullet[] = [];
  let enemyBullets: Bullet[] = [];
  let enemies: Enemy[] = [];
  let particles: Particle[] = [];
  let stars: Star[] = makeStars();
  let swarmDx = 40;
  let swarmX = 0;
  let shootCooldown = 0;
  let raf = 0;
  let lastTime = 0;
  let gameOver = false;
  let levelComplete = false;
  let keys = { left: false, right: false, fire: false };
  let enemyShootTimer = 0;

  function startGame() {
    lives = 3; score = 0; level = 1;
    shipX = W / 2;
    bullets = []; enemyBullets = []; particles = [];
    swarmX = 0; swarmDx = 40;
    enemies = makeEnemies(level);
    gameOver = false; levelComplete = false;
    shootCooldown = 0; enemyShootTimer = 0;
    updateHUD();
    hideOverlay();
    lastTime = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function nextLevel() {
    level++;
    bullets = []; enemyBullets = []; particles = [];
    swarmX = 0; swarmDx = 40 + level * 5;
    enemies = makeEnemies(level);
    levelComplete = false;
    updateHUD();
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

  function loop(ts: number) {
    if (!wrapper.isConnected) return;
    const dt = lastTime ? Math.min((ts - lastTime) / 1000, 0.05) : 0;
    lastTime = ts;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function update(dt: number) {
    if (gameOver) return;

    // stars
    for (const s of stars) {
      s.y += s.speed * dt;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
    }

    // particles
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);

    if (levelComplete) return;

    // ship movement
    if (keys.left) shipX = Math.max(20, shipX - 280 * dt);
    if (keys.right) shipX = Math.min(W - 20, shipX + 280 * dt);

    // fire
    shootCooldown -= dt;
    if (keys.fire && shootCooldown <= 0) {
      bullets.push({ x: shipX, y: shipY - 10, vy: -500 });
      shootCooldown = 0.25;
    }

    // player bullets
    bullets = bullets.filter(b => b.y > -10);
    for (const b of bullets) b.y += b.vy * dt;

    // enemy bullets
    enemyBullets = enemyBullets.filter(b => b.y < H + 10);
    for (const b of enemyBullets) b.y += b.vy * dt;

    // swarm movement
    const alive = enemies.filter(e => e.alive && !e.diving);
    if (alive.length > 0) {
      swarmX += swarmDx * dt;
      let minX = Infinity, maxX = -Infinity;
      for (const e of alive) { minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x); }
      if (maxX + swarmX > W - 30 || minX + swarmX < 30) swarmDx *= -1;
    }

    // diving
    for (const e of enemies) {
      if (!e.alive) continue;
      if (!e.diving && Math.random() < 0.0008 * (level + 1)) {
        e.diving = true;
        e.diveAngle = Math.random() * Math.PI * 2;
        e.diveSpeed = 120 + Math.random() * 80;
      }
      if (e.diving) {
        e.x += Math.cos(e.diveAngle) * e.diveSpeed * dt;
        e.y += Math.abs(Math.sin(e.diveAngle)) * e.diveSpeed * dt + 80 * dt;
        if (e.y > H + 40) {
          e.y = 60 + e.row * 44;
          e.x = 48 + e.col * 40;
          e.diving = false;
        }
      }
    }

    // apply swarm offset for drawing
    // enemy shoot
    enemyShootTimer -= dt;
    if (enemyShootTimer <= 0) {
      const shooters = enemies.filter(e => e.alive);
      if (shooters.length > 0) {
        const shooter = shooters[Math.floor(Math.random() * shooters.length)];
        const ex = shooter.diving ? shooter.x : shooter.x + swarmX;
        enemyBullets.push({ x: ex, y: shooter.y + 16, vy: 200 + level * 20 });
      }
      enemyShootTimer = Math.max(0.4, 1.5 - level * 0.1);
    }

    // bullet-enemy collisions
    for (const b of bullets) {
      for (const e of enemies) {
        if (!e.alive) continue;
        const ex = e.diving ? e.x : e.x + swarmX;
        if (Math.abs(b.x - ex) < 18 && Math.abs(b.y - e.y) < 18) {
          e.alive = false;
          b.y = -100;
          score += (e.row + 1) * 10 * level;
          updateHUD();
          for (let i = 0; i < 8; i++) {
            particles.push({ x: ex, y: e.y, vx: (Math.random()-0.5)*150, vy: (Math.random()-0.5)*150, life: 0.6, color: `hsl(${Math.random()*60+20},90%,60%)` });
          }
        }
      }
    }

    // enemy bullet hits ship
    for (const b of enemyBullets) {
      if (Math.abs(b.x - shipX) < 18 && Math.abs(b.y - shipY) < 18) {
        b.y = H + 100;
        lives--;
        updateHUD();
        for (let i = 0; i < 12; i++) particles.push({ x: shipX, y: shipY, vx: (Math.random()-0.5)*200, vy: (Math.random()-0.5)*200, life: 0.8, color: '#60a5fa' });
        if (lives <= 0) { gameOver = true; cancelAnimationFrame(raf); showOverlay('💀', 'Game Over', `Score: ${score}`); }
      }
    }

    // enemy reaches bottom
    for (const e of enemies) {
      if (!e.alive) continue;
      const ey = e.diving ? e.y : e.y;
      if (ey > shipY - 20) {
        gameOver = true; cancelAnimationFrame(raf); showOverlay('💀', 'Invaded!', `Score: ${score}`); return;
      }
    }

    // level clear
    if (enemies.every(e => !e.alive)) {
      levelComplete = true;
      score += 500 * level;
      updateHUD();
      setTimeout(nextLevel, 1500);
    }
  }

  function draw() {
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);

    // stars
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + s.size * 0.3})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    // particles
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // enemies
    ctx.font = '26px serif';
    ctx.textAlign = 'center';
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = e.diving ? e.x : e.x + swarmX;
      ctx.fillText(e.emoji, ex, e.y + 10);
    }

    // enemy bullets
    ctx.fillStyle = '#f97316';
    for (const b of enemyBullets) {
      ctx.fillRect(b.x - 2, b.y - 6, 4, 12);
    }

    // player bullets
    ctx.fillStyle = '#60a5fa';
    for (const b of bullets) {
      ctx.fillRect(b.x - 2, b.y - 8, 4, 16);
    }

    // ship
    if (!gameOver) {
      ctx.font = '30px serif';
      ctx.textAlign = 'center';
      ctx.fillText('🚀', shipX, shipY + 12);
    }

    // level complete flash
    if (levelComplete) {
      ctx.fillStyle = 'rgba(96,165,250,0.15)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#60a5fa';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Level ${level} Clear!`, W / 2, H / 2);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!wrapper.isConnected) { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); return; }
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if (e.key === ' ' || e.key === 'z' || e.key === 'Z') { e.preventDefault(); keys.fire = true; }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
    if (e.key === ' ' || e.key === 'z' || e.key === 'Z') keys.fire = false;
  }

  wrapper.querySelector('#leftBtn')!.addEventListener('pointerdown', () => { keys.left = true; });
  wrapper.querySelector('#leftBtn')!.addEventListener('pointerup', () => { keys.left = false; });
  wrapper.querySelector('#rightBtn')!.addEventListener('pointerdown', () => { keys.right = true; });
  wrapper.querySelector('#rightBtn')!.addEventListener('pointerup', () => { keys.right = false; });
  wrapper.querySelector('#fireBtn')!.addEventListener('pointerdown', () => { keys.fire = true; });
  wrapper.querySelector('#fireBtn')!.addEventListener('pointerup', () => { keys.fire = false; });

  wrapper.querySelector('#backBtn')!.addEventListener('click', () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKeyUp);
    wrapper.remove();
    hubEl.style.display = '';
  });
  wrapper.querySelector('#resetBtn')!.addEventListener('click', startGame);
  wrapper.querySelector('#overlayBtn')!.addEventListener('click', startGame);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);

  startGame();
}
