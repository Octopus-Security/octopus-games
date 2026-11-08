// The one screen every board game sits in: an app header, a turn banner, a panel for
// each player, the board, and a toolbar. Chess and pool, online, pass and play and vs
// Computer all draw into this, so whose turn it is looks the same everywhere.
//
// Presentation only: nothing in here knows a rule. The game modules decide what the
// banner says and hand it over; this file lays it out and keeps it accessible
// (aria-live on the banner, an icon and words as well as colour).
import { h } from './dom';

export type Tone = 'you' | 'them' | 'wait' | 'think' | 'win' | 'loss' | 'draw' | 'neutral';

export interface Banner {
  tone: Tone;
  /** An emoji or short glyph. Decorative: the words carry the meaning. */
  icon: string;
  title: string;
  sub?: string;
  /** Animated dots after the title ("Computer is thinking..."). */
  dots?: boolean;
}

export interface PlayerCard {
  name: string;
  role: string;
  /** Shown in the round badge. A string is text/emoji; a node is used as is. */
  disc: string | Node;
  discStyle?: string;
  active: boolean;
  /** Spelled-out marker beside the name when active, so colour is never the only signal. */
  flag?: string;
  /** Mini balls, captured pieces, and so on. */
  extra?: (Node | string)[];
}

export interface ScreenOpts {
  kind: 'pool' | 'chess';
  title: string;
  badge?: string;
  /** Back / home control, built by the caller (a button locally, a link online). */
  back: HTMLElement;
  actions?: HTMLElement[];
  /** Cover the page (the local games open over the hub). */
  fixed?: boolean;
}

export interface GameScreen {
  el: HTMLElement;
  /** Where the board goes. */
  stage: HTMLElement;
  tools: HTMLElement;
  side: HTMLElement;
  /** A strip under the header for challenge / invite controls. */
  notice: HTMLElement;
  actions: HTMLElement;
  setBanner(b: Banner): void;
  setPlayers(top: PlayerCard, bottom: PlayerCard): void;
  setTitle(title: string, badge?: string): void;
  toast(text: string, kind?: 'foul' | 'info' | 'check'): void;
}

function playerEl(p: PlayerCard, el: HTMLElement): void {
  el.classList.add('g-player');
  el.classList.toggle('is-active', p.active);
  const disc = h('span', 'g-disc');
  if (typeof p.disc === 'string') disc.textContent = p.disc; else disc.append(p.disc);
  if (p.discStyle) disc.style.cssText = p.discStyle;
  disc.setAttribute('aria-hidden', 'true');
  const flag = h('span', 'g-player-flag', p.active ? (p.flag || 'To move') : '');
  const extra = h('div', 'g-player-extra');
  for (const x of p.extra || []) extra.append(typeof x === 'string' ? document.createTextNode(x) : x);
  el.replaceChildren(disc, h('span', 'g-player-name', p.name), flag, h('span', 'g-player-role', p.role), extra);
  el.dataset.active = p.active ? '1' : '0';
}

export function createGameScreen(o: ScreenOpts): GameScreen {
  const el = h('div', `g-game ${o.fixed ? 'g-game--fixed' : ''}`);
  const title = h('h1', 'g-game-title', o.title);
  const badge = h('span', 'g-game-badge', o.badge || '');
  if (!o.badge) badge.hidden = true;
  const header = h('header', 'g-header', h('div', 'g-header-in', o.back, title, badge));
  const notice = h('div', 'g-notice');

  const play = h('main', 'g-play');
  play.dataset.kind = o.kind;
  const banner = h('div', 'g-banner');
  banner.id = o.kind === 'pool' ? 'poolStatus' : 'statusLine';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-atomic', 'true');
  const bIcon = h('span', 'g-banner-icon');
  bIcon.setAttribute('aria-hidden', 'true');
  const bTitle = h('div', 'g-banner-title');
  const bSub = h('div', 'g-banner-sub');
  banner.append(bIcon, h('div', 'g-banner-text', bTitle, bSub));
  const top = h('section', 'g-top');
  const bot = h('section', 'g-bot');
  top.setAttribute('aria-label', 'Opponent');
  bot.setAttribute('aria-label', 'You');
  const stageOuter = h('div', 'g-stage');
  const stage = h('div', 'g-stage-in');
  const toastEl = h('div', 'g-toast');
  toastEl.hidden = true;
  toastEl.setAttribute('role', 'status');
  stageOuter.append(stage, toastEl);
  const toolsWrap = h('div', 'g-tools');
  const tools = h('div', 'g-tools-main');
  const actions = h('div', 'g-tools-actions');
  toolsWrap.append(tools, actions);
  const side = h('aside', 'g-side');
  actions.append(...(o.actions || []));
  play.append(banner, top, stageOuter, bot, toolsWrap, side);
  el.append(header, notice, play);

  let lastKey = '';
  let lastTone: Tone | null = null;
  let toastTimer = 0;
  banner.addEventListener('animationend', () => banner.classList.remove('is-pulse'));

  return {
    el, stage, tools, side, notice, actions,
    setBanner(b) {
      const key = `${b.tone}|${b.icon}|${b.title}|${b.sub || ''}|${b.dots ? 1 : 0}`;
      if (key === lastKey) return; // an identical redraw must not re-announce itself
      lastKey = key;
      banner.dataset.tone = b.tone;
      bIcon.textContent = b.icon;
      bTitle.textContent = b.title;
      if (b.dots) { const d = h('span', 'g-dots', h('i'), h('i'), h('i')); d.setAttribute('aria-hidden', 'true'); bTitle.append(d); }
      bSub.textContent = b.sub || '';
      // The turn has just come round to you: make it impossible to miss.
      if (b.tone === 'you' && lastTone !== null && lastTone !== 'you') {
        banner.classList.remove('is-pulse');
        void banner.offsetWidth;
        banner.classList.add('is-pulse');
      }
      lastTone = b.tone;
    },
    setPlayers(t, b) { playerEl(t, top); playerEl(b, bot); },
    setTitle(t, bd) { title.textContent = t; if (bd !== undefined) { badge.textContent = bd; badge.hidden = !bd; } },
    toast(text, kind = 'foul') {
      window.clearTimeout(toastTimer);
      toastEl.dataset.kind = kind;
      toastEl.replaceChildren(h('span', '', kind === 'foul' ? '⚠️' : kind === 'check' ? '♚' : 'ℹ️'), h('span', '', text));
      toastEl.hidden = false;
      toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, kind === 'foul' ? 5000 : 3500);
    },
  };
}
