import { logout, goToLogin, type User } from './auth';
import { renderReference } from './Reference';
import { openShareModal, type ShareMod } from './serverShareCard';
import { launchOctopusPunch } from './games/octopus-punch/index';
import { launchMinesweeper } from './games/minesweeper/index';
import { launchSudoku } from './games/sudoku/index';
import { launchBlackjack } from './games/blackjack/index';
import { launchFrogger } from './games/frogger/index';
import { launchGalaga } from './games/galaga/index';

const ADMIN_USERNAME = 'psychopathy';

interface GameDef {
  slug: string;
  title: string;
  description: string;
  emoji: string;
  category: string;
  available: boolean;
  launch: (hub: HTMLElement, user: User) => void;
}

interface GameServer {
  id: number;
  name: string;
  game: string;
  label: string;
  emoji: string;
  status: string;
  visibility?: string;
  allowedUsers?: string;
  // Only present when logged in
  serverIP?: string;
  port?: number;
  password?: string;
  gameVersion?: string;
  description?: string;
  modPlatform?: string | null;
  mods?: ShareMod[];
  modpackUrl?: string;
  loader?: string;
  instructions?: string[];
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

async function fetchServers(): Promise<GameServer[]> {
  try {
    const res = await fetch('/api/public/game-servers');
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

type ArcadeAccess = 'public' | 'members' | 'whitelist';
interface ArcadeSetting { access: ArcadeAccess; allowedUsers: string; }

async function fetchArcadeVisibility(): Promise<Record<string, ArcadeSetting>> {
  try {
    const res = await fetch('/api/public/arcade-visibility');
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

async function setArcadeVisibility(slug: string, access: ArcadeAccess, allowedUsers: string): Promise<void> {
  await fetch('/api/admin/arcade-visibility', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, access, allowedUsers }),
  });
}

function canPlayArcade(setting: ArcadeSetting | undefined, user: User | null): boolean {
  const access = setting?.access ?? 'public'; // default public
  if (access === 'public') return true;
  if (!user) return false;
  if (access === 'members') return true;
  // whitelist
  const allowed = (setting?.allowedUsers || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(user.username.toLowerCase());
}

function statusBadge(status: string): string {
  if (status === 'running') return '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-400 border border-green-800">Online</span>';
  if (status === 'exited' || status === 'stopped') return '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/50 text-red-400 border border-red-800">Offline</span>';
  return '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-500 border border-gray-700">Unknown</span>';
}

interface AccountRow { id: number; username: string; role: string; }
let accountsCache: AccountRow[] | null = null;
async function fetchAccounts(): Promise<AccountRow[]> {
  if (accountsCache) return accountsCache;
  try {
    const r = await fetch('/api/admin/users');
    accountsCache = r.ok ? await r.json() : [];
  } catch { accountsCache = []; }
  return accountsCache!;
}

// Searchable chip selector for the whitelist. Renders into `mount`, seeded
// with `initial` usernames; getValue() returns the current comma-joined list.
// Falls back to a plain text input if the account list can't be fetched.
function buildWhitelistPicker(mount: HTMLElement, initial: string): { getValue: () => string } {
  const selected = initial.split(',').map(u => u.trim()).filter(Boolean);

  mount.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2 w-full';
  mount.appendChild(wrap);

  fetchAccounts().then(accounts => {
    if (!accounts.length) {
      // No account list available — plain comma-separated fallback.
      const input = document.createElement('input');
      input.type = 'text';
      input.value = selected.join(',');
      input.placeholder = 'user1,user2';
      input.className = 'w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 outline-none';
      wrap.appendChild(input);
      getValueImpl = () => input.value;
      return;
    }

    const chips = document.createElement('div');
    chips.className = 'flex flex-wrap gap-1';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'relative';
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search accounts to add…';
    search.className = 'w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 outline-none';
    const menu = document.createElement('div');
    menu.className = 'absolute left-0 right-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded-lg max-h-48 overflow-y-auto z-10 hidden';
    searchWrap.appendChild(search);
    searchWrap.appendChild(menu);
    wrap.appendChild(chips);
    wrap.appendChild(searchWrap);

    function drawChips() {
      chips.innerHTML = '';
      if (!selected.length) {
        chips.innerHTML = '<span class="text-xs text-gray-600">No accounts selected yet.</span>';
      }
      selected.forEach(u => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1 text-xs bg-blue-900/50 text-blue-200 border border-blue-800 rounded-full px-2 py-0.5';
        chip.innerHTML = `${u} <button class="text-blue-300 hover:text-white leading-none">×</button>`;
        chip.querySelector('button')!.addEventListener('click', () => {
          const i = selected.indexOf(u);
          if (i > -1) selected.splice(i, 1);
          drawChips();
        });
        chips.appendChild(chip);
      });
    }

    function drawMenu() {
      const q = search.value.trim().toLowerCase();
      const matches = accounts
        .filter(a => !selected.includes(a.username))
        .filter(a => !q || a.username.toLowerCase().includes(q))
        .slice(0, 30);
      menu.innerHTML = '';
      if (!matches.length) { menu.classList.add('hidden'); return; }
      matches.forEach(a => {
        const item = document.createElement('button');
        item.className = 'block w-full text-left text-xs text-gray-300 hover:bg-gray-800 px-2 py-1.5';
        item.textContent = a.username + (a.role === 'admin' ? ' (admin)' : '');
        item.addEventListener('click', () => {
          selected.push(a.username);
          search.value = '';
          menu.classList.add('hidden');
          drawChips();
        });
        menu.appendChild(item);
      });
      menu.classList.remove('hidden');
    }

    search.addEventListener('focus', drawMenu);
    search.addEventListener('input', drawMenu);
    search.addEventListener('blur', () => setTimeout(() => menu.classList.add('hidden'), 150));
    drawChips();
    getValueImpl = () => selected.join(',');
  });

  let getValueImpl: () => string = () => selected.join(',');
  return { getValue: () => getValueImpl() };
}

function renderServerCard(s: GameServer, user: User | null, isAdmin: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'bg-gray-900 border border-gray-700 rounded-2xl p-5 flex flex-col gap-3';

  const connectionInfo = user && s.serverIP
    ? `<div class="mt-1 space-y-1">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500 w-16 shrink-0">Address</span>
          <code class="text-sm text-blue-300 font-mono bg-gray-800 px-2 py-0.5 rounded select-all">${s.serverIP}:${s.port}</code>
        </div>
        ${s.password ? `<div class="flex items-center gap-2">
          <span class="text-xs text-gray-500 w-16 shrink-0">Password</span>
          <code class="text-sm text-yellow-300 font-mono bg-gray-800 px-2 py-0.5 rounded select-all">${s.password}</code>
        </div>` : ''}
        ${s.gameVersion ? `<div class="flex items-center gap-2">
          <span class="text-xs text-gray-500 w-16 shrink-0">Version</span>
          <span class="text-xs text-gray-400">${s.gameVersion}</span>
        </div>` : ''}
      </div>`
    : !user
      ? '<p class="text-xs text-gray-600 mt-1">Sign in to see connection details</p>'
      : '';

  const vis = s.visibility || 'private';
  const adminRow = isAdmin
    ? `<div class="flex flex-col gap-2 mt-1 pt-3 border-t border-gray-800">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-gray-600">Who can see:</span>
          <select data-server-id="${s.id}" class="visibility-select text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300">
            <option value="public" ${vis === 'public' ? 'selected' : ''}>Public — anyone</option>
            <option value="members" ${vis === 'members' ? 'selected' : ''}>Members — any account</option>
            <option value="whitelist" ${vis === 'whitelist' ? 'selected' : ''}>Whitelist — specific accounts</option>
            <option value="private" ${vis === 'private' ? 'selected' : ''}>Private — admin only</option>
          </select>
          <button data-server-id="${s.id}" class="save-visibility-btn text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors">Save</button>
        </div>
        <div class="whitelist-wrap flex flex-col gap-1 ${vis === 'whitelist' ? '' : 'hidden'}">
          <span class="text-xs text-gray-600">Accounts allowed to see this server:</span>
          <div class="whitelist-mount"></div>
        </div>
      </div>`
    : '';

  card.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-3xl">${s.emoji}</span>
        <div>
          <h3 class="text-base font-bold text-white leading-tight">${s.name}</h3>
          <span class="text-xs text-gray-500">${s.label}</span>
        </div>
      </div>
      ${statusBadge(s.status)}
    </div>
    ${s.description ? `<p class="text-sm text-gray-400 leading-relaxed">${s.description}</p>` : ''}
    ${connectionInfo}
    <div class="mt-1">
      <button class="share-btn text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-colors inline-flex items-center gap-1">🔗 Share</button>
    </div>
    ${adminRow}
  `;

  card.querySelector('.share-btn')?.addEventListener('click', () => openShareModal(s));

  if (isAdmin) {
    const select = card.querySelector('.visibility-select') as HTMLSelectElement;
    const whitelistWrap = card.querySelector('.whitelist-wrap') as HTMLElement;
    const mount = card.querySelector('.whitelist-mount') as HTMLElement;
    const picker = buildWhitelistPicker(mount, s.allowedUsers || '');

    select?.addEventListener('change', () => {
      whitelistWrap?.classList.toggle('hidden', select.value !== 'whitelist');
    });

    card.querySelector('.save-visibility-btn')?.addEventListener('click', async (e) => {
      const btn = e.target as HTMLButtonElement;
      const id = btn.dataset.serverId;
      const visibility = select?.value;
      // Only send a whitelist when that mode is selected.
      const allowedUsers = visibility === 'whitelist' ? picker.getValue() : (s.allowedUsers || '');
      btn.textContent = '…';
      try {
        await fetch(`/api/admin/game-servers/${id}/visibility`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility, allowedUsers }),
        });
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = 'Save'; }, 1500);
      } catch {
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = 'Save'; }, 1500);
      }
    });
  }

  return card;
}

export function renderHub(user: User | null, onRefresh: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'min-h-screen bg-gray-950 text-white';
  const isAdmin = !!user && (user.username === ADMIN_USERNAME || user.role === 'admin');

  let activeCategory = 'All';
  let searchQuery = '';

  el.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
      <span class="font-bold text-blue-400 text-lg">🐙 Octopus Games</span>
      <div class="flex items-center gap-2">
        <button id="tabServers" class="tab-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors bg-blue-600 text-white">Servers</button>
        <button id="tabGames" class="tab-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors bg-gray-800 text-gray-400 hover:text-white border border-gray-700">Arcade</button>
        <button id="tabRef" class="tab-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors bg-gray-800 text-gray-400 hover:text-white border border-gray-700">Reference</button>
      </div>
      <div class="flex items-center gap-4">
        ${user
          ? `<span class="text-sm text-gray-400">${user.username}${isAdmin ? ' <span class="text-xs text-blue-400">(admin)</span>' : ''}</span>
             <button id="logoutBtn" class="text-sm text-gray-500 hover:text-gray-300 transition-colors">Sign out</button>`
          : `<button id="registerBtn" class="text-sm text-gray-400 hover:text-white transition-colors">Create account</button>
             <button id="loginBtn" class="text-sm px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded-lg transition-colors">Sign in</button>`
        }
      </div>
    </nav>
    <main class="max-w-5xl mx-auto px-4 py-10">
      <!-- Servers tab -->
      <div id="serversTab">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-bold text-white">Game Servers</h2>
          <button id="refreshServers" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">↻ Refresh</button>
        </div>
        <div id="serverGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <div class="col-span-full text-center text-gray-600 py-12">Loading servers…</div>
        </div>
      </div>
      <!-- Reference tab -->
      <div id="refTab" class="hidden"></div>
      <!-- Arcade tab -->
      <div id="arcadeTab" class="hidden">
        <div class="flex items-center gap-2 mb-6 flex-wrap">
          <input id="searchInput" type="text" placeholder="Search games…"
            class="bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-1.5 text-sm text-white outline-none placeholder:text-gray-600 w-48 mr-2" />
          <span class="text-sm text-gray-500 mr-1">Category:</span>
          ${CATEGORIES.map(cat => `
            <button data-cat="${cat}" class="cat-btn px-3 py-1 rounded-full text-sm font-medium transition-colors ${cat === 'All' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}">${cat}</button>
          `).join('')}
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" id="gameGrid"></div>
        <p id="emptyMsg" class="hidden text-center text-gray-600 py-16">No games found.</p>
      </div>
    </main>
  `;

  // Tab switching
  const serversTab = el.querySelector('#serversTab') as HTMLElement;
  const arcadeTab  = el.querySelector('#arcadeTab')  as HTMLElement;
  const refTab     = el.querySelector('#refTab')     as HTMLElement;
  const tabServersBtn = el.querySelector('#tabServers') as HTMLButtonElement;
  const tabGamesBtn   = el.querySelector('#tabGames')   as HTMLButtonElement;
  const tabRefBtn     = el.querySelector('#tabRef')     as HTMLButtonElement;

  type Tab = 'servers' | 'games' | 'ref';
  let refRendered = false;

  function switchTab(tab: Tab) {
    serversTab.classList.toggle('hidden', tab !== 'servers');
    arcadeTab.classList.toggle('hidden',  tab !== 'games');
    refTab.classList.toggle('hidden',     tab !== 'ref');
    const active = 'bg-blue-600 text-white';
    const inactive = 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700';
    tabServersBtn.className = `tab-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === 'servers' ? active : inactive}`;
    tabGamesBtn.className   = `tab-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === 'games'   ? active : inactive}`;
    tabRefBtn.className     = `tab-btn px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === 'ref'     ? active : inactive}`;
    if (tab === 'ref' && !refRendered) {
      refTab.appendChild(renderReference(user, isAdmin));
      refRendered = true;
    }
  }

  tabServersBtn.addEventListener('click', () => switchTab('servers'));
  tabGamesBtn.addEventListener('click',   () => switchTab('games'));
  tabRefBtn.addEventListener('click',     () => switchTab('ref'));

  // Auth
  el.querySelector('#logoutBtn')?.addEventListener('click', async () => {
    await logout();
    onRefresh();
  });

  // Login/register happen on the central SSO page; both return here afterwards.
  el.querySelector('#loginBtn')?.addEventListener('click', () => goToLogin(false));
  el.querySelector('#registerBtn')?.addEventListener('click', () => goToLogin(true));

  // Servers
  const serverGrid = el.querySelector('#serverGrid') as HTMLElement;

  async function loadServers() {
    serverGrid.innerHTML = '<div class="col-span-full text-center text-gray-600 py-12">Loading servers…</div>';
    const servers = await fetchServers();
    serverGrid.innerHTML = '';
    if (servers.length === 0) {
      serverGrid.innerHTML = '<div class="col-span-full text-center text-gray-700 py-12">No public servers right now.</div>';
      return;
    }
    for (const s of servers) {
      serverGrid.appendChild(renderServerCard(s as GameServer & { allowedUsers?: string }, user, isAdmin));
    }
  }

  el.querySelector('#refreshServers')?.addEventListener('click', loadServers);
  loadServers();

  // Arcade grid
  let arcadeVisibility: Record<string, ArcadeSetting> = {};

  fetchArcadeVisibility().then(v => {
    arcadeVisibility = v;
    renderGrid();
  });

  el.querySelector('#searchInput')?.addEventListener('input', (e) => {
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

  const catColor: Record<string, string> = {
    Action: 'bg-orange-900/40 text-orange-400',
    Puzzle: 'bg-blue-900/40 text-blue-400',
    Cards: 'bg-green-900/40 text-green-400',
    Arcade: 'bg-purple-900/40 text-purple-400',
  };

  const ACCESS_LABELS: Record<string, string> = { public: 'Public', members: 'Members', whitelist: 'Whitelist' };
  const ACCESS_COLORS: Record<string, string> = {
    public: 'bg-green-900/50 text-green-300 border border-green-800',
    members: 'bg-blue-900/50 text-blue-300 border border-blue-800',
    whitelist: 'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  };

  function renderGrid() {
    const grid = el.querySelector<HTMLElement>('#gameGrid')!;
    const empty = el.querySelector<HTMLElement>('#emptyMsg')!;
    grid.innerHTML = '';

    const visibleGames = GAMES.filter(g => {
      if (!isAdmin && !canPlayArcade(arcadeVisibility[g.slug], user)) return false;
      return (activeCategory === 'All' || g.category === activeCategory) &&
        (searchQuery === '' || g.title.toLowerCase().includes(searchQuery) || g.description.toLowerCase().includes(searchQuery));
    });

    empty.classList.toggle('hidden', visibleGames.length > 0);

    for (const game of visibleGames) {
      const setting = arcadeVisibility[game.slug];
      const access: ArcadeAccess = setting?.access ?? 'public';
      const allowedUsers = setting?.allowedUsers ?? '';
      const canPlay = canPlayArcade(setting, user);

      const card = document.createElement('div');
      card.className = `bg-gray-900 border rounded-2xl p-5 flex flex-col gap-3 transition-all ${game.available ? 'border-gray-700 hover:border-blue-600 cursor-pointer hover:shadow-lg hover:shadow-blue-900/20' : 'border-gray-800 opacity-50'}`;

      const adminToggle = isAdmin ? `
        <div class="flex flex-col gap-2 pt-2 border-t border-gray-800">
          <div class="flex items-center gap-1">
            ${(['public', 'members', 'whitelist'] as ArcadeAccess[]).map(a => `
              <button data-slug="${game.slug}" data-access="${a}" class="access-btn text-xs px-2 py-0.5 rounded font-medium transition-colors ${access === a ? ACCESS_COLORS[a] : 'bg-gray-800 text-gray-500 border border-gray-700'}">
                ${ACCESS_LABELS[a]}
              </button>`).join('')}
          </div>
          ${access === 'whitelist' ? `
            <div class="flex items-center gap-1">
              <input type="text" class="whitelist-input flex-1 text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 outline-none" placeholder="user1,user2" value="${allowedUsers}" data-slug="${game.slug}"/>
              <button class="whitelist-save text-xs px-2 py-1 bg-yellow-800 hover:bg-yellow-700 text-yellow-200 rounded" data-slug="${game.slug}">Save</button>
            </div>` : ''}
        </div>` : '';

      card.innerHTML = `
        <div class="flex items-start justify-between">
          <span class="text-4xl">${game.emoji}</span>
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${catColor[game.category] ?? 'bg-gray-800 text-gray-400'}">${game.category}</span>
        </div>
        <div>
          <h3 class="text-base font-bold">${game.title}</h3>
          <p class="text-gray-400 text-sm mt-1 leading-relaxed">${game.description}</p>
        </div>
        <button class="play-btn mt-auto px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${game.available && canPlay ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}">
          ${game.available ? (canPlay ? 'Play' : '🔒 No access') : 'Coming Soon'}
        </button>
        ${adminToggle}
      `;

      if (game.available && canPlay) {
        card.querySelector('.play-btn')!.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!user) goToLogin(false);
          else game.launch(el, user);
        });
      }

      if (isAdmin) {
        card.querySelectorAll('.access-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const b = e.target as HTMLButtonElement;
            const slug = b.dataset.slug!;
            const newAccess = b.dataset.access as ArcadeAccess;
            await setArcadeVisibility(slug, newAccess, arcadeVisibility[slug]?.allowedUsers ?? '');
            arcadeVisibility[slug] = { access: newAccess, allowedUsers: arcadeVisibility[slug]?.allowedUsers ?? '' };
            renderGrid();
          });
        });

        card.querySelector('.whitelist-save')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          const btn = e.target as HTMLButtonElement;
          const slug = btn.dataset.slug!;
          const input = card.querySelector('.whitelist-input') as HTMLInputElement;
          const users = input?.value ?? '';
          btn.textContent = '…';
          await setArcadeVisibility(slug, 'whitelist', users);
          arcadeVisibility[slug] = { access: 'whitelist', allowedUsers: users };
          btn.textContent = '✓';
          setTimeout(() => renderGrid(), 800);
        });
      }

      grid.appendChild(card);
    }
  }

  renderGrid();
  return el;
}
