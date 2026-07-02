// Terraria crafting calculator: pick vanilla or Calamity, browse by class or
// search directly for an item, get the full recursive recipe tree plus a
// flattened "everything you need" materials list. Admins can add/fix/delete
// recipes inline; any logged-in user can save an item as a goal and check
// off materials as they're gathered.

interface RecipeNode {
  name: string;
  qty: number;
  isRaw: boolean;
  url: string;
  isOverride?: boolean;
  station?: string;
  craftsAmount?: number;
  craftsNeeded?: number;
  altRecipeCount?: number;
  rawIngredients?: { name: string; qty: number }[];
  children?: RecipeNode[];
}

interface TotalRow { name: string; qty: number; url: string; }
interface UsedInRow { name: string; qty: number; station: string; craftsAmount: number; url: string; }
interface Goal { id: number; game: string; itemName: string; totals: TotalRow[]; checked: string[]; }
interface User { username: string; role?: string; }

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

async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((e as { error?: string }).error || r.statusText);
  }
  return r.json() as Promise<T>;
}

export function renderCrafting(container: HTMLElement, user: User | null, isAdmin = false): void {
  let activeGame = 'terraria';
  let activeClass: string | null = null;
  let classes: string[] = [];
  let browseItems: string[] = [];
  let browseFilter = '';
  let searchInput = '';
  let recipeResult: { tree: RecipeNode; totals: TotalRow[] } | null = null;
  let error = '';
  let lastLookupItem = ''; // so a failed recipe lookup (raw material) can still offer "used in" / add-recipe
  let loading = false;
  let saveMsg = '';

  let viewMode: 'lookup' | 'goals' = 'lookup';
  let goals: Goal[] = [];
  let goalsLoading = false;

  async function loadClasses() {
    classes = await apiGet<string[]>(`/api/crafting/${activeGame}/classes`);
    if (activeClass && !classes.includes(activeClass)) activeClass = null;
  }

  async function loadBrowse(cls: string) {
    loading = true; error = ''; lastLookupItem = ''; render();
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
    loading = true; error = ''; recipeResult = null; lastLookupItem = item; saveMsg = ''; render();
    try {
      recipeResult = await apiGet(`/api/crafting/${activeGame}/recipe?item=${encodeURIComponent(item)}`);
    } catch (e: unknown) {
      error = (e as Error).message;
    }
    loading = false;
    render();
  }

  async function loadGoals() {
    goalsLoading = true; render();
    try {
      goals = await apiGet<Goal[]>('/api/crafting/goals');
    } catch { goals = []; }
    goalsLoading = false;
    render();
  }

  async function saveGoal(itemName: string) {
    saveMsg = 'Saving…';
    render();
    try {
      await apiSend('POST', '/api/crafting/goals', { game: activeGame, itemName });
      saveMsg = '✓ Saved to My Goals';
    } catch (e: unknown) {
      saveMsg = (e as Error).message;
    }
    render();
  }

  async function toggleGoalMaterial(goal: Goal, materialName: string) {
    const idx = goal.checked.indexOf(materialName);
    if (idx > -1) goal.checked.splice(idx, 1);
    else goal.checked.push(materialName);
    render();
    try {
      await apiSend('PUT', `/api/crafting/goals/${goal.id}`, { checked: goal.checked });
    } catch { /* best-effort; local state already updated */ }
  }

  async function deleteGoal(id: number) {
    goals = goals.filter(g => g.id !== id);
    render();
    try { await apiSend('DELETE', `/api/crafting/goals/${id}`); } catch { /* noop */ }
  }

  // Lazy "Used in" widget — fetched on first click, reused for both tree
  // nodes and the flattened totals list. Returns the toggle button (place
  // inline) and the results panel (place as a block sibling below it).
  function buildUsedIn(itemName: string): { toggle: HTMLElement; panel: HTMLElement } {
    const toggle = document.createElement('button');
    toggle.textContent = 'Used in ▾';
    toggle.className = 'text-xs text-blue-400 hover:underline shrink-0';
    const panel = document.createElement('div');
    panel.className = 'hidden mt-1 mb-1 pl-3 border-l-2 border-gray-800 flex flex-col gap-1';
    let loaded = false;

    toggle.addEventListener('click', async () => {
      const willOpen = panel.classList.contains('hidden');
      if (willOpen && !loaded) {
        toggle.textContent = 'Loading…';
        try {
          const rows = await apiGet<UsedInRow[]>(`/api/crafting/${activeGame}/used-in?item=${encodeURIComponent(itemName)}`);
          loaded = true;
          panel.innerHTML = '';
          if (!rows.length) {
            panel.innerHTML = '<p class="text-xs text-gray-600 italic py-1">Not used in any known recipe.</p>';
          } else {
            rows.forEach(u => {
              const r = document.createElement('div');
              r.className = 'flex items-center justify-between gap-2';
              r.innerHTML = `
                <a href="${u.url}" target="_blank" rel="noopener" class="text-xs text-gray-300 hover:text-blue-400 hover:underline">${u.name}</a>
                <span class="text-xs font-mono text-gray-500 shrink-0">needs ×${u.qty}</span>
              `;
              panel.appendChild(r);
            });
          }
        } catch (e: unknown) {
          loaded = true;
          panel.innerHTML = `<p class="text-xs text-red-400 py-1">${(e as Error).message}</p>`;
        }
      }
      panel.classList.toggle('hidden');
      toggle.textContent = panel.classList.contains('hidden') ? 'Used in ▾' : 'Used in ▴';
    });

    return { toggle, panel };
  }

  // Admin-only "Add/Edit recipe" widget. Prefills from the node's own
  // resolved data (rawIngredients/station/craftsAmount) — no extra fetch
  // needed since the tree already carries everything required to edit it.
  function buildEditForm(itemName: string, prefill: { station?: string; craftsAmount?: number; rawIngredients?: { name: string; qty: number }[]; isOverride?: boolean }): { toggle: HTMLElement; panel: HTMLElement } {
    const hasRecipe = !!(prefill.rawIngredients && prefill.rawIngredients.length);
    const toggle = document.createElement('button');
    toggle.textContent = hasRecipe ? '✎ Edit recipe' : '+ Add recipe';
    toggle.className = 'text-xs text-orange-400 hover:underline shrink-0';
    if (prefill.isOverride) toggle.textContent += ' (custom)';

    const panel = document.createElement('div');
    panel.className = 'hidden mt-2 mb-2 p-3 bg-gray-950 border border-gray-800 rounded-lg';

    let draft: { name: string; qty: number }[] = (prefill.rawIngredients || []).map(i => ({ ...i }));

    function drawForm() {
      panel.innerHTML = '';

      const row1 = document.createElement('div');
      row1.className = 'flex gap-2 mb-2';
      const stationInput = document.createElement('input');
      stationInput.type = 'text';
      stationInput.placeholder = 'Crafting station (e.g. Mythril Anvil)';
      stationInput.value = prefill.station || '';
      stationInput.className = 'flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none min-w-0';
      const amountInput = document.createElement('input');
      amountInput.type = 'number';
      amountInput.min = '1';
      amountInput.value = String(prefill.craftsAmount || 1);
      amountInput.className = 'w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none shrink-0';
      amountInput.title = 'Quantity produced per craft';
      row1.appendChild(stationInput);
      row1.appendChild(amountInput);
      panel.appendChild(row1);

      const ingLabel = document.createElement('p');
      ingLabel.textContent = 'Ingredients';
      ingLabel.className = 'text-xs text-gray-600 uppercase tracking-wide mb-1';
      panel.appendChild(ingLabel);

      const ingWrap = document.createElement('div');
      ingWrap.className = 'flex flex-col gap-1 mb-2';
      draft.forEach((ing, i) => {
        const r = document.createElement('div');
        r.className = 'flex gap-1 items-center';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Ingredient name';
        nameInput.value = ing.name;
        nameInput.className = 'flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none min-w-0';
        nameInput.addEventListener('input', () => { draft[i].name = nameInput.value; });
        const qtyInput = document.createElement('input');
        qtyInput.type = 'number';
        qtyInput.min = '1';
        qtyInput.value = String(ing.qty);
        qtyInput.className = 'w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none shrink-0';
        qtyInput.addEventListener('input', () => { draft[i].qty = parseInt(qtyInput.value, 10) || 1; });
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'text-gray-600 hover:text-red-400 text-sm px-1 shrink-0';
        removeBtn.addEventListener('click', () => { draft.splice(i, 1); drawForm(); });
        r.appendChild(nameInput);
        r.appendChild(qtyInput);
        r.appendChild(removeBtn);
        ingWrap.appendChild(r);
      });
      panel.appendChild(ingWrap);

      const addIngBtn = document.createElement('button');
      addIngBtn.textContent = '+ Add ingredient';
      addIngBtn.className = 'text-xs border border-gray-700 hover:border-orange-500 text-gray-500 hover:text-orange-400 rounded px-2 py-1 mb-3 transition-colors';
      addIngBtn.addEventListener('click', () => { draft.push({ name: '', qty: 1 }); drawForm(); });
      panel.appendChild(addIngBtn);

      const actions = document.createElement('div');
      actions.className = 'flex gap-2 items-center flex-wrap';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.className = 'text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded transition-colors';
      saveBtn.addEventListener('click', async () => {
        saveBtn.textContent = 'Saving…';
        saveBtn.setAttribute('disabled', '');
        try {
          await apiSend('PUT', `/api/crafting/${activeGame}/override`, {
            itemName, station: stationInput.value.trim(),
            amount: parseInt(amountInput.value, 10) || 1,
            ingredients: draft,
          });
          const root = recipeResult?.tree.name || lastLookupItem;
          await loadRecipe(root);
        } catch (e: unknown) {
          errMsg.textContent = (e as Error).message;
          errMsg.classList.remove('hidden');
          saveBtn.textContent = 'Save';
          saveBtn.removeAttribute('disabled');
        }
      });
      actions.appendChild(saveBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'text-xs px-3 py-1.5 bg-gray-800 text-gray-400 border border-gray-700 rounded hover:border-red-600 hover:text-red-400 transition-colors';
      cancelBtn.addEventListener('click', () => panel.classList.add('hidden'));
      actions.appendChild(cancelBtn);

      if (prefill.isOverride) {
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete override (revert to wiki)';
        delBtn.className = 'text-xs px-3 py-1.5 bg-gray-800 text-red-400 border border-red-900 rounded hover:bg-red-950 transition-colors';
        delBtn.addEventListener('click', async () => {
          delBtn.textContent = 'Deleting…';
          try {
            await apiSend('DELETE', `/api/crafting/${activeGame}/override?item=${encodeURIComponent(itemName)}`);
            const root = recipeResult?.tree.name || lastLookupItem;
            await loadRecipe(root);
          } catch (e: unknown) {
            errMsg.textContent = (e as Error).message;
            errMsg.classList.remove('hidden');
          }
        });
        actions.appendChild(delBtn);
      }
      panel.appendChild(actions);

      const errMsg = document.createElement('p');
      errMsg.className = 'hidden text-xs text-red-400 mt-2';
      panel.appendChild(errMsg);
    }

    toggle.addEventListener('click', () => {
      const willOpen = panel.classList.contains('hidden');
      if (willOpen) drawForm();
      panel.classList.toggle('hidden');
    });

    return { toggle, panel };
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

    const { toggle: usedInToggle, panel: usedInPanel } = buildUsedIn(node.name);
    line.appendChild(usedInToggle);

    if (isAdmin) {
      const { toggle: editToggle, panel: editPanel } = buildEditForm(node.name, node);
      line.appendChild(editToggle);
      row.appendChild(line);
      row.appendChild(usedInPanel);
      row.appendChild(editPanel);
    } else {
      row.appendChild(line);
      row.appendChild(usedInPanel);
    }

    if (node.children && node.children.length) {
      node.children.forEach(c => row.appendChild(renderNode(c, depth + 1)));
    }
    return row;
  }

  function renderGoalsView() {
    if (goalsLoading) {
      const p = document.createElement('p');
      p.className = 'text-sm text-gray-600';
      p.textContent = 'Loading…';
      container.appendChild(p);
      return;
    }
    if (!goals.length) {
      const p = document.createElement('p');
      p.className = 'text-sm text-gray-600';
      p.textContent = 'No saved goals yet. Look up an item and click "Save as Goal".';
      container.appendChild(p);
      return;
    }
    const list = document.createElement('div');
    list.className = 'flex flex-col gap-4';
    goals.forEach(goal => {
      const g = GAMES.find(x => x.id === goal.game);
      const card = document.createElement('div');
      card.className = 'bg-gray-900 border border-gray-700 rounded-xl p-4';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between gap-2 mb-3';
      const title = document.createElement('h3');
      title.className = 'text-base font-bold text-white';
      title.textContent = `${g?.emoji || ''} ${goal.itemName}`;
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'text-xs text-gray-500 hover:text-red-400 border border-gray-700 hover:border-red-600 rounded px-2 py-1 transition-colors';
      delBtn.addEventListener('click', () => deleteGoal(goal.id));
      header.appendChild(title);
      header.appendChild(delBtn);
      card.appendChild(header);

      const doneCount = goal.checked.length;
      const progress = document.createElement('p');
      progress.className = 'text-xs text-gray-600 mb-2';
      progress.textContent = `${doneCount} / ${goal.totals.length} gathered`;
      card.appendChild(progress);

      const list2 = document.createElement('div');
      list2.className = 'flex flex-col gap-1';
      goal.totals.forEach(t => {
        const isChecked = goal.checked.includes(t.name);
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 text-sm cursor-pointer py-1';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isChecked;
        cb.className = 'accent-green-600 w-4 h-4 shrink-0';
        cb.addEventListener('change', () => toggleGoalMaterial(goal, t.name));
        const label = document.createElement('span');
        label.textContent = `${t.name} ×${t.qty}`;
        label.className = isChecked ? 'text-gray-600 line-through' : 'text-gray-300';
        row.appendChild(cb);
        row.appendChild(label);
        list2.appendChild(row);
      });
      card.appendChild(list2);
      list.appendChild(card);
    });
    container.appendChild(list);
  }

  function render() {
    container.innerHTML = '';

    // Lookup / My Goals toggle — goals require an account
    if (user) {
      const modeBar = document.createElement('div');
      modeBar.className = 'flex gap-2 mb-4';
      modeBar.appendChild(chip('Lookup', viewMode === 'lookup', () => { viewMode = 'lookup'; render(); }));
      modeBar.appendChild(chip('My Goals', viewMode === 'goals', () => {
        viewMode = 'goals';
        render();
        loadGoals();
      }));
      container.appendChild(modeBar);
    }

    if (viewMode === 'goals') {
      renderGoalsView();
      return;
    }

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
      errEl.className = 'text-sm text-red-400 mb-2';
      errEl.textContent = error;
      container.appendChild(errEl);

      // Not craftable (raw material, drop, event reward) — still let them
      // check what it's used IN, and let admin define a recipe on the spot.
      if (lastLookupItem) {
        const fallbackRow = document.createElement('div');
        fallbackRow.className = 'mb-4 flex flex-col';
        const { toggle: uiToggle, panel: uiPanel } = buildUsedIn(lastLookupItem);
        const btnRow = document.createElement('div');
        btnRow.className = 'flex gap-3';
        btnRow.appendChild(uiToggle);
        if (isAdmin) {
          const { toggle: editToggle, panel: editPanel } = buildEditForm(lastLookupItem, { rawIngredients: [] });
          btnRow.appendChild(editToggle);
          fallbackRow.appendChild(btnRow);
          fallbackRow.appendChild(uiPanel);
          fallbackRow.appendChild(editPanel);
        } else {
          fallbackRow.appendChild(btnRow);
          fallbackRow.appendChild(uiPanel);
        }
        container.appendChild(fallbackRow);
      }
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
      const topRow = document.createElement('div');
      topRow.className = 'flex items-center gap-3 mb-4 flex-wrap';
      const backBtn = document.createElement('button');
      backBtn.textContent = '← Back to list';
      backBtn.className = 'text-xs text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-2 py-1';
      backBtn.addEventListener('click', () => { recipeResult = null; saveMsg = ''; render(); });
      topRow.appendChild(backBtn);

      if (user) {
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '★ Save as Goal';
        saveBtn.className = 'text-xs px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 text-white rounded transition-colors';
        saveBtn.addEventListener('click', () => saveGoal(recipeResult!.tree.name));
        topRow.appendChild(saveBtn);
      }
      if (saveMsg) {
        const msg = document.createElement('span');
        msg.className = 'text-xs text-green-400';
        msg.textContent = saveMsg;
        topRow.appendChild(msg);
      }
      container.appendChild(topRow);

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
        row.className = 'border-b border-gray-800 last:border-0 pb-1.5 last:pb-0';

        const top = document.createElement('div');
        top.className = 'flex items-center justify-between gap-2 text-sm';
        top.innerHTML = `
          <a href="${t.url}" target="_blank" rel="noopener" class="text-gray-300 hover:text-blue-400 hover:underline">${t.name}</a>
          <div class="flex items-center gap-3 shrink-0">
            <span class="font-mono text-white bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs">×${t.qty}</span>
          </div>
        `;
        const { toggle, panel } = buildUsedIn(t.name);
        top.lastElementChild!.appendChild(toggle);
        row.appendChild(top);
        row.appendChild(panel);
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
