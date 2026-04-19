import { logout, type User } from './auth';
import { launchOctopusPunch } from './games/octopus-punch/index';

interface GameDef {
  slug: string;
  title: string;
  description: string;
  emoji: string;
  available: boolean;
  launch: (hub: HTMLElement, user: User) => void;
}

const GAMES: GameDef[] = [
  {
    slug: 'octopus-punch',
    title: 'Octopus Punch',
    description: 'Swim through the ocean punching fish. Unlock the mantis shrimp for devastating power.',
    emoji: '🐙',
    available: true,
    launch: launchOctopusPunch,
  },
];

export function renderHub(user: User, onLogout: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'min-h-screen bg-gray-950 text-white';
  el.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <span class="font-bold text-blue-400 text-lg">🐙 Octopus Games</span>
      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-400">${user.username}</span>
        <button id="logoutBtn" class="text-sm text-gray-500 hover:text-gray-300 transition-colors">Sign out</button>
      </div>
    </nav>
    <main class="max-w-4xl mx-auto px-4 py-12">
      <h2 class="text-3xl font-bold mb-2">Games</h2>
      <p class="text-gray-500 mb-8">Pick a game to play</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6" id="gameGrid"></div>
    </main>
  `;

  el.querySelector('#logoutBtn')!.addEventListener('click', async () => {
    await logout();
    onLogout();
  });

  const grid = el.querySelector('#gameGrid')!;
  for (const game of GAMES) {
    const card = document.createElement('div');
    card.className = `bg-gray-900 border rounded-2xl p-6 flex flex-col gap-4 ${game.available ? 'border-gray-700 hover:border-blue-600 cursor-pointer transition-colors' : 'border-gray-800 opacity-50'}`;
    card.innerHTML = `
      <div class="text-5xl">${game.emoji}</div>
      <div>
        <h3 class="text-lg font-bold">${game.title}</h3>
        <p class="text-gray-400 text-sm mt-1">${game.description}</p>
      </div>
      <button class="mt-auto px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${game.available ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}">
        ${game.available ? 'Play' : 'Coming Soon'}
      </button>
    `;
    if (game.available) {
      card.addEventListener('click', () => game.launch(el, user));
    }
    grid.appendChild(card);
  }

  return el;
}
