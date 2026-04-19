import { Input } from './Input';
import { ParticleSystem } from './Particles';

export interface PlayerStats {
  speed: number;
  inertia: number;       // 0–1, higher = more drift
  punchCooldown: number; // seconds
  punchRange: number;
  maxHp: number;
}

export const OCTOPUS_STATS: PlayerStats = {
  speed: 280,
  inertia: 0.88,
  punchCooldown: 0.5,
  punchRange: 70,
  maxHp: 5,
};

export class Player {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  hp: number;
  maxHp: number;
  facing = 1; // 1 = right, -1 = left

  punchTimer = 0;        // cooldown remaining
  punchAnim = 0;         // visual stretch [0,1]
  invincibleTimer = 0;   // brief invincibility after hit
  shakeTimer = 0;        // screen shake countdown

  private stats: PlayerStats;
  readonly radius = 26;

  constructor(x: number, y: number, stats: PlayerStats = OCTOPUS_STATS) {
    this.x = x;
    this.y = y;
    this.stats = stats;
    this.hp = stats.maxHp;
    this.maxHp = stats.maxHp;
  }

  get canPunch(): boolean { return this.punchTimer <= 0; }
  get punchCooldown(): number { return this.stats.punchCooldown; }
  get punchRange(): number { return this.stats.punchRange; }

  /** Returns true if punch was triggered this frame */
  update(dt: number, input: Input, canvasW: number, canvasH: number): boolean {
    // Movement
    const mx = input.moveX;
    const my = input.moveY;
    if (mx !== 0 || my !== 0) {
      const len = Math.sqrt(mx * mx + my * my);
      this.vx += (mx / len) * this.stats.speed * (1 - this.stats.inertia) * (dt / 0.016);
      this.vy += (my / len) * this.stats.speed * (1 - this.stats.inertia) * (dt / 0.016);
      if (mx !== 0) this.facing = mx > 0 ? 1 : -1;
    }

    this.vx *= Math.pow(this.stats.inertia, dt / 0.016);
    this.vy *= Math.pow(this.stats.inertia, dt / 0.016);

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Clamp to canvas
    const r = this.radius;
    this.x = Math.max(r, Math.min(canvasW - r, this.x));
    this.y = Math.max(r, Math.min(canvasH - r, this.y));

    // Timers
    if (this.punchTimer > 0) this.punchTimer -= dt;
    if (this.punchAnim > 0) this.punchAnim -= dt * 4;
    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.shakeTimer > 0) this.shakeTimer -= dt;

    // Punch
    if (input.punch && this.canPunch) {
      this.punchTimer = this.stats.punchCooldown;
      this.punchAnim = 1;
      return true;
    }
    return false;
  }

  takeDamage(particles: ParticleSystem): void {
    if (this.invincibleTimer > 0) return;
    this.hp--;
    this.invincibleTimer = 1.2;
    this.shakeTimer = 0.3;
    particles.spawn(this.x, this.y, '#ef4444', 10);
  }

  /** Hitbox rect for punch, extending in facing direction */
  getPunchHitbox(): { x: number; y: number; w: number; h: number } {
    const range = this.stats.punchRange;
    const armX = this.x + this.facing * (this.radius + 10);
    return { x: armX - 15, y: this.y - 20, w: range, h: 40 };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.radius;
    const flashing = this.invincibleTimer > 0 && Math.floor(this.invincibleTimer / 0.1) % 2 === 0;

    ctx.save();
    ctx.translate(this.x, this.y);
    if (flashing) ctx.globalAlpha = 0.4;

    // Body
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 1.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7c3aed';
    ctx.fill();
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Tentacles
    for (let i = 0; i < 4; i++) {
      const tx = (i - 1.5) * (r / 2);
      const wave = Math.sin(Date.now() / 200 + i) * 6;
      ctx.beginPath();
      ctx.moveTo(tx, r * 0.7);
      ctx.quadraticCurveTo(tx + wave, r * 1.3, tx + wave * 0.5, r * 1.8);
      ctx.strokeStyle = '#6d28d9';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Eyes
    const eyeX = this.facing * r * 0.3;
    ctx.beginPath();
    ctx.arc(eyeX, -r * 0.15, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX + this.facing * 2, -r * 0.15, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#1e1b4b';
    ctx.fill();

    // Punch arm
    if (this.punchAnim > 0) {
      const armLen = this.stats.punchRange * this.punchAnim;
      ctx.beginPath();
      ctx.moveTo(this.facing * r * 0.5, 0);
      ctx.lineTo(this.facing * (r + armLen), 0);
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.stroke();
      // Fist
      ctx.beginPath();
      ctx.arc(this.facing * (r + armLen), 0, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#7c3aed';
      ctx.fill();
    }

    ctx.restore();
  }
}
