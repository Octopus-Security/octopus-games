import './style.css';
import { getUser } from './auth';
import { renderHub } from './Hub';
import { renderServerShare } from './ServerShare';

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

  // Login is optional — guests can browse public game servers
  const user = await getUser().catch(() => null);
  showHub(user);
}

function showHub(user: { username: string; role?: string } | null): void {
  app.innerHTML = '';
  app.appendChild(renderHub(user, () => boot()));
}

boot();
