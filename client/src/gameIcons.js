// The tab icon for each game. ONE place to edit. The default (no game open) is the
// brand icon from octopus-auth, which the page already links in index.html; this
// module only swaps it while a game screen is open and puts it back after.
//
// Keys are a game slug or type ('pool', 'snake', ...); a card game is matched by its
// hub category ('Cards'), so every card game, current and future, gets the cards.
// Anything not listed here keeps the default icon.

export const GAME_ICONS = {
  pool: '🎱',
  snake: '🐍',
  frogger: '🐸',
  chess: '♟️',
};

/** Hub category -> icon, for groups of games. */
export const CATEGORY_ICONS = {
  Cards: '🃏',
};

/** Emoji for a game, or null for "use the default". Slug wins over category. */
export function iconFor(slug, category) {
  if (slug && Object.prototype.hasOwnProperty.call(GAME_ICONS, slug)) return GAME_ICONS[slug];
  if (category && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, category)) return CATEGORY_ICONS[category];
  return null;
}

/** An emoji as an SVG data URI (same idea as the kit's brand emoji SVG). */
export function emojiDataUri(emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

let saved = null; // the default <link rel="icon"> href, kept while a game icon is shown

function iconLink() {
  return typeof document === 'undefined' ? null : document.querySelector('link[rel="icon"]');
}

/** Show the icon for this game, or the default when it has none. */
export function setGameIcon(slug, category) {
  const link = iconLink();
  if (!link) return;
  const emoji = iconFor(slug, category);
  if (!emoji) { resetGameIcon(); return; }
  if (saved === null) saved = link.getAttribute('href') || '';
  link.setAttribute('href', emojiDataUri(emoji));
}

/** Back to the default icon. Safe to call when nothing was changed. */
export function resetGameIcon() {
  const link = iconLink();
  if (link && saved !== null) link.setAttribute('href', saved);
  saved = null;
}

/**
 * For the arcade games, which hide the hub (display:none) while open and show it again
 * on Back: set the icon now, restore the default when the hub is visible again.
 */
export function showIconWhileHubHidden(hubEl, slug, category) {
  setGameIcon(slug, category);
  if (typeof MutationObserver === 'undefined' || !hubEl) return;
  const mo = new MutationObserver(() => {
    if (hubEl.style.display !== 'none') { mo.disconnect(); resetGameIcon(); }
  });
  mo.observe(hubEl, { attributes: true, attributeFilter: ['style'] });
}
