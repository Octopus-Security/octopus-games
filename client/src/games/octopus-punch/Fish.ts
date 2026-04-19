export type FishType = 'clownfish' | 'pufferfish' | 'shark' | 'fancy';

interface FishDef {
  label: string;
  emoji: string;
  points: number;
  hp: number;
  speed: number;
  radius: number;
  color: string;
}

export const FISH_DEFS: Record<FishType, FishDef> = {
  clownfish: { label: 'Clownfish', emoji: '🐟', points: 10,  hp: 1, speed: 80,  radius: 18, color: '#f97316' },
  pufferfish: { label: 'Pufferfish', emoji: '🐡', points: 25, hp: 2, speed: 55,  radius: 24, color: '#eab308' },
  shark:      { label: 'Shark',      emoji: '🦈', points: 50, hp: 3, speed: 130, radius: 28, color: '#6b7280' },
  fancy:      { label: 'Fancy Fish', emoji: '🐠', points: 75, hp: 1, speed: 180, radius: 16, color: '#a855f7' },
};

export class Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  stunTimer = 0;
  flashTimer = 0;
  dead = false;

  readonly type: FishType;
  readonly def: FishDef;

  constructor(type: FishType, x: number, y: number, targetX: number, targetY: number) {
    this.type = type;
    this.def = FISH_DEFS[type];
    this.x = x;
    this.y = y;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;

    const dx = targetX - x;
    const dy = targetY - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = this.def.speed * (0.8 + Math.random() * 0.4);
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;
  }

  get radius(): number { return this.def.radius; }
  get points(): number { return this.def.points; }

  update(dt: number, canvasW: number, canvasH: number): void {
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.flashTimer -= dt;
      return;
    }
    this.flashTimer -= dt;

    // Sine-wave drift for pufferfish and fancy
    if (this.type === 'pufferfish' || this.type === 'fancy') {
      const perp = { x: -this.vy, y: this.vx };
      const len = Math.sqrt(perp.x * perp.x + perp.y * perp.y) || 1;
      const amplitude = 60;
      const freq = this.type === 'fancy' ? 4 : 2;
      this.x += this.vx * dt + (perp.x / len) * amplitude * Math.sin(Date.now() / 1000 * freq) * dt;
      this.y += this.vy * dt + (perp.y / len) * amplitude * Math.sin(Date.now() / 1000 * freq) * dt;
    } else {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    // Despawn if far off screen
    const margin = 100;
    if (this.x < -margin || this.x > canvasW + margin || this.y < -margin || this.y > canvasH + margin) {
      this.dead = true;
    }
  }

  hit(knockbackX: number, knockbackY: number): boolean {
    this.hp--;
    this.flashTimer = 0.15;
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    this.stunTimer = 0.25;
    this.vx = knockbackX * 200;
    this.vy = knockbackY * 200;
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.radius;
    const flashing = this.flashTimer > 0 && Math.floor(this.flashTimer / 0.05) % 2 === 0;

    ctx.save();
    ctx.translate(this.x, this.y);

    if (flashing) {
      ctx.globalAlpha = 0.4;
    }

    // Body circle
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = this.def.color;
    ctx.fill();

    // Pufferfish expanded when hp < max
    if (this.type === 'pufferfish' && this.hp < this.maxHp) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Emoji label
    ctx.font = `${r * 1.4}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.def.emoji, 0, 0);

    // HP dots (for multi-hp fish)
    if (this.maxHp > 1) {
      for (let i = 0; i < this.maxHp; i++) {
        ctx.beginPath();
        ctx.arc(-((this.maxHp - 1) * 6) + i * 12, r + 8, 4, 0, Math.PI * 2);
        ctx.fillStyle = i < this.hp ? '#ef4444' : '#374151';
        ctx.fill();
      }
    }

    ctx.restore();
  }
}
