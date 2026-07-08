const express = require('express');
const axios   = require('axios');
const { GameControls } = require('../database');
const router  = express.Router();

const UA = { 'User-Agent': 'OctopusGames/1.0 (https://games.octopustechnology.net)' };

const WIKIS = {
  terraria: { api: 'https://terraria.wiki.gg/api.php',                    name: 'Terraria Wiki',              url: 'https://terraria.wiki.gg/wiki' },
  calamity: { api: 'https://calamitymod.wiki.gg/api.php',                 name: 'Calamity Mod Wiki',          url: 'https://calamitymod.wiki.gg/wiki' },
  minecraft: { api: 'https://minecraft.wiki/api.php',                      name: 'Minecraft Wiki',             url: 'https://minecraft.wiki/w' },
  tekkit:    { api: 'https://ftb.fandom.com/api.php',                      name: 'FTB / Tekkit Wiki',          url: 'https://ftb.fandom.com/wiki' },
  ror2:      { api: 'https://riskofrain2.wiki.gg/api.php',                 name: 'Risk of Rain 2 Wiki',        url: 'https://riskofrain2.wiki.gg/wiki' },
  isaac:     { api: 'https://bindingofisaacrebirth.fandom.com/api.php',    name: 'Binding of Isaac Wiki',      url: 'https://bindingofisaacrebirth.fandom.com/wiki' },
  pokemon:   { api: 'https://bulbapedia.bulbagarden.net/w/api.php',        name: 'Bulbapedia',                 url: 'https://bulbapedia.bulbagarden.net/wiki' },
};

const CONTROL_DEFAULTS = {
  terraria: [
    { section: 'Movement', actions: [
      { action: 'Move Left',           keys: ['A', '←'] },
      { action: 'Move Right',          keys: ['D', '→'] },
      { action: 'Jump',                keys: ['Space'] },
      { action: 'Up / Climb',          keys: ['W', '↑'] },
      { action: 'Down / Drop Through', keys: ['S', '↓'] },
      { action: 'Grapple / Hook',      keys: ['E'] },
      { action: 'Mount / Dismount',    keys: ['R'] },
    ]},
    { section: 'Combat & Items', actions: [
      { action: 'Use Item',            keys: ['Left Click'] },
      { action: 'Alt Use',             keys: ['Right Click'] },
      { action: 'Smart Cursor Toggle', keys: ['Left Shift'] },
      { action: 'Throw Item',          keys: ['T'] },
      { action: 'Hotbar 1–10',         keys: ['1–0', 'Scroll'] },
    ]},
    { section: 'Buffs & Healing', actions: [
      { action: 'Quick Buff',          keys: ['B'] },
      { action: 'Quick Heal',          keys: ['H'] },
      { action: 'Quick Mana',          keys: ['J'] },
    ]},
    { section: 'UI & Map', actions: [
      { action: 'Open Inventory',      keys: ['Esc'] },
      { action: 'Open Map',            keys: ['M'] },
      { action: 'Zoom In Map',         keys: ['+'] },
      { action: 'Zoom Out Map',        keys: ['-'] },
    ]},
  ],
  calamity: [
    { section: 'Movement', actions: [
      { action: 'Move Left',           keys: ['A', '←'] },
      { action: 'Move Right',          keys: ['D', '→'] },
      { action: 'Jump',                keys: ['Space'] },
      { action: 'Up / Climb',          keys: ['W', '↑'] },
      { action: 'Down / Drop Through', keys: ['S', '↓'] },
      { action: 'Grapple / Hook',      keys: ['E'] },
    ]},
    { section: 'Combat & Items', actions: [
      { action: 'Use Item',            keys: ['Left Click'] },
      { action: 'Alt Use',             keys: ['Right Click'] },
      { action: 'Smart Cursor Toggle', keys: ['Left Shift'] },
      { action: 'Hotbar 1–10',         keys: ['1–0', 'Scroll'] },
    ]},
    { section: 'Calamity Extras', actions: [
      { action: 'Rage Mode',           keys: ['Z'] },
      { action: 'Adrenaline',          keys: ['X'] },
    ]},
    { section: 'Buffs & Healing', actions: [
      { action: 'Quick Buff',          keys: ['B'] },
      { action: 'Quick Heal',          keys: ['H'] },
      { action: 'Quick Mana',          keys: ['J'] },
    ]},
  ],
  minecraft: [
    { section: 'Movement', actions: [
      { action: 'Walk Forward',        keys: ['W'] },
      { action: 'Walk Backward',       keys: ['S'] },
      { action: 'Strafe Left',         keys: ['A'] },
      { action: 'Strafe Right',        keys: ['D'] },
      { action: 'Jump / Fly Up',       keys: ['Space'] },
      { action: 'Sneak / Fly Down',    keys: ['Shift'] },
      { action: 'Sprint',              keys: ['Ctrl'] },
    ]},
    { section: 'Actions', actions: [
      { action: 'Attack / Mine',       keys: ['Left Click'] },
      { action: 'Use / Place Block',   keys: ['Right Click'] },
      { action: 'Pick Block',          keys: ['Middle Click'] },
      { action: 'Drop Item',           keys: ['Q'] },
      { action: 'Swap to Offhand',     keys: ['F'] },
    ]},
    { section: 'Inventory & Chat', actions: [
      { action: 'Open Inventory',      keys: ['E'] },
      { action: 'Open Chat',           keys: ['T'] },
      { action: 'Open Command',        keys: ['/'] },
      { action: 'Hotbar 1–9',          keys: ['1–9', 'Scroll'] },
    ]},
    { section: 'Misc', actions: [
      { action: 'Screenshot',          keys: ['F2'] },
      { action: 'Zoom (OptiFine)',      keys: ['C'] },
      { action: 'Toggle Perspective',  keys: ['F5'] },
    ]},
  ],
  tekkit: [
    { section: 'Movement', actions: [
      { action: 'Walk Forward',        keys: ['W'] },
      { action: 'Walk Backward',       keys: ['S'] },
      { action: 'Strafe Left',         keys: ['A'] },
      { action: 'Strafe Right',        keys: ['D'] },
      { action: 'Jump',                keys: ['Space'] },
      { action: 'Sneak',               keys: ['Shift'] },
      { action: 'Sprint',              keys: ['Ctrl'] },
    ]},
    { section: 'Actions', actions: [
      { action: 'Attack / Mine',       keys: ['Left Click'] },
      { action: 'Use / Place Block',   keys: ['Right Click'] },
      { action: 'Drop Item',           keys: ['Q'] },
    ]},
    { section: 'Inventory & Chat', actions: [
      { action: 'Open Inventory',      keys: ['E'] },
      { action: 'Open Chat',           keys: ['T'] },
      { action: 'Hotbar 1–9',          keys: ['1–9', 'Scroll'] },
    ]},
    { section: 'Tekkit / JEI', actions: [
      { action: 'JEI Recipe Lookup',   keys: ['R (hover item)'] },
      { action: 'JEI Usage Lookup',    keys: ['U (hover item)'] },
      { action: 'IC2 Jetpack Fly',     keys: ['R (toggle)'] },
    ]},
  ],
  ror2: [
    { section: 'Movement', actions: [
      { action: 'Move',                keys: ['WASD'] },
      { action: 'Jump',                keys: ['Space'] },
      { action: 'Sprint',              keys: ['Left Shift'] },
    ]},
    { section: 'Combat', actions: [
      { action: 'Primary Attack',      keys: ['Left Click'] },
      { action: 'Secondary',           keys: ['Right Click'] },
      { action: 'Utility',             keys: ['Left Shift'] },
      { action: 'Special',             keys: ['R'] },
      { action: 'Equipment',           keys: ['Q'] },
    ]},
    { section: 'UI & Misc', actions: [
      { action: 'Interact',            keys: ['E'] },
      { action: 'Ping',                keys: ['Alt'] },
      { action: 'Scoreboard',          keys: ['Tab'] },
    ]},
  ],
  isaac: [
    { section: 'Movement', actions: [
      { action: 'Move Up',             keys: ['W', '↑'] },
      { action: 'Move Down',           keys: ['S', '↓'] },
      { action: 'Move Left',           keys: ['A', '←'] },
      { action: 'Move Right',          keys: ['D', '→'] },
    ]},
    { section: 'Shooting', actions: [
      { action: 'Shoot Up',            keys: ['↑', 'I'] },
      { action: 'Shoot Down',          keys: ['↓', 'K'] },
      { action: 'Shoot Left',          keys: ['←', 'J'] },
      { action: 'Shoot Right',         keys: ['→', 'L'] },
    ]},
    { section: 'Items & Actions', actions: [
      { action: 'Use Active Item',     keys: ['E'] },
      { action: 'Drop Bomb',           keys: ['Space'] },
      { action: 'Drop Card / Pill',    keys: ['Q'] },
      { action: 'Drop / Swap Item',    keys: ['Ctrl'] },
    ]},
    { section: 'Misc', actions: [
      { action: 'Pause',               keys: ['Esc', 'P'] },
      { action: 'Map',                 keys: ['Tab'] },
      { action: 'Quick Restart (hold)', keys: ['R'] },
    ]},
  ],
  pokemon: [
    { section: 'Overworld', actions: [
      { action: 'Move',                keys: ['WASD / D-Pad'] },
      { action: 'Confirm / Interact',  keys: ['Z / A'] },
      { action: 'Cancel / Back',       keys: ['X / B'] },
      { action: 'Open Menu',           keys: ['Enter / Start'] },
      { action: 'Run (hold)',           keys: ['Shift / B'] },
    ]},
    { section: 'Battle', actions: [
      { action: 'Select Move 1–4',     keys: ['1–4 / D-Pad'] },
      { action: 'Mega / Z-Move / Tera', keys: ['Dedicated button'] },
      { action: 'Switch Pokémon',      keys: ['Bag → Pokémon'] },
    ]},
  ],
};

const ROR2_CHARACTERS = [
  { name: 'Commando',    unlock: 'Available from the start.' },
  { name: 'Huntress',    unlock: 'Reach and complete the 3rd teleporter event without dying.' },
  { name: 'Bandit',      unlock: 'Complete 20 stages total (across any runs).' },
  { name: 'MUL-T',       unlock: 'Clear the first stage 5 times.' },
  { name: 'Engineer',    unlock: 'Complete 30 stages total (across any runs).' },
  { name: 'Artificer',   unlock: 'Free her from a Newt Shop by paying 10 Lunar Coins.' },
  { name: 'Mercenary',   unlock: 'Obliterate yourself at the Obelisk (loop once → A Moment, Fractured → activate Obelisk).' },
  { name: 'REX',         unlock: 'Carry the Fuel Array from Abyssal Depths to Sundered Grove without dying, then insert it into REX.' },
  { name: 'Loader',      unlock: 'Solve the temple carving puzzle in Siren\'s Call (destroy eggs + kill spawned boss).' },
  { name: 'Acrid',       unlock: 'Enter the Void Fields via null portal. Complete 8 waves and escape.' },
  { name: 'Captain',     unlock: 'Defeat Mithrix (final boss on the Moon). Survive the counter-attack after his defeat.' },
  { name: 'Railgunner',  unlock: '[DLC — Survivors of the Void] Defeat the Void Devastator boss in the Void Locus realm.' },
  { name: 'Void Fiend',  unlock: '[DLC — Survivors of the Void] Complete wave 50 in the Simulacrum.' },
  { name: 'Seeker',      unlock: '[DLC — Seekers of the Storm] Complete the Altar of Gold event in Gilded Coast.' },
  { name: 'False Son',   unlock: '[DLC — Seekers of the Storm] Defeat False Son boss in the new DLC stage.' },
  { name: 'Chef',        unlock: '[DLC — Seekers of the Storm] Complete the Chef-specific DLC questline.' },
];

async function wikiSearch(game, query) {
  const wiki = WIKIS[game];
  if (!wiki) throw new Error(`Unknown game: ${game}`);
  const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '8', format: 'json', origin: '*' });
  const r = await axios.get(`${wiki.api}?${params}`, { timeout: 8000, headers: UA });
  return {
    hits: (r.data?.query?.search || []).map(h => ({
      title:   h.title,
      snippet: h.snippet.replace(/<[^>]+>/g, ''),
      url:     `${wiki.url}/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
    })),
    wikiName: wiki.name,
  };
}

async function wikiPage(game, title) {
  const wiki = WIKIS[game];
  if (!wiki) throw new Error(`Unknown game: ${game}`);
  const params = new URLSearchParams({ action: 'query', prop: 'extracts', titles: title, exintro: '1', explaintext: '1', exsectionformat: 'plain', exlimit: '1', format: 'json', origin: '*' });
  const r = await axios.get(`${wiki.api}?${params}`, { timeout: 8000, headers: UA });
  const pages = Object.values(r.data?.query?.pages || {});
  const page = pages[0];
  return {
    title:    page?.title || title,
    extract:  (page?.extract || '').slice(0, 2000).trim(),
    url:      `${wiki.url}/${encodeURIComponent((page?.title || title).replace(/ /g, '_'))}`,
    wikiName: wiki.name,
  };
}

async function pokeDexLookup(query) {
  const q = query.toLowerCase().replace(/\s+/g, '-');
  const [poke, species] = await Promise.allSettled([
    axios.get(`https://pokeapi.co/api/v2/pokemon/${q}`, { timeout: 8000 }),
    axios.get(`https://pokeapi.co/api/v2/pokemon-species/${q}`, { timeout: 8000 }),
  ]);
  if (poke.status === 'rejected') throw new Error(`Pokémon "${query}" not found.`);
  const p  = poke.value.data;
  const sp = species.status === 'fulfilled' ? species.value.data : null;
  return {
    id:          p.id,
    name:        p.name,
    genus:       sp?.genera?.find(g => g.language.name === 'en')?.genus || '',
    types:       p.types.map(t => t.type.name),
    stats:       p.stats.map(s => ({ name: s.stat.name, value: s.base_stat })),
    abilities:   p.abilities.map(a => a.ability.name + (a.is_hidden ? ' (hidden)' : '')),
    flavorText:  sp?.flavor_text_entries?.find(e => e.language.name === 'en')?.flavor_text.replace(/\f/g, ' ') || '',
    height:      p.height / 10,
    weight:      p.weight / 10,
    sprite:      p.sprites?.front_default || null,
    shinySprite: p.sprites?.front_shiny || null,
    url:         `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(p.name.replace(/-/g, '_'))}`,
  };
}

// ── Public routes (no auth required) ─────────────────────────────────────────

router.get('/search', async (req, res) => {
  const { game, q } = req.query;
  if (!game || !q) return res.status(400).json({ error: 'game and q required' });
  try { res.json(await wikiSearch(game, q)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/page', async (req, res) => {
  const { game, title } = req.query;
  if (!game || !title) return res.status(400).json({ error: 'game and title required' });
  try { res.json(await wikiPage(game, title)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pokedex', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });
  try { res.json(await pokeDexLookup(q)); }
  catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

// Full national dex list (id + name only) for the "All" browse grid. The
// species list is effectively static, so cache it for a day rather than
// re-fetching ~1300 entries from PokeAPI on every click.
let pokedexListCache = null; // { data, exp }
router.get('/pokedex-list', async (req, res) => {
  if (pokedexListCache && pokedexListCache.exp > Date.now()) {
    return res.json(pokedexListCache.data);
  }
  try {
    const r = await axios.get('https://pokeapi.co/api/v2/pokemon-species?limit=100000', { timeout: 15000 });
    const list = (r.data?.results || [])
      .map(s => {
        const m = s.url.match(/\/pokemon-species\/(\d+)\//);
        return { id: m ? parseInt(m[1], 10) : 0, name: s.name };
      })
      .sort((a, b) => a.id - b.id);
    pokedexListCache = { data: list, exp: Date.now() + 24 * 60 * 60 * 1000 };
    res.json(list);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach PokeAPI' });
  }
});

router.get('/ror2-chars', (_req, res) => res.json(ROR2_CHARACTERS));

router.get('/games', (_req, res) => res.json(Object.entries(WIKIS).map(([id, w]) => ({ id, name: w.name }))));

router.get('/controls-defaults', (_req, res) => res.json(CONTROL_DEFAULTS));

// ── Controls routes (login required — applied per-route) ──────────────────────

function requireLogin(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'NOT_AUTHENTICATED' });
}

router.get('/controls/:game', requireLogin, async (req, res) => {
  const { game } = req.params;
  const username = req.user.username;
  const userRow  = await GameControls.findOne({ where: { username, game } });
  if (userRow) return res.json(JSON.parse(userRow.controls));
  const defRow = await GameControls.findOne({ where: { username: null, game } });
  if (defRow) return res.json(JSON.parse(defRow.controls));
  return res.json(CONTROL_DEFAULTS[game] || []);
});

router.put('/controls/:game', requireLogin, async (req, res) => {
  const { game } = req.params;
  const username = req.user.username;
  const { controls } = req.body;
  if (!Array.isArray(controls)) return res.status(400).json({ error: 'controls must be an array' });
  const [row] = await GameControls.findOrCreate({ where: { username, game }, defaults: { controls: '[]' } });
  row.controls = JSON.stringify(controls);
  await row.save();
  res.json({ ok: true });
});

router.delete('/controls/:game', requireLogin, async (req, res) => {
  const { game } = req.params;
  await GameControls.destroy({ where: { username: req.user.username, game } });
  res.json({ ok: true });
});

router.get('/controls/:game/default', async (req, res) => {
  const { game } = req.params;
  const row = await GameControls.findOne({ where: { username: null, game } });
  if (row) return res.json(JSON.parse(row.controls));
  return res.json(CONTROL_DEFAULTS[game] || []);
});

router.put('/controls/:game/default', requireLogin, async (req, res) => {
  const adminUser = (process.env.ADMIN_USERNAME || '').trim();
  if (!adminUser || req.user.username !== adminUser) return res.status(403).json({ error: 'Forbidden' });
  const { game } = req.params;
  const { controls } = req.body;
  if (!Array.isArray(controls)) return res.status(400).json({ error: 'controls must be an array' });
  const [row] = await GameControls.findOrCreate({ where: { username: null, game }, defaults: { controls: '[]' } });
  row.controls = JSON.stringify(controls);
  await row.save();
  res.json({ ok: true });
});

module.exports = router;
