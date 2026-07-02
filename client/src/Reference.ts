// Reference panel: wiki search, Pokédex, RoR2 char unlocks, per-user controls
import { renderCrafting } from './Crafting';

interface User { username: string; role?: string; }

type SubTab = 'wiki' | 'pokedex' | 'ror2' | 'controls' | 'setup' | 'crafting';

interface SetupGuide { game: string; emoji: string; steps: string[]; }

const SETUP_GUIDES: SetupGuide[] = [
  { game: 'Terraria (Vanilla)', emoji: '🌳', steps: [
    'Open Terraria.',
    'Click Multiplayer → Join via IP.',
    'Enter the server IP and port shown on the server card.',
    'Enter the password if one is listed.',
  ]},
  { game: 'Terraria (tModLoader)', emoji: '⚙️', steps: [
    'Install tModLoader free from Steam (search "tModLoader").',
    'Open tModLoader → Workshop → Mod Browser.',
    'Enable exactly the mods listed on the server card, then click Reload Mods.',
    'Go to Multiplayer → Join via IP and enter the address.',
    'Your enabled mods must match the server exactly or you will be kicked.',
  ]},
  { game: 'Minecraft (Vanilla)', emoji: '⛏️', steps: [
    'Open the Minecraft Launcher and launch the version listed on the card.',
    'Click Multiplayer → Add Server.',
    'Paste the server address (IP:port).',
    'Click Done, then join.',
  ]},
  { game: 'Minecraft (Modded)', emoji: '🧱', steps: [
    'Install the modpack + loader (Forge/Fabric) for the version listed.',
    'Use the modpack download link on the card if provided.',
    'Launch through a modpack launcher (CurseForge, Prism, ATLauncher).',
    'Multiplayer → Add Server → paste the address.',
    'You must use the exact same modpack version as the server.',
  ]},
  { game: 'Risk of Rain 2', emoji: '🌧️', steps: [
    'Install r2modman (Thunderstore Mod Manager): thunderstore.io/package/ebkr/r2modman/',
    'Open r2modman → select Risk of Rain 2 → create a profile.',
    'Install each mod listed on the server card.',
    'Launch the game through r2modman (not directly from Steam).',
    'In-game: Multiplayer → Join → Direct Connection → enter the address.',
  ]},
  { game: 'Stardew Valley', emoji: '🌾', steps: [
    'Install SMAPI: smapi.io',
    'Install each Nexus mod listed on the card into [Stardew Valley]/Mods/.',
    'Launch through SMAPI (not directly from Steam).',
    'Load a farm, then Co-op → Join LAN Game → enter the address.',
  ]},
  { game: "Garry's Mod", emoji: '🔫', steps: [
    'Subscribe to the Workshop collection on the card (installs all addons).',
    "Launch Garry's Mod.",
    'Open the console with ~ and type: connect <address>',
    'Or use Find Multiplayer Game and search for the server name.',
  ]},
];

const GAMES = [
  { id: 'terraria',  label: 'Terraria',        emoji: '🌿' },
  { id: 'calamity',  label: 'Calamity Mod',    emoji: '✏️' },
  { id: 'minecraft', label: 'Minecraft',        emoji: '⛏️' },
  { id: 'tekkit',    label: 'Tekkit',           emoji: '⚙️' },
  { id: 'ror2',      label: 'Risk of Rain 2',   emoji: '🌧️' },
  { id: 'isaac',     label: 'Binding of Isaac', emoji: '😢' },
  { id: 'pokemon',   label: 'Pokémon',          emoji: '⚡' },
];

const TYPE_COLORS: Record<string, string> = {
  fire:'#e25822',water:'#6390f0',grass:'#7ac74c',electric:'#f7d02c',
  psychic:'#f95587',ice:'#96d9d6',dragon:'#6f35fc',dark:'#705746',
  fairy:'#d685ad',normal:'#a8a77a',fighting:'#c22e28',flying:'#a98ff3',
  poison:'#a33ea1',ground:'#e2bf65',rock:'#b6a136',bug:'#a6b91a',
  ghost:'#735797',steel:'#b7b7ce',
};

async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((e as { error?: string }).error || r.statusText);
  }
  return r.json() as Promise<T>;
}

async function apiPut(path: string, body: unknown) {
  const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((e as { error?: string }).error || r.statusText);
  }
}

async function apiDelete(path: string) {
  const r = await fetch(path, { method: 'DELETE' });
  if (!r.ok) throw new Error(r.statusText);
}

function chip(label: string, active: boolean, onClick: () => void, extra = ''): HTMLElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = `px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
    active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}  ${extra}`;
  b.addEventListener('click', onClick);
  return b;
}

// ── Wiki Search ───────────────────────────────────────────────────────────────

function renderWikiSearch(container: HTMLElement) {
  let activeGame = GAMES[0].id;
  let page: { title: string; extract: string; url: string; wikiName: string } | null = null;

  function render() {
    container.innerHTML = '';

    // Game chips
    const picker = document.createElement('div');
    picker.className = 'flex flex-wrap gap-2 mb-4';
    GAMES.forEach(g => picker.appendChild(chip(`${g.emoji} ${g.label}`, g.id === activeGame, () => { activeGame = g.id; page = null; render(); })));
    container.appendChild(picker);

    if (page) {
      // Page view
      const card = document.createElement('div');
      card.className = 'bg-gray-900 border border-gray-700 rounded-xl p-5';
      card.innerHTML = `
        <div class="flex justify-between items-start mb-3 gap-3">
          <h3 class="text-base font-bold text-white">${page.title}</h3>
          <button id="backBtn" class="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-2 py-1 shrink-0">← Back</button>
        </div>
        <p class="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap mb-4">${page.extract || 'No content available.'}</p>
        <a href="${page.url}" target="_blank" rel="noopener" class="text-xs text-blue-400 hover:underline">Open on ${page.wikiName} ↗</a>
      `;
      card.querySelector('#backBtn')!.addEventListener('click', () => { page = null; render(); });
      container.appendChild(card);
      return;
    }

    // Search bar
    const searchRow = document.createElement('div');
    searchRow.className = 'flex gap-2 mb-5';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Search ${GAMES.find(g => g.id === activeGame)?.label ?? ''} wiki…`;
    input.className = 'flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 min-w-0';
    const btn = document.createElement('button');
    btn.textContent = '🔍';
    btn.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm shrink-0 transition-colors';
    const results = document.createElement('div');
    results.className = 'flex flex-col gap-2';
    const errEl = document.createElement('p');
    errEl.className = 'text-sm text-red-400 hidden';

    async function doSearch() {
      const q = input.value.trim();
      if (!q) return;
      btn.textContent = '…';
      btn.setAttribute('disabled', '');
      errEl.classList.add('hidden');
      results.innerHTML = '';
      try {
        const data = await apiFetch<{ hits: { title: string; snippet: string; url: string }[]; wikiName: string }>(`/api/wiki/search?game=${activeGame}&q=${encodeURIComponent(q)}`);
        if (!data.hits.length) { results.innerHTML = '<p class="text-sm text-gray-600">No results.</p>'; }
        data.hits.forEach(h => {
          const card = document.createElement('div');
          card.className = 'bg-gray-900 border border-gray-700 hover:border-blue-600 rounded-xl p-4 cursor-pointer transition-colors';
          card.innerHTML = `<p class="font-semibold text-sm text-white mb-1">${h.title}</p><p class="text-xs text-gray-500 leading-relaxed">${h.snippet}</p>`;
          card.addEventListener('click', async () => {
            btn.textContent = '…';
            try {
              page = await apiFetch(`/api/wiki/page?game=${activeGame}&title=${encodeURIComponent(h.title)}`);
              render();
            } catch (e: unknown) { errEl.textContent = (e as Error).message; errEl.classList.remove('hidden'); }
            btn.textContent = '🔍';
          });
          results.appendChild(card);
        });
      } catch (e: unknown) { errEl.textContent = (e as Error).message; errEl.classList.remove('hidden'); }
      btn.textContent = '🔍';
      btn.removeAttribute('disabled');
    }

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', e => e.key === 'Enter' && doSearch());
    searchRow.appendChild(input);
    searchRow.appendChild(btn);
    container.appendChild(searchRow);
    container.appendChild(errEl);
    container.appendChild(results);
  }

  render();
}

// ── Pokédex ───────────────────────────────────────────────────────────────────

function renderPokedex(container: HTMLElement) {
  let shiny = false;

  container.innerHTML = `
    <div class="flex gap-2 mb-5">
      <input id="pokeInput" type="text" placeholder="Pokémon name or number…"
        class="flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 min-w-0" />
      <button id="pokeBtn" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm shrink-0 transition-colors">Look up</button>
    </div>
    <p id="pokeErr" class="text-sm text-red-400 hidden mb-3"></p>
    <div id="pokeCard"></div>
  `;

  const input  = container.querySelector('#pokeInput') as HTMLInputElement;
  const btn    = container.querySelector('#pokeBtn') as HTMLButtonElement;
  const errEl  = container.querySelector('#pokeErr') as HTMLElement;
  const card   = container.querySelector('#pokeCard') as HTMLElement;

  async function lookup() {
    const q = input.value.trim();
    if (!q) return;
    btn.textContent = '…';
    btn.setAttribute('disabled', '');
    errEl.classList.add('hidden');
    card.innerHTML = '';
    shiny = false;
    try {
      const d = await apiFetch<{
        id: number; name: string; genus: string; types: string[]; stats: { name: string; value: number }[];
        abilities: string[]; flavorText: string; height: number; weight: number;
        sprite: string | null; shinySprite: string | null; url: string;
      }>(`/api/wiki/pokedex?q=${encodeURIComponent(q)}`);

      function renderCard() {
        const spriteUrl = shiny ? (d.shinySprite || d.sprite) : d.sprite;
        const typeBadges = d.types.map(t => `<span style="background:${TYPE_COLORS[t]||'#666'}" class="text-xs text-white font-bold px-2 py-0.5 rounded capitalize">${t}</span>`).join('');
        const statBars = d.stats.map(s => {
          const pct = Math.min(100, Math.round(s.value / 255 * 100));
          const color = s.value >= 100 ? '#4ade80' : s.value >= 60 ? '#facc15' : '#f87171';
          return `<div class="flex items-center gap-2 mb-1">
            <span class="text-xs text-gray-500 w-28 shrink-0 capitalize">${s.name.replace(/-/g,' ')}</span>
            <div class="flex-1 h-2 bg-gray-700 rounded overflow-hidden"><div style="width:${pct}%;background:${color}" class="h-full rounded"></div></div>
            <span class="text-xs text-gray-400 w-7 text-right">${s.value}</span>
          </div>`;
        }).join('');
        const abilities = d.abilities.map(a => `<span class="text-xs bg-gray-700 rounded px-2 py-0.5 capitalize">${a}</span>`).join(' ');

        card.innerHTML = `
          <div class="bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-lg">
            <div class="flex gap-4 mb-4 flex-wrap">
              ${spriteUrl ? `<img src="${spriteUrl}" class="w-24 h-24 object-contain image-rendering-pixelated bg-gray-800 rounded-lg shrink-0" style="image-rendering:pixelated" />` : ''}
              <div class="flex-1 min-w-0">
                <p class="text-xs text-gray-600 font-mono mb-0.5">#${String(d.id).padStart(4,'0')}</p>
                <h3 class="text-xl font-bold text-white capitalize mb-0.5">${d.name}</h3>
                <p class="text-xs text-gray-500 mb-2">${d.genus}</p>
                <div class="flex gap-1 flex-wrap mb-2">${typeBadges}</div>
                <p class="text-xs text-gray-500">${d.height}m · ${d.weight}kg</p>
              </div>
            </div>
            ${d.shinySprite ? `<button id="shinyToggle" class="text-xs border border-gray-700 hover:border-blue-500 rounded px-2 py-1 text-gray-400 mb-3 transition-colors">${shiny ? '✨ Shiny' : 'Normal sprite'}</button>` : ''}
            <p class="text-xs text-gray-400 italic leading-relaxed mb-4">${d.flavorText}</p>
            <p class="text-xs text-gray-600 uppercase tracking-wide mb-2">Abilities</p>
            <div class="flex flex-wrap gap-1 mb-4">${abilities}</div>
            <p class="text-xs text-gray-600 uppercase tracking-wide mb-2">Base Stats</p>
            ${statBars}
            <a href="${d.url}" target="_blank" rel="noopener" class="text-xs text-blue-400 hover:underline mt-3 block">View on Bulbapedia ↗</a>
          </div>`;

        card.querySelector('#shinyToggle')?.addEventListener('click', () => { shiny = !shiny; renderCard(); });
      }
      renderCard();
    } catch (e: unknown) { errEl.textContent = (e as Error).message; errEl.classList.remove('hidden'); }
    btn.textContent = 'Look up';
    btn.removeAttribute('disabled');
  }

  btn.addEventListener('click', lookup);
  input.addEventListener('keydown', e => e.key === 'Enter' && lookup());
}

// ── RoR2 Characters ───────────────────────────────────────────────────────────

function renderRor2Chars(container: HTMLElement) {
  container.innerHTML = '<p class="text-sm text-gray-600">Loading…</p>';
  apiFetch<{ name: string; unlock: string }[]>('/api/wiki/ror2-chars').then(chars => {
    container.innerHTML = '';
    let openIdx = -1;
    function render() {
      container.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'flex flex-col gap-2';
      chars.forEach((c, i) => {
        const card = document.createElement('div');
        const isOpen = i === openIdx;
        card.className = `bg-gray-900 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${isOpen ? 'border-blue-600' : 'border-gray-700 hover:border-gray-600'}`;
        card.innerHTML = `<p class="font-semibold text-sm text-white">${c.name} <span class="text-gray-600 text-xs float-right">${isOpen ? '▲' : '▼'}</span></p>
          ${isOpen ? `<p class="text-sm text-gray-400 mt-2 leading-relaxed">${c.unlock}</p>` : ''}`;
        card.addEventListener('click', () => { openIdx = isOpen ? -1 : i; render(); });
        list.appendChild(card);
      });
      container.appendChild(list);
    }
    render();
  }).catch(e => { container.innerHTML = `<p class="text-sm text-red-400">${(e as Error).message}</p>`; });
}

// ── Controls Card ─────────────────────────────────────────────────────────────

interface ControlSection { section: string; actions: { action: string; keys: string[] }[]; }

function renderControls(container: HTMLElement, user: User | null) {
  let activeGame = GAMES[0].id;
  let editing = false;
  let draft: ControlSection[] = [];
  let saved = false;

  async function load(game: string): Promise<ControlSection[]> {
    if (user) {
      return apiFetch<ControlSection[]>(`/api/wiki/controls/${game}`);
    }
    const defaults = await apiFetch<Record<string, ControlSection[]>>('/api/wiki/controls-defaults');
    return defaults[game] || [];
  }

  async function render() {
    container.innerHTML = '<p class="text-sm text-gray-600">Loading…</p>';
    try {
      const controls = await load(activeGame);
      draft = JSON.parse(JSON.stringify(controls));
      drawCard(controls);
    } catch (e: unknown) {
      container.innerHTML = `<p class="text-sm text-red-400">${(e as Error).message}</p>`;
    }
  }

  function drawCard(controls: ControlSection[]) {
    container.innerHTML = '';

    // Game chips
    const picker = document.createElement('div');
    picker.className = 'flex flex-wrap gap-2 mb-4';
    GAMES.forEach(g => picker.appendChild(chip(`${g.emoji} ${g.label}`, g.id === activeGame, () => { activeGame = g.id; editing = false; render(); })));
    container.appendChild(picker);

    // Action bar
    const actionBar = document.createElement('div');
    actionBar.className = 'flex gap-2 items-center mb-5 flex-wrap';
    if (!editing) {
      if (user) {
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit my binds';
        editBtn.className = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors';
        editBtn.addEventListener('click', () => { editing = true; drawCard(draft); });
        actionBar.appendChild(editBtn);
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset to default';
        resetBtn.className = 'px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-lg border border-gray-700 transition-colors';
        resetBtn.addEventListener('click', async () => {
          resetBtn.textContent = '…';
          await apiDelete(`/api/wiki/controls/${activeGame}`);
          editing = false;
          render();
        });
        actionBar.appendChild(resetBtn);
      } else {
        const hint = document.createElement('p');
        hint.className = 'text-xs text-gray-600';
        hint.textContent = 'Sign in to save your own binds.';
        actionBar.appendChild(hint);
      }
      if (saved) {
        const msg = document.createElement('span');
        msg.textContent = '✓ Saved';
        msg.className = 'text-xs text-green-400';
        actionBar.appendChild(msg);
        saved = false;
      }
    } else {
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.className = 'px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg transition-colors';
      saveBtn.addEventListener('click', async () => {
        saveBtn.textContent = '…';
        saveBtn.setAttribute('disabled', '');
        await apiPut(`/api/wiki/controls/${activeGame}`, draft);
        editing = false;
        saved = true;
        render();
      });
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'px-3 py-1.5 bg-gray-800 text-gray-400 text-sm rounded-lg border border-gray-700 hover:border-red-600 hover:text-red-400 transition-colors';
      cancelBtn.addEventListener('click', () => { editing = false; render(); });
      actionBar.appendChild(saveBtn);
      actionBar.appendChild(cancelBtn);
    }
    container.appendChild(actionBar);

    // Selected game name heading
    const g = GAMES.find(x => x.id === activeGame);
    const heading = document.createElement('h3');
    heading.className = 'text-lg font-bold text-white mb-3 flex items-center gap-2';
    heading.innerHTML = `<span class="text-2xl">${g?.emoji ?? ''}</span> ${g?.label ?? activeGame} Controls`;
    container.appendChild(heading);

    // Controls sections
    const card = document.createElement('div');
    card.className = 'flex flex-col gap-4';

    const source = editing ? draft : controls;
    source.forEach((sec, si) => {
      const sectionEl = document.createElement('div');
      const title = document.createElement('p');
      title.textContent = sec.section;
      title.className = 'text-xs text-gray-500 uppercase tracking-wide font-semibold pb-1 border-b border-gray-800 mb-2';
      sectionEl.appendChild(title);

      sec.actions.forEach((action, ai) => {
        const row = document.createElement('div');
        row.className = `flex items-center gap-3 px-2 py-1.5 rounded ${(ai % 2 === 0) ? 'bg-gray-900' : ''}`;

        const actionName = document.createElement('span');
        actionName.textContent = action.action;
        actionName.className = 'text-sm text-gray-300 w-40 shrink-0';
        row.appendChild(actionName);

        const keysEl = document.createElement('div');
        keysEl.className = 'flex flex-wrap gap-1 flex-1';

        if (editing) {
          action.keys.forEach((k, ki) => {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.value = k;
            inp.className = 'bg-gray-800 border border-blue-600 text-gray-200 rounded px-2 py-0.5 text-xs font-mono w-24 outline-none';
            inp.addEventListener('input', () => { draft[si].actions[ai].keys[ki] = inp.value; });
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.className = 'text-gray-600 hover:text-red-400 text-sm leading-none';
            removeBtn.addEventListener('click', () => { draft[si].actions[ai].keys.splice(ki, 1); drawCard(draft); });
            keysEl.appendChild(inp);
            keysEl.appendChild(removeBtn);
          });
          const addBtn = document.createElement('button');
          addBtn.textContent = '+';
          addBtn.className = 'text-xs border border-gray-700 hover:border-blue-500 text-gray-500 hover:text-blue-400 rounded px-2 py-0.5 transition-colors';
          addBtn.addEventListener('click', () => { draft[si].actions[ai].keys.push(''); drawCard(draft); });
          keysEl.appendChild(addBtn);
        } else {
          action.keys.forEach(k => {
            const badge = document.createElement('span');
            badge.textContent = k;
            badge.className = 'text-xs bg-gray-800 border border-gray-700 rounded px-2 py-0.5 font-mono text-gray-300';
            keysEl.appendChild(badge);
          });
        }

        row.appendChild(keysEl);
        sectionEl.appendChild(row);
      });

      card.appendChild(sectionEl);
    });
    container.appendChild(card);
  }

  render();
}

// ── Setup Guides ──────────────────────────────────────────────────────────────

function renderSetupGuides(container: HTMLElement) {
  container.innerHTML = `
    <p class="text-sm text-gray-500 mb-5 leading-relaxed max-w-2xl">
      General setup for connecting to our game servers. Each server's own page lists the
      exact IP, port, password, and required mods — these are the one-time client steps.
    </p>
    <div class="flex flex-col gap-3">
      ${SETUP_GUIDES.map(g => `
        <div class="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h3 class="text-base font-bold text-white mb-3 flex items-center gap-2"><span class="text-xl">${g.emoji}</span> ${g.game}</h3>
          <ol class="list-decimal list-inside marker:text-gray-600">
            ${g.steps.map(s => `<li class="text-sm text-gray-400 leading-relaxed mb-1.5">${s}</li>`).join('')}
          </ol>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Root Reference panel ──────────────────────────────────────────────────────

export function renderReference(user: User | null, isAdmin = false): HTMLElement {
  const el = document.createElement('div');
  el.className = 'py-8 px-4 max-w-4xl mx-auto';

  let activeTab: SubTab = 'wiki';

  const TABS: { id: SubTab; label: string }[] = [
    { id: 'wiki',     label: 'Wiki Search' },
    { id: 'crafting', label: 'Terraria Crafting' },
    { id: 'pokedex',  label: 'Pokédex'    },
    { id: 'ror2',     label: 'RoR2 Chars' },
    { id: 'controls', label: 'Controls'   },
    { id: 'setup',    label: 'Setup Guides' },
  ];

  function render() {
    el.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'mb-6';
    header.innerHTML = '<h2 class="text-xl font-bold text-white mb-4">Game Reference</h2>';

    const tabBar = document.createElement('div');
    tabBar.className = 'flex gap-2 flex-wrap';
    TABS.forEach(t => tabBar.appendChild(chip(t.label, t.id === activeTab, () => { activeTab = t.id; render(); })));
    header.appendChild(tabBar);
    el.appendChild(header);

    const content = document.createElement('div');
    el.appendChild(content);

    if (activeTab === 'wiki')     renderWikiSearch(content);
    if (activeTab === 'pokedex')  renderPokedex(content);
    if (activeTab === 'ror2')     renderRor2Chars(content);
    if (activeTab === 'controls') renderControls(content, user);
    if (activeTab === 'setup')    renderSetupGuides(content);
    if (activeTab === 'crafting') renderCrafting(content, user, isAdmin);
  }

  render();
  return el;
}
