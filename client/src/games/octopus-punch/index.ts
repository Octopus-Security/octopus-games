import { Game } from './Game';
import type { User } from '../../auth';

export function launchOctopusPunch(hubEl: HTMLElement, _user: User): void {
  hubEl.style.display = 'none';

  // Canvas setup
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#030712;';
  document.body.appendChild(canvas);

  function resize(): void {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Back button overlay
  const backBtn = document.createElement('button');
  backBtn.textContent = '← Hub';
  backBtn.style.cssText = `
    position:fixed;top:12px;left:12px;z-index:100;
    background:rgba(17,24,39,0.85);border:1px solid #374151;
    color:#9ca3af;padding:6px 14px;border-radius:8px;
    font-size:13px;cursor:pointer;backdrop-filter:blur(4px);
  `;
  document.body.appendChild(backBtn);

  backBtn.addEventListener('click', () => {
    window.removeEventListener('resize', resize);
    cancelAnimationFrame(rafId);
    canvas.remove();
    backBtn.remove();
    hubEl.style.display = '';
  });

  const game = new Game(canvas);

  let last = performance.now();
  let rafId = 0;

  function loop(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    game.update(dt);
    game.draw();
    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);
}
