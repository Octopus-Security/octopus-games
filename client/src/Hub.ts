import { logout, type User } from './auth';
import { launchOctopusPunch } from './games/octopus-punch/index';
import { launchMinesweeper } from './games/minesweeper/index';
import { launchSudoku } from './games/sudoku/index';
import { launchBlackjack } from './games/blackjack/index';
import { launchFrogger } from './games/frogger/index';
import { launchGalaga } from './games/galaga/index';

interface GameDef {
  slug: string;
  title: string;
  description: string;
  emoji: string;
  category: string;
  available: boolean;
  launch: (hub: HTMLElement, user: User) => void;
}

const GAMES: GameDef[] = [
  {
    slug: 'octopus-punch',
    title: 'Octopus Punch',
    description: 'Swim through the ocean punching fish. Unlock the mantis shrimp.',
    emoji: '🐙',
    category: 'Action',
    available: true,
    launch: launchOctopusPunch,
  },
  {
    slug: 'minesweeper',
    title: 'Minesweeper',
    description: 'Clear the minefield without hitting a bomb. Easy, Medium, or Hard.',
    emoji: '💣',
    category: 'Puzzle',
    available: true,
    launch: launchMinesweeper,
  },
  {
    slug: 'sudoku',
    title: 'Sudoku',
    description: 'Fill the 9×9 grid with no repeats in any row, column, or box.',
    emoji: '🔢',
    category: 'Puzzle',
    available: true,
    launch: launchSudoku,
  },
  {
    slug: 'blackjack',
    title: 'Blackjack',
    description: 'Beat the dealer to 21 without going bust. Hit, stand, or double.',
    emoji: '🃏',
    category: 'Cards',
    available: true,
    launch: launchBlackjack,
  },
  {
    slug: 'frogger',
    title: 'Frogger',
    description: 'Hop your frog across busy traffic and a river of logs to reach the goal.',
    emoji: '🐸',
    category: 'Arcade',
    available: true,
    launch: launchFrogger,
  },
  {
    slug: 'galaga',
    title: 'Galaga',
    description: 'Defend Earth from waves of diving alien invaders. How far can you go?',
    emoji: '👾',
    category: 'Arcade',
    available: true,
    launch: launchGalaga,
  },
];

const CATEGORIES = ['All', ...Array.from(new Set(GAMES.map(g => g.category)))];

export function renderHub(user: User, onLogout: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'min-h-screen bg-gray-950 text-white';

  let activeCategory = 'All';
  let searchQuery = '';

  el.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
      <span class="font-bold text-blue-400 text-lg">🎮 Octopus Games</span>
      <div class="flex items-center gap-4 flex-1 max-w-md">
        <input id="searchInput" type="text" placeholder="Search games…"
          class="flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-1.5 text-sm text-white outline-none placeholder:text-gray-600" />
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-400">${user.username}</span>
        <button id="logoutBtn" class="text-sm text-gray-500 hover:text-gray-300 transition-colors">Sign out</button>
      </div>
    </nav>
    <main class="max-w-5xl mx-auto px-4 py-10">
      <div class="flex items-center gap-2 mb-6 flex-wrap">
        <span class="text-sm text-gray-500 mr-2">Category:</span>
        ${CATEGORIES.map(cat => `
          <button data-cat="${cat}" class="cat-btn px-3 py-1 rounded-full text-sm font-medium transition-colors ${cat === 'All' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}">${cat}</button>
        `).join('')}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" id="gameGrid"></div>
      <p id="emptyMsg" class="hidden text-center text-gray-600 py-16">No games found.</p>
    </main>
  `;

  el.querySelector('#logoutBtn')!.addEventListener('click', async () => {
    await logout();
    onLogout();
  });

  el.querySelector('#searchInput')!.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    renderGrid();
  });

  el.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = (btn as HTMLElement).dataset.cat!;
      el.querySelectorAll('.cat-btn').forEach(b => {
        const active = b === btn;
        b.className = `cat-btn px-3 py-1 rounded-full text-sm font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`;
      });
      renderGrid();
    });
  });

  function renderGrid() {
    const grid = el.querySelector<HTMLElement>('#gameGrid')!;
    const empty = el.querySelector<HTMLElement>('#emptyMsg')!;
    grid.innerHTML = '';

    const filtered = GAMES.filter(g =>
      (activeCategory === 'All' || g.category === activeCategory) &&
      (searchQuery === '' || g.title.toLowerCase().includes(searchQuery) || g.description.toLowerCase().includes(searchQuery))
    );

    empty.classList.toggle('hidden', filtered.length > 0);

    for (const game of filtered) {
      const card = document.createElement('div');
      card.className = `bg-gray-900 border rounded-2xl p-5 flex flex-col gap-3 transition-all ${game.available ? 'border-gray-700 hover:border-blue-600 cursor-pointer hover:shadow-lg hover:shadow-blue-900/20' : 'border-gray-800 opacity-50'}`;

      const catColor: Record<string, string> = {
        Action: 'bg-orange-900/40 text-orange-400',
        Puzzle: 'bg-blue-900/40 text-blue-400',
        Cards: 'bg-green-900/40 text-green-400',
        Arcade: 'bg-purple-900/40 text-purple-400',
      };

      card.innerHTML = `
        <div class="flex items-start justify-between">
          <span class="text-4xl">${game.emoji}</span>
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${catColor[game.category] ?? 'bg-gray-800 text-gray-400'}">${game.category}</span>
        </div>
        <div>
          <h3 class="text-base font-bold">${game.title}</h3>
          <p class="text-gray-400 text-sm mt-1 leading-relaxed">${game.description}</p>
        </div>
        <button class="mt-auto px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${game.available ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}">
          ${game.available ? 'Play' : 'Coming Soon'}
        </button>
      `;

      if (game.available) {
        card.addEventListener('click', () => game.launch(el, user));
      }
      grid.appendChild(card);
    }
  }

  renderGrid();
  return el;
}
