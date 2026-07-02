/**
 * crafting.js — Terraria (vanilla + Calamity) crafting calculator.
 *
 * Both wikis expose a Cargo "Recipes" table (result, amount, ings, station).
 * "ings" is delimited by a wiki-specific control character that varies by wiki
 * (vanilla uses U+00A6, Calamity uses U+2021) — we don't hardcode it, we just
 * read the first character of each ingredient token and split on that.
 *
 * Routes (all public, no login — matches the rest of the public wiki data):
 *   GET /api/crafting/:game/classes            which weapon/armor classes exist
 *   GET /api/crafting/:game/browse?class=Melee items in a class (category listing)
 *   GET /api/crafting/:game/recipe?item=NAME   full recursive recipe tree + totals
 *   GET /api/crafting/:game/used-in?item=NAME  what can be crafted USING this item
 */

const express = require('express');
const axios   = require('axios');
const router  = express.Router();

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

function itemUrl(wikiUrl, name) {
  return `${wikiUrl}/${encodeURIComponent(name.replace(/ /g, '_'))}`;
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

async function getRecipes(wikiApi, itemName) {
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

const MAX_DEPTH = 12;

// Recursively expands one item into its full ingredient tree. Items with no
// known Cargo recipe are treated as raw/base materials (ore, drops, event
// rewards, etc.) and become leaves. Alternate recipes exist for many items
// (e.g. two ways to make True Excalibur) — we default to the first one Cargo
// returns and note how many alternates exist so the UI can flag it.
async function resolveTree(wiki, itemName, neededQty, depth, seen) {
  if (depth > MAX_DEPTH || seen.has(itemName)) {
    return { name: itemName, qty: neededQty, isRaw: true, url: itemUrl(wiki.url, itemName) };
  }

  const recipes = await getRecipes(wiki.api, itemName);
  if (!recipes.length) {
    return { name: itemName, qty: neededQty, isRaw: true, url: itemUrl(wiki.url, itemName) };
  }

  const chosen = recipes[0];
  const craftsNeeded = Math.ceil(neededQty / chosen.amount);
  const nextSeen = new Set(seen);
  nextSeen.add(itemName);

  const children = await Promise.all(chosen.ingredients.map(ing =>
    resolveTree(wiki, ing.name, ing.qty * craftsNeeded, depth + 1, nextSeen)
  ));

  return {
    name: itemName,
    qty: neededQty,
    isRaw: false,
    station: chosen.station,
    craftsAmount: chosen.amount,
    craftsNeeded,
    altRecipeCount: recipes.length,
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
// (e.g. "Bar" matching "Iron Bar") get discarded here, not returned.
async function getUsedIn(wiki, itemName) {
  const key = `${wiki.api}::usedin::${itemName}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const safeName = itemName.replace(/"/g, '');
  const params = new URLSearchParams({
    action: 'cargoquery', tables: 'Recipes',
    fields: '_pageName,result,amount,ings,station',
    where: `ings LIKE "%${safeName}%"`,
    limit: '500', format: 'json', origin: '*',
  });
  const r = await axios.get(`${wiki.api}?${params}`, { timeout: 10000, headers: UA });
  const rows = r.data?.cargoquery || [];

  const byResult = new Map();
  for (const row of rows) {
    const t = row.title;
    const ings = parseIngredients(t.ings);
    const match = ings.find(i => i.name === itemName);
    if (!match || !t.result) continue;
    if (!byResult.has(t.result)) {
      byResult.set(t.result, {
        name: t.result,
        qty: match.qty,
        station: t.station || '',
        craftsAmount: parseInt(t.amount, 10) || 1,
        url: itemUrl(wiki.url, t.result),
      });
    }
  }
  const usedIn = Array.from(byResult.values()).sort((a, b) => a.name.localeCompare(b.name));
  cacheSet(key, usedIn);
  return usedIn;
}

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
    const members = (r.data?.query?.categorymembers || []).map(m => m.title).sort();
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
    const tree = await resolveTree(wiki, item, 1, 0, new Set());
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
    const usedIn = await getUsedIn(wiki, item);
    res.json(usedIn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
