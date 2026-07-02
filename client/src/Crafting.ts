// Terraria crafting calculator: pick vanilla or Calamity, browse by class or
// search directly for an item, get the full recursive recipe tree plus a
// flattened "everything you need" materials list.

interface RecipeNode {
  name: string;
  qty: number;
  isRaw: boolean;
  url: string;
  station?: string;
  craftsAmount?: number;
  craftsNeeded?: number;
  altRecipeCount?: number;
  children?: RecipeNode[];
}

interface TotalRow { name: string; qty: number; url: string; }

const GAMES = [
  { id: 'terraria', label: 'Vanilla',  emoji: '🌳' },
  { id: 'calamity', label: 'Calamity', emoji: '✏️' },
];

const CLASS_LABELS: Record<string, string> = {
  melee: 'Melee', ranged: 'Ranged', magic: 'Magic', summon: 'Summon',
  rogue: 'Rogue', armor: 'Armor', accessory: 'Accessories',
};

function chip(label: string, active: boolean, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = `px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
    active ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`;
  b.addEventListener('click', onClick);
  return b;
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((e as { error?: string }).error || r.statusText);
  }
  return r.json() as Promise<T>;
}

export function renderCrafting(container: HTMLElement): void {
  let activeGame = 'terraria';
  let activeClass: string | null = null;
  let classes: string[] = [];
  let browseItems: string[] = [];
  let browseFilter = '';
  let searchInput = '';
  let recipeResult: { tree: RecipeNode; totals: TotalRow[] } | null = null;
  let error = '';
  let loading = false;

  async function loadClasses() {
    classes = await apiGet<string[]>(`/api/crafting/${activeGame}/classes`);
    if (activeClass && !classes.includes(activeClass)) activeClass = null;
  }

  async function loadBrowse(cls: string) {
    loading = true; error = ''; render();
    try {
      browseItems = await apiGet<string[]>(`/api/crafting/${activeGame}/browse?class=${cls}`);
    } catch (e: unknown) {
      error = (e as Error).message;
      browseItems = [];
    }
    loading = false;
    render();
  }

  async function loadRecipe(item: string) {
    loading = true; error = ''; recipeResult = null; render();
    try {
      recipeResult = await apiGet(`/api/crafting/${activeGame}/recipe?item=${encodeURIComponent(item)}`);
    } catch (e: unknown) {
      error = (e as Error).message;
    }
    loading = false;
    render();
  }

  function renderNode(node: RecipeNode, depth: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'py-1';
    row.style.paddingLeft = `${depth * 20}px`;

    const line = document.createElement('div');
    line.className = 'flex items-center gap-2 flex-wrap';

    const qtyBadge = document.createElement('span');
    qtyBadge.textContent = `×${node.qty}`;
    qtyBadge.className = 'text-xs font-mono bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-400 shrink-0';
    line.appendChild(qtyBadge);

    const link = document.createElement('a');
    link.href = node.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = node.name;
    link.className = node.isRaw
      ? 'text-sm text-gray-300 hover:text-blue-400 hover:underline'
      : 'text-sm font-semibold text-white hover:text-blue-400 hover:underline';
    line.appendChild(link);

    if (!node.isRaw) {
      const meta = document.createElement('span');
      meta.className = 'text-xs text-gray-600';
      const parts = [`at ${node.station}`];
      if ((node.altRecipeCount || 1) > 1) parts.push(`1 of ${node.altRecipeCount} recipes shown`);
      meta.textContent = parts.join(' · ');
      line.appendChild(meta);
    } else {
      const badge = document.createElement('span');
      badge.textContent = 'base material';
      badge.className = 'text-xs text-gray-600 italic';
      line.appendChild(badge);
    }

    row.appendChild(line);

    if (node.children && node.children.length) {
      node.children.forEach(c => row.appendChild(renderNode(c, depth + 1)));
    }
    return row;
  }

  function render() {
    container.innerHTML = '';

    // Game (mod) chips
    const gamePicker = document.createElement('div');
    gamePicker.className = 'flex flex-wrap gap-2 mb-4';
    GAMES.forEach(g => gamePicker.appendChild(chip(`${g.emoji} ${g.label}`, g.id === activeGame, async () => {
      if (activeGame === g.id) return;
      activeGame = g.id;
      activeClass = null;
      browseItems = [];
      recipeResult = null;
      error = '';
      await loadClasses();
      render();
    })));
    container.appendChild(gamePicker);

    // Search box — direct lookup by name
    const searchRow = document.createElement('div');
    searchRow.className = 'flex gap-2 mb-4';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = searchInput;
    input.placeholder = 'Type an item name — e.g. "Terra Blade"';
    input.className = 'flex-1 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 min-w-0';
    input.addEventListener('input', () => { searchInput = input.value; });
    const goBtn = document.createElement('button');
    goBtn.textContent = 'Get Recipe';
    goBtn.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm shrink-0 transition-colors';
    const doSearch = () => { if (searchInput.trim()) loadRecipe(searchInput.trim()); };
    goBtn.addEventListener('click', doSearch);
    input.addEventListener('keydown', e => e.key === 'Enter' && doSearch());
    searchRow.appendChild(input);
    searchRow.appendChild(goBtn);
    container.appendChild(searchRow);

    // Class chips
    const classPicker = document.createElement('div');
    classPicker.className = 'flex flex-wrap gap-2 mb-4';
    classPicker.appendChild(chip('Browse by class:', false, () => {}));
    classPicker.lastElementChild!.classList.add('pointer-events-none', 'bg-transparent', 'border-none', 'px-0', 'text-gray-600');
    classes.forEach(cls => classPicker.appendChild(chip(CLASS_LABELS[cls] || cls, cls === activeClass, () => {
      activeClass = cls;
      recipeResult = null;
      loadBrowse(cls);
    })));
    container.appendChild(classPicker);

    if (error) {
      const errEl = document.createElement('p');
      errEl.className = 'text-sm text-red-400 mb-4';
      errEl.textContent = error;
      container.appendChild(errEl);
    }

    if (loading) {
      const p = document.createElement('p');
      p.className = 'text-sm text-gray-600';
      p.textContent = 'Loading…';
      container.appendChild(p);
      return;
    }

    // Recipe result view takes priority when present
    if (recipeResult) {
      const backBtn = document.createElement('button');
      backBtn.textContent = '← Back to list';
      backBtn.className = 'text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-2 py-1 mb-4';
      backBtn.addEventListener('click', () => { recipeResult = null; render(); });
      container.appendChild(backBtn);

      const treeCard = document.createElement('div');
      treeCard.className = 'bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4';
      const treeTitle = document.createElement('p');
      treeTitle.className = 'text-xs text-gray-600 uppercase tracking-wide mb-3';
      treeTitle.textContent = 'Recipe tree';
      treeCard.appendChild(treeTitle);
      treeCard.appendChild(renderNode(recipeResult.tree, 0));
      container.appendChild(treeCard);

      const totalsCard = document.createElement('div');
      totalsCard.className = 'bg-gray-900 border border-gray-700 rounded-xl p-4';
      const totalsTitle = document.createElement('p');
      totalsTitle.className = 'text-xs text-gray-600 uppercase tracking-wide mb-3';
      totalsTitle.textContent = 'Everything you need (base materials, totaled)';
      totalsCard.appendChild(totalsTitle);
      const list = document.createElement('div');
      list.className = 'flex flex-col gap-1.5';
      recipeResult.totals.forEach(t => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2 text-sm';
        row.innerHTML = `
          <a href="${t.url}" target="_blank" rel="noopener" class="text-gray-300 hover:text-blue-400 hover:underline">${t.name}</a>
          <span class="font-mono text-white bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs shrink-0">×${t.qty}</span>
        `;
        list.appendChild(row);
      });
      totalsCard.appendChild(list);
      container.appendChild(totalsCard);
      return;
    }

    // Browse list
    if (activeClass) {
      const filterInput = document.createElement('input');
      filterInput.type = 'text';
      filterInput.value = browseFilter;
      filterInput.placeholder = `Filter ${browseItems.length} items…`;
      filterInput.className = 'w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 mb-3';
      filterInput.addEventListener('input', () => { browseFilter = filterInput.value.toLowerCase(); renderList(); });
      container.appendChild(filterInput);

      const listWrap = document.createElement('div');
      listWrap.className = 'flex flex-col gap-1 max-h-[60vh] overflow-y-auto';
      container.appendChild(listWrap);

      function renderList() {
        listWrap.innerHTML = '';
        const filtered = browseItems.filter(n => n.toLowerCase().includes(browseFilter));
        if (!filtered.length) {
          listWrap.innerHTML = '<p class="text-sm text-gray-600 py-4">No items match.</p>';
          return;
        }
        filtered.forEach(name => {
          const btn = document.createElement('button');
          btn.textContent = name;
          btn.className = 'text-left text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded px-3 py-1.5 transition-colors';
          btn.addEventListener('click', () => loadRecipe(name));
          listWrap.appendChild(btn);
        });
      }
      renderList();
    } else if (!error) {
      const hint = document.createElement('p');
      hint.className = 'text-sm text-gray-600';
      hint.textContent = 'Type an item name above, or pick a class to browse.';
      container.appendChild(hint);
    }
  }

  loadClasses().then(render);
}
