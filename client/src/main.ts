import './style.css';
import { getUser } from './auth';
import { renderHub } from './Hub';
import { renderServerShare } from './ServerShare';
import { renderPlay } from './play/PlayPage';

const app = document.getElementById('app')!;

async function boot(): Promise<void> {
  app.innerHTML = '<div class="min-h-screen flex items-center justify-center"><div class="text-gray-500 text-lg">Loading…</div></div>';

  // Per-server public share page: /server/:id (no login needed for public servers)
  const shareMatch = location.pathname.match(/^\/server\/([^/]+)\/?$/);
  if (shareMatch) {
    app.innerHTML = '';
    app.appendChild(renderServerShare(shareMatch[1]));
    return;
  }

  // Multiplayer match page (/play/m/:id) and invite link (/play/i/:token). Both work
  // without an account; the page itself works out who you are.
  const playMatch = location.pathname.match(/^\/play\/m\/([0-9a-f-]{36})\/?$/);
  const playInvite = location.pathname.match(/^\/play\/i\/([A-Za-z0-9_-]{32})\/?$/);
  if (playMatch || playInvite) {
    const who = await getUser().catch(() => null);
    app.innerHTML = '';
    app.appendChild(renderPlay(playMatch ? { kind: 'm', id: playMatch[1] } : { kind: 'i', token: playInvite![1] }, who));
    return;
  }

  // Login is optional — guests can browse public game servers
  const user = await getUser().catch(() => null);
  showHub(user);
}

function showHub(user: { username: string; role?: string } | null): void {
  app.innerHTML = '';
  app.appendChild(renderHub(user, () => boot()));
}

boot();
