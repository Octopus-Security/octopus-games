import { Input } from './Input';
import { Player } from './Player';
import { Fish, type FishType, FISH_DEFS } from './Fish';
import { ParticleSystem } from './Particles';
import { drawHUD, drawWaveBanner, drawGameOver } from './HUD';
import { loadSave, writeSave } from '../../auth';

interface SaveData {
  highScore: number;
  totalFishPunched: number;
  totalSharksDefeated: number;
}

const WAVE_DURATION = 30; // seconds per wave
const FISH_TYPES: FishType[] = ['clownfish', 'pufferfish', 'shark', 'fancy'];

function pickFishType(wave: number): FishType {
  const weights: Record<FishType, number> = {
    clownfish: Math.max(0, 50 - wave * 5),
    pufferfish: 20 + wave * 2,
    shark: Math.min(30, wave * 3),
    fancy: Math.min(20, wave * 2),
  };
  const total = (Object.values(weights) as number[]).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const type of FISH_TYPES) {
    r -= weights[type];
    if (r <= 0) return type;
  }
  return 'clownfish';
}

type GameState = 'playing' | 'gameover' | 'wavebanner';

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private input: Input;
  private player: Player;
  private fish: Fish[] = [];
  private particles: ParticleSystem;

  private score = 0;
  private wave = 1;
  private waveTimer = WAVE_DURATION;
  private spawnTimer = 0;
  private spawnInterval = 2.5;
  private state: GameState = 'wavebanner';
  private waveBannerTimer = 2.5;
  private combo = 0;
  private comboTimer = 0;

  private saveData: SaveData = { highScore: 0, totalFishPunched: 0, totalSharksDefeated: 0 };

  // Parallax layers
  private bubbles: Array<{ x: number; y: number; r: number; speed: number }> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.input = new Input();
    this.player = new Player(canvas.width / 2, canvas.height / 2);
    this.particles = new ParticleSystem();

    for (let i = 0; i < 30; i++) {
      this.bubbles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: 2 + Math.random() * 6,
        speed: 20 + Math.random() * 40,
      });
    }

    this.loadProgress();
  }

  private async loadProgress(): Promise<void> {
    const saved = await loadSave<SaveData>('octopus-punch');
    if (saved) this.saveData = saved;
  }

  private async saveProgress(): Promise<void> {
    this.saveData.highScore = Math.max(this.saveData.highScore, this.score);
    await writeSave('octopus-punch', this.saveData);
  }

  private spawnFish(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const margin = 40;
    let x: number, y: number;

    // Spawn from a random edge
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { x = Math.random() * W; y = -margin; }
    else if (edge === 1) { x = W + margin; y = Math.random() * H; }
    else if (edge === 2) { x = Math.random() * W; y = H + margin; }
    else { x = -margin; y = Math.random() * H; }

    const type = pickFishType(this.wave);
    this.fish.push(new Fish(type, x, y, this.player.x, this.player.y));
  }

  private startNextWave(): void {
    this.wave++;
    this.waveTimer = WAVE_DURATION + this.wave * 5;
    this.spawnInterval = Math.max(0.8, 2.5 - this.wave * 0.2);
    this.fish = [];
    this.state = 'wavebanner';
    this.waveBannerTimer = 2.5;
    this.player = new Player(this.canvas.width / 2, this.canvas.height / 2);
  }

  update(dt: number): void {
    // Bubbles
    for (const b of this.bubbles) {
      b.y -= b.speed * dt;
      if (b.y < -b.r) b.y = this.canvas.height + b.r;
    }

    if (this.state === 'wavebanner') {
      this.waveBannerTimer -= dt;
      if (this.waveBannerTimer <= 0) this.state = 'playing';
      this.input.flush();
      return;
    }

    if (this.state === 'gameover') {
      if (this.input.pressed('Space') || this.input.pressed('Enter')) {
        this.restart();
      }
      this.input.flush();
      return;
    }

    // Wave timer
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.startNextWave();
      this.input.flush();
      return;
    }

    // Spawn fish
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnFish();
      this.spawnTimer = this.spawnInterval * (0.7 + Math.random() * 0.6);
    }

    // Player update
    const punched = this.player.update(dt, this.input, this.canvas.width, this.canvas.height);

    if (punched) {
      const hb = this.player.getPunchHitbox();
      for (const f of this.fish) {
        if (f.dead || f.stunTimer > 0) continue;
        // AABB vs circle
        const nx = Math.max(hb.x, Math.min(f.x, hb.x + hb.w));
        const ny = Math.max(hb.y, Math.min(f.y, hb.y + hb.h));
        const dx = f.x - nx;
        const dy = f.y - ny;
        if (dx * dx + dy * dy < f.radius * f.radius) {
          const kbLen = Math.sqrt(dx * dx + dy * dy) || 1;
          const killed = f.hit(dx / kbLen, dy / kbLen);
          if (killed) {
            this.saveData.totalFishPunched++;
            if (f.type === 'shark') this.saveData.totalSharksDefeated++;
            this.combo++;
            this.comboTimer = 1.5;
            this.score += f.points * (this.combo >= 3 ? 2 : 1);
            this.particles.spawn(f.x, f.y, FISH_DEFS[f.type].color, 12);
          } else {
            this.particles.spawn(f.x, f.y, '#ffffff', 5);
          }
        }
      }
    }

    // Combo decay
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // Fish update + player collision
    for (const f of this.fish) {
      f.update(dt, this.canvas.width, this.canvas.height);
      if (!f.dead && this.player.invincibleTimer <= 0) {
        const dx = f.x - this.player.x;
        const dy = f.y - this.player.y;
        if (dx * dx + dy * dy < (f.radius + this.player.radius) ** 2) {
          this.player.takeDamage(this.particles);
          // Bounce fish back
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          f.vx = (dx / len) * 150;
          f.vy = (dy / len) * 150;
          f.stunTimer = 0.3;
        }
      }
    }

    this.fish = this.fish.filter(f => !f.dead);

    // Particles
    this.particles.update(dt);

    // Game over
    if (this.player.hp <= 0) {
      this.state = 'gameover';
      this.saveProgress();
    }

    this.input.flush();
  }

  private restart(): void {
    this.score = 0;
    this.wave = 1;
    this.waveTimer = WAVE_DURATION;
    this.spawnTimer = 0;
    this.spawnInterval = 2.5;
    this.fish = [];
    this.combo = 0;
    this.comboTimer = 0;
    this.player = new Player(this.canvas.width / 2, this.canvas.height / 2);
    this.state = 'wavebanner';
    this.waveBannerTimer = 2.5;
  }

  draw(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Screen shake
    ctx.save();
    if (this.player.shakeTimer > 0) {
      const s = this.player.shakeTimer * 10;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    // Ocean background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0c1a2e');
    grad.addColorStop(1, '#071020');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Bubbles
    for (const b of this.bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(96,165,250,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Particles (behind entities)
    this.particles.draw(ctx);

    // Fish
    for (const f of this.fish) f.draw(ctx);

    // Player
    this.player.draw(ctx);

    // Punch hitbox debug (remove in production)
    // if (this.player.punchAnim > 0) { ... }

    ctx.restore();

    // HUD (no shake)
    const cooldownPct = this.player.punchTimer / this.player.punchCooldown;
    drawHUD(ctx, this.score, this.player.hp, this.player.maxHp, this.wave, this.waveTimer, cooldownPct);

    // Combo text
    if (this.combo >= 2 && this.comboTimer > 0) {
      const alpha = Math.min(1, this.comboTimer);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${24 + this.combo * 4}px monospace`;
      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'center';
      ctx.fillText(`${this.combo}x COMBO!`, W / 2, H / 2 - 60);
      ctx.restore();
    }

    if (this.state === 'wavebanner') {
      drawWaveBanner(ctx, this.wave, Math.min(1, this.waveBannerTimer));
    }
    if (this.state === 'gameover') {
      drawGameOver(ctx, this.score, this.saveData.highScore);
    }
  }
}
