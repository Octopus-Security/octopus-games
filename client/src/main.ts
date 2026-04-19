import './style.css';
import { getUser } from './auth';
import { renderLogin } from './Login';
import { renderHub } from './Hub';

const app = document.getElementById('app')!;

async function boot(): Promise<void> {
  app.innerHTML = '<div class="min-h-screen flex items-center justify-center"><div class="text-gray-500 text-lg">Loading…</div></div>';

  const user = await getUser();
  if (!user) {
    showLogin();
  } else {
    showHub(user.username);
  }
}

function showLogin(): void {
  app.innerHTML = '';
  app.appendChild(renderLogin(() => boot()));
}

function showHub(username: string): void {
  app.innerHTML = '';
  app.appendChild(renderHub({ username }, showLogin));
}

boot();
