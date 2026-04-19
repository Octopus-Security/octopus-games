export function drawHUD(
  ctx: CanvasRenderingContext2D,
  score: number,
  hp: number,
  maxHp: number,
  wave: number,
  waveTimer: number,
  punchCooldownPct: number,
): void {
  const W = ctx.canvas.width;

  ctx.save();

  // Score
  ctx.font = 'bold 28px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(String(score), W / 2, 40);
  ctx.font = '13px monospace';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('SCORE', W / 2, 56);

  // Wave info
  ctx.font = '14px monospace';
  ctx.fillStyle = '#60a5fa';
  ctx.textAlign = 'left';
  ctx.fillText(`WAVE ${wave}`, 20, 32);
  ctx.fillStyle = '#374151';
  ctx.font = '13px monospace';
  ctx.fillText(`${Math.ceil(waveTimer)}s`, 20, 50);

  // HP hearts
  ctx.textAlign = 'right';
  ctx.font = '22px serif';
  for (let i = 0; i < maxHp; i++) {
    ctx.globalAlpha = i < hp ? 1 : 0.25;
    ctx.fillText('❤️', W - 14 - i * 28, 36);
  }
  ctx.globalAlpha = 1;

  // Punch cooldown bar
  if (punchCooldownPct > 0) {
    const barW = 80;
    const barX = W / 2 - barW / 2;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(barX, 68, barW, 6);
    ctx.fillStyle = '#7c3aed';
    ctx.fillRect(barX, 68, barW * (1 - punchCooldownPct), 6);
  }

  ctx.restore();
}

export function drawWaveBanner(ctx: CanvasRenderingContext2D, wave: number, alpha: number): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = 'bold 52px monospace';
  ctx.fillStyle = '#60a5fa';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`WAVE ${wave}`, W / 2, H / 2);
  ctx.font = '22px monospace';
  ctx.fillStyle = '#93c5fd';
  ctx.fillText('incoming!', W / 2, H / 2 + 52);
  ctx.restore();
}

export function drawGameOver(ctx: CanvasRenderingContext2D, score: number, highScore: number): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.fillStyle = 'rgba(3,7,18,0.75)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = 'bold 56px monospace';
  ctx.fillStyle = '#ef4444';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 60);
  ctx.font = 'bold 36px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`Score: ${score}`, W / 2, H / 2);
  ctx.font = '22px monospace';
  ctx.fillStyle = '#6b7280';
  ctx.fillText(`Best: ${Math.max(score, highScore)}`, W / 2, H / 2 + 44);
  ctx.font = '18px monospace';
  ctx.fillStyle = '#60a5fa';
  ctx.fillText('Press Space or Enter to play again', W / 2, H / 2 + 90);
  ctx.restore();
}
