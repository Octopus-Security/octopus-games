/**
 * crafting.js — Terraria (vanilla + Calamity) crafting calculator.
 *
 * Both wikis expose a Cargo "Recipes" table (result, amount, ings, station).
 * "ings" is delimited by a wiki-specific control character that varies by wiki
 * (vanilla uses U+00A6, Calamity uses U+2021) — we don't hardcode it, we just
 * read the first character of each ingredient token and split on that.
 *
 * Admin-authored overrides (CraftingRecipe table) take precedence over wiki
 * data for a given (game, itemName) — used to fix wiki gaps/errors or add
 * items the wiki doesn't track. Anyone can read; only admin can write.
 *
 * Goals (CraftingGoal table) are a per-user saved checklist snapshot of a
 * recipe's flattened totals, so a player can track what they've gathered
 * across sessions without the list shifting if wiki data changes later.
 *
 * Routes:
 *   GET    /api/crafting/:game/classes            which weapon/armor classes exist       (public)
 *   GET    /api/crafting/:game/browse?class=Melee items in a class (category listing)     (public)
 *   GET    /api/crafting/:game/recipe?item=NAME   full recursive recipe tree + totals     (public)
 *   GET    /api/crafting/:game/used-in?item=NAME  what can be crafted USING this item     (public)
 *   GET    /api/crafting/:game/override?item=NAME current admin override, or null         (admin)
 *   PUT    /api/crafting/:game/override           upsert an override                      (admin)
 *   DELETE /api/crafting/:game/override?item=NAME remove an override, revert to wiki       (admin)
 *   POST   /api/crafting/goals                    save a new goal (snapshots totals)       (login)
 *   GET    /api/crafting/goals                     list the caller's saved goals            (login)
 *   PUT    /api/crafting/goals/:id                 update the checked-off materials list    (login, owner)
 *   DELETE /api/crafting/goals/:id                 remove a saved goal                       (login, owner)
 */

const express = require('express');
const axios   = require('axios');
const { CraftingRecipe, CraftingGoal } = require('../database');
const router  = express.Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'psychopathy';
const UA = { 'User-Agent': 'OctopusGames/1.0 (https://games.octopustechnology.net)' };

const WIKIS = {
  terraria: { api: 'https://terraria.wiki.gg/api.php', url: 'https://terraria.wiki.gg/wiki', name: 'Terraria (Vanilla)' },
  calamity: { api: 'https://calamitymod.wiki.gg/api.php', url: 'https://calamitymod.wiki.gg/wiki', name: 'Calamity Mod' },
};

// Class → Cargo/category name. Rogue only exists in Calamity; that's fine —
// browsing it on vanilla just returns an empty list.
const CLASS_CATEGORIES = {
  melee:      'Melee weapons',
  ranged:     'Ranged weapons',
  magic:      'Magic weapons',
  summon:     'Summon weapons',
  rogue:      'Rogue weapons',
  armor:      'Armor items',
  accessory:  'Accessory items',
};

const CLASSES_BY_GAME = {
  terraria: ['melee', 'ranged', 'magic', 'summon', 'armor', 'accessory'],
  calamity: ['melee', 'ranged', 'magic', 'summon', 'rogue', 'armor', 'accessory'],
};

// Category listings include the overview/list pages that share the category
// alongside actual items (e.g. "List of ranged weapons", "List of ranged
// weapons/id" translation subpages). Real item names never contain "/" or
// start with "List of ", so both are safe filters.
function isRealItemTitle(title) {
  return !title.includes('/') && !/^List of /i.test(title);
}

function itemUrl(wikiUrl, name) {
  return `${wikiUrl}/${encodeURIComponent(name.replace(/ /g, '_'))}`;
}

function requireAdmin(req, res, next) {
  if (req.user && (req.user.username === ADMIN_USERNAME || req.user.role === 'admin')) return next();
  res.status(403).json({ error: 'Forbidden' });
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'NOT_AUTHENTICATED' });
}

// "¦Blade of Grass¦1^¦Blood Butcherer¦1" → [{name:'Blade of Grass',qty:1}, ...]
// The delimiter character differs per wiki, so read it from the token itself
// (it's always the first character) rather than hardcoding one.
function parseIngredients(ingsStr) {
  if (!ingsStr) return [];
  return ingsStr.split('^').map(token => {
    if (!token) return null;
    const delim = token[0];
    const parts = token.split(delim);
    const name = (parts[1] || '').trim();
    const qty  = parseInt(parts[2], 10) || 1;
    return name ? { name, qty } : null;
  }).filter(Boolean);
}

// Short in-memory cache — recipe trees re-query the same base materials
// (ore/bars) across many branches, and across requests for different items.
// Only wiki lookups are cached; admin overrides read straight from the DB
// so edits take effect immediately.
const recipeCache = new Map(); // key -> { data, exp }
const CACHE_MS = 10 * 60 * 1000;

function cacheGet(key) {
  const hit = recipeCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  return null;
}
function cacheSet(key, data) {
  recipeCache.set(key, { data, exp: Date.now() + CACHE_MS });
}

async function getWikiRecipes(wikiApi, itemName) {
  const key = `${wikiApi}::recipes::${itemName}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const safeName = itemName.replace(/"/g, '');
  const params = new URLSearchParams({
    action: 'cargoquery', tables: 'Recipes',
    fields: '_pageName,result,amount,ings,station',
    where: `result="${safeName}"`,
    format: 'json', origin: '*',
  });
  const r = await axios.get(`${wikiApi}?${params}`, { timeout: 10000, headers: UA });
  const rows = r.data?.cargoquery || [];
  const recipes = rows
    .map(row => ({
      amount:      parseInt(row.title.amount, 10) || 1,
      station:     row.title.station || '',
      ingredients: parseIngredients(row.title.ings),
    }))
    .filter(rec => rec.ingredients.length > 0);

  cacheSet(key, recipes);
  return recipes;
}

// Admin override (if any) always wins over wiki data for that item.
async function getRecipes(game, wiki, itemName) {
  const override = await CraftingRecipe.findOne({ where: { game, itemName } });
  if (override) {
    return {
      isOverride: true,
      recipes: [{
        amount:      override.amount,
        station:     override.station || '',
        ingredients: JSON.parse(override.ingredients),
      }],
    };
  }
  return { isOverride: false, recipes: await getWikiRecipes(wiki.api, itemName) };
}

const MAX_DEPTH = 12;

// Recursively expands one item into its full ingredient tree. Items with no
// known recipe (wiki or override) are treated as raw/base materials (ore,
// drops, event rewards, etc.) and become leaves. Alternate recipes exist for
// many items (e.g. two ways to make True Excalibur) — we default to the
// first one Cargo returns and note how many alternates exist.
async function resolveTree(game, wiki, itemName, neededQty, depth, seen) {
  if (depth > MAX_DEPTH || seen.has(itemName)) {
    return { name: itemName, qty: neededQty, isRaw: true, url: itemUrl(wiki.url, itemName) };
  }

  const { recipes, isOverride } = await getRecipes(game, wiki, itemName);
  if (!recipes.length) {
    return { name: itemName, qty: neededQty, isRaw: true, url: itemUrl(wiki.url, itemName) };
  }

  const chosen = recipes[0];
  const craftsNeeded = Math.ceil(neededQty / chosen.amount);
  const nextSeen = new Set(seen);
  nextSeen.add(itemName);

  const children = await Promise.all(chosen.ingredients.map(ing =>
    resolveTree(game, wiki, ing.name, ing.qty * craftsNeeded, depth + 1, nextSeen)
  ));

  return {
    name: itemName,
    qty: neededQty,
    isRaw: false,
    isOverride,
    station: chosen.station,
    craftsAmount: chosen.amount,
    craftsNeeded,
    altRecipeCount: recipes.length,
    rawIngredients: chosen.ingredients, // unscaled, per-craft — used to prefill the admin edit form
    url: itemUrl(wiki.url, itemName),
    children,
  };
}

function flattenTotals(node, totals = {}) {
  if (node.isRaw) {
    totals[node.name] = (totals[node.name] || { qty: 0, url: node.url });
    totals[node.name].qty += node.qty;
  } else {
    node.children.forEach(c => flattenTotals(c, totals));
  }
  return totals;
}

// Reverse lookup: what can be crafted USING this item. We don't know each
// wiki's ings-delimiter character ahead of time, so instead of hardcoding it
// we do a broad substring LIKE on the raw ings blob (cheap, one query) and
// then filter for an exact ingredient-name match client-side via the same
// parser used for the forward direction — false-positive substring rows
// (e.g. "Bar" matching "Iron Bar") get discarded here, not returned. Admin
// overrides are also scanned so custom recipes show up in reverse lookups.
async function getUsedIn(game, wiki, itemName) {
  const key = `${wiki.api}::usedin::${itemName}`;
  const cached = cacheGet(key);
  const results = cached ? [...cached] : null;
  if (results) return results;

  const byResult = new Map();

  const overrides = await CraftingRecipe.findAll({ where: { game } });
  for (const o of overrides) {
    const ings = JSON.parse(o.ingredients);
    const match = ings.find(i => i.name === itemName);
    if (!match) continue;
    byResult.set(o.itemName, {
      name: o.itemName, qty: match.qty, station: o.station || '',
      craftsAmount: o.amount, url: itemUrl(wiki.url, o.itemName),
    });
  }

  const safeName = itemName.replace(/"/g, '');
  const params = new URLSearchParams({
    action: 'cargoquery', tables: 'Recipes',
    fields: '_pageName,result,amount,ings,station',
    where: `ings LIKE "%${safeName}%"`,
    limit: '500', format: 'json', origin: '*',
  });
  const r = await axios.get(`${wiki.api}?${params}`, { timeout: 10000, headers: UA });
  const rows = r.data?.cargoquery || [];
  for (const row of rows) {
    const t = row.title;
    const ings = parseIngredients(t.ings);
    const match = ings.find(i => i.name === itemName);
    if (!match || !t.result || byResult.has(t.result)) continue;
    byResult.set(t.result, {
      name: t.result, qty: match.qty, station: t.station || '',
      craftsAmount: parseInt(t.amount, 10) || 1, url: itemUrl(wiki.url, t.result),
    });
  }

  const usedIn = Array.from(byResult.values()).sort((a, b) => a.name.localeCompare(b.name));
  cacheSet(key, usedIn);
  return usedIn;
}

// ── Read-only lookup routes ────────────────────────────────────────────────

router.get('/:game/classes', (req, res) => {
  const { game } = req.params;
  if (!WIKIS[game]) return res.status(400).json({ error: 'Unknown game' });
  res.json(CLASSES_BY_GAME[game] || []);
});

router.get('/:game/browse', async (req, res) => {
  const { game } = req.params;
  const { class: cls } = req.query;
  const wiki = WIKIS[game];
  const category = CLASS_CATEGORIES[cls];
  if (!wiki) return res.status(400).json({ error: 'Unknown game' });
  if (!category) return res.status(400).json({ error: 'Unknown class' });

  try {
    const params = new URLSearchParams({
      action: 'query', list: 'categorymembers',
      cmtitle: `Category:${category}`, cmnamespace: '0', cmlimit: '500',
      format: 'json',
    });
    const r = await axios.get(`${wiki.api}?${params}`, { timeout: 10000, headers: UA });
    const members = (r.data?.query?.categorymembers || [])
      .map(m => m.title)
      .filter(isRealItemTitle)
      .sort();
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:game/recipe', async (req, res) => {
  const { game } = req.params;
  const { item } = req.query;
  const wiki = WIKIS[game];
  if (!wiki) return res.status(400).json({ error: 'Unknown game' });
  if (!item) return res.status(400).json({ error: 'item required' });

  try {
    const tree = await resolveTree(game, wiki, item, 1, 0, new Set());
    if (tree.isRaw) {
      return res.status(404).json({ error: `No known crafting recipe for "${item}" — it may be a drop, event reward, or base material.` });
    }
    const totalsMap = flattenTotals(tree);
    const totals = Object.entries(totalsMap)
      .map(([name, v]) => ({ name, qty: v.qty, url: v.url }))
      .sort((a, b) => b.qty - a.qty);
    res.json({ tree, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:game/used-in', async (req, res) => {
  const { game } = req.params;
  const { item } = req.query;
  const wiki = WIKIS[game];
  if (!wiki) return res.status(400).json({ error: 'Unknown game' });
  if (!item) return res.status(400).json({ error: 'item required' });

  try {
    const usedIn = await getUsedIn(game, wiki, item);
    res.json(usedIn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin recipe overrides ─────────────────────────────────────────────────

router.get('/:game/override', requireAdmin, async (req, res) => {
  const { game } = req.params;
  const { item } = req.query;
  if (!item) return res.status(400).json({ error: 'item required' });
  const row = await CraftingRecipe.findOne({ where: { game, itemName: item } });
  res.json(row ? { itemName: row.itemName, station: row.station, amount: row.amount, ingredients: JSON.parse(row.ingredients) } : null);
});

router.put('/:game/override', requireAdmin, async (req, res) => {
  const { game } = req.params;
  const { itemName, station, amount, ingredients } = req.body || {};
  if (!itemName || !Array.isArray(ingredients) || !ingredients.length) {
    return res.status(400).json({ error: 'itemName and a non-empty ingredients array are required' });
  }
  const clean = ingredients
    .map(i => ({ name: String(i.name || '').trim(), qty: parseInt(i.qty, 10) || 1 }))
    .filter(i => i.name);
  if (!clean.length) return res.status(400).json({ error: 'At least one valid ingredient is required' });

  const [row] = await CraftingRecipe.findOrCreate({
    where: { game, itemName },
    defaults: { station: station || '', amount: parseInt(amount, 10) || 1, ingredients: '[]' },
  });
  row.station = station || '';
  row.amount = parseInt(amount, 10) || 1;
  row.ingredients = JSON.stringify(clean);
  await row.save();
  recipeCache.clear(); // an edited item may be a "used in" match for others too
  res.json({ ok: true });
});

router.delete('/:game/override', requireAdmin, async (req, res) => {
  const { game } = req.params;
  const { item } = req.query;
  if (!item) return res.status(400).json({ error: 'item required' });
  await CraftingRecipe.destroy({ where: { game, itemName: item } });
  recipeCache.clear();
  res.json({ ok: true });
});

// ── Per-user crafting goals ────────────────────────────────────────────────

router.post('/goals', requireLogin, async (req, res) => {
  const { game, itemName } = req.body || {};
  const wiki = WIKIS[game];
  if (!wiki) return res.status(400).json({ error: 'Unknown game' });
  if (!itemName) return res.status(400).json({ error: 'itemName required' });

  try {
    const tree = await resolveTree(game, wiki, itemName, 1, 0, new Set());
    if (tree.isRaw) return res.status(404).json({ error: `No known crafting recipe for "${itemName}".` });
    const totalsMap = flattenTotals(tree);
    const totals = Object.entries(totalsMap).map(([name, v]) => ({ name, qty: v.qty, url: v.url }));
    const goal = await CraftingGoal.create({
      username: req.user.username, game, itemName,
      totals: JSON.stringify(totals), checked: '[]',
    });
    res.status(201).json({
      id: goal.id, game, itemName, totals, checked: [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/goals', requireLogin, async (req, res) => {
  const goals = await CraftingGoal.findAll({ where: { username: req.user.username }, order: [['createdAt', 'DESC']] });
  res.json(goals.map(g => ({
    id: g.id, game: g.game, itemName: g.itemName,
    totals: JSON.parse(g.totals), checked: JSON.parse(g.checked),
  })));
});

router.put('/goals/:id', requireLogin, async (req, res) => {
  const goal = await CraftingGoal.findOne({ where: { id: req.params.id, username: req.user.username } });
  if (!goal) return res.status(404).json({ error: 'Not found' });
  const { checked } = req.body || {};
  if (!Array.isArray(checked)) return res.status(400).json({ error: 'checked must be an array' });
  goal.checked = JSON.stringify(checked.map(String));
  await goal.save();
  res.json({ ok: true });
});

router.delete('/goals/:id', requireLogin, async (req, res) => {
  await CraftingGoal.destroy({ where: { id: req.params.id, username: req.user.username } });
  res.json({ ok: true });
});

module.exports = router;
