import { goToLogin, type User } from '../auth';
import { api, lobbyMessage, type MatchSummary } from './api';
import { h, button, copyText, absoluteUrl, BTN_PRIMARY, BTN_QUIET, BTN_DANGER } from './dom';
import { launchLocal, loadSaved, clearSaved, describeSaved, CLOSED_EVENT, type LocalConfig } from './local';
import type { Level } from './bots';

const TITLES: Record<string, string> = { chess: 'Chess', pool: 'Pool' };

const SELECT_CLS = 'min-h-[44px] w-full bg-gray-800 border border-gray-700 rounded-lg px-2 text-base text-white';

interface GameDef { type: 'chess' | 'pool'; emoji: string; title: string; blurb: string; sides: [string, string, string]; hasVariant: boolean }
const DEFS: GameDef[] = [
  { type: 'chess', emoji: '♞', title: 'Chess', blurb: 'Full rules, draws, resign. Play online, share one device, or play the computer.', sides: ['Random side', 'I play white', 'I play black'], hasVariant: false },
  { type: 'pool', emoji: '🎱', title: 'Pool', blurb: '8-ball or 9-ball with real ball physics. Play online, share one device, or play the computer.', sides: ['Random break', 'I break first', 'I break second'], hasVariant: true },
];
type Mode = 'online' | 'pass' | 'cpu';

function select(id: string, label: string, options: [string, string][], initial?: string): { wrap: HTMLElement; el: HTMLSelectElement } {
  const el = h('select', SELECT_CLS) as HTMLSelectElement;
  el.id = id;
  for (const [v, t] of options) { const o = h('option', '', t) as HTMLOptionElement; o.value = v; el.append(o); }
  if (initial) el.value = initial;
  const lab = h('label', 'text-xs uppercase tracking-wide text-gray-500', label) as HTMLLabelElement;
  lab.htmlFor = id;
  return { wrap: h('div', 'flex flex-col gap-1', lab, el), el };
}

/** The "Play" tab of the hub: Chess and Pool, each in three ways (online, pass and play, vs computer). */
export function renderPlayHub(user: User | null): HTMLElement {
  const el = h('div', 'flex flex-col gap-8');
  el.append(h('div', '',
    h('h2', 'text-xl font-bold text-white', 'Board games'),
    h('p', 'text-sm text-gray-400 mt-1', 'Pick a way to play on each card. Online games can be left and come back to; challenge someone by username or send a link that works without an account. Pass and play and vs Computer run in this browser and need no account.')));

  const cards = h('div', 'grid grid-cols-1 sm:grid-cols-2 gap-4 items-start');
  el.append(cards);
  const reloadLists: (() => void)[] = [];

  for (const def of DEFS) {
    const card = h('div', 'bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-3 min-w-0');
    card.id = `card-${def.type}`;
    card.append(h('div', 'flex items-center gap-3', h('span', 'text-3xl', def.emoji), h('div', 'min-w-0', h('div', 'font-semibold text-white', def.title), h('div', 'text-xs text-gray-500', def.blurb))));

    // mode tabs
    let mode: Mode = user ? 'online' : 'pass';
    const tabs = h('div', 'grid grid-cols-3 gap-1 bg-gray-950 rounded-xl p-1');
    tabs.setAttribute('role', 'tablist');
    const body = h('div', 'flex flex-col gap-3');
    const tabBtns = new Map<Mode, HTMLButtonElement>();
    for (const [m, label] of [['online', 'Online'], ['pass', 'Pass and play'], ['cpu', 'vs Computer']] as [Mode, string][]) {
      const b = h('button', 'min-h-[44px] rounded-lg text-xs sm:text-sm font-medium leading-tight px-1 transition-colors', label) as HTMLButtonElement;
      b.type = 'button'; b.dataset.mode = m;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { mode = m; paint(); });
      tabBtns.set(m, b);
      tabs.append(b);
    }
    card.append(tabs, body);

    const msg = h('p', 'text-sm text-amber-300 min-h-[1.25rem]');
    msg.id = def.type === 'chess' ? 'playMsg' : 'playMsg-pool';
    const inviteOut = h('div', 'flex flex-col gap-2');

    // shared controls (kept between tab switches so a choice is not lost)
    const variant = def.hasVariant ? select(`variant-${def.type}`, 'Game', [['8ball', '8-ball'], ['9ball', '9-ball']], '8ball') : null;
    const sideOnline = select(`side-${def.type}`, def.type === 'chess' ? 'Your colour' : 'Who breaks', [['random', def.sides[0]], ['first', def.sides[1]], ['second', def.sides[2]]]);
    const sideLocal = select(`cpuside-${def.type}`, def.type === 'chess' ? 'You play' : 'Who breaks', [['random', def.sides[0]], ['0', def.sides[1]], ['1', def.sides[2]]]);
    const level = select(`level-${def.type}`, 'Difficulty', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], 'medium');
    const input = h('input', 'min-h-[44px] bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 text-base text-white outline-none placeholder:text-gray-600 w-full') as HTMLInputElement;
    input.placeholder = 'Their username';
    input.id = def.type === 'chess' ? 'challengeName' : 'challengeName-pool';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Username to challenge');

    const body_online = (): HTMLElement[] => {
      if (!user) {
        return [h('p', 'text-sm text-gray-400', 'Sign in to challenge people or create a link. If someone sent you a link, just open it.'),
          button('Sign in', BTN_PRIMARY, () => goToLogin(false))];
      }
      const variantBody = (): Record<string, unknown> => (variant ? { variant: variant.el.value } : {});
      const challenge = async (): Promise<void> => {
        const name = input.value.trim();
        if (!name) { msg.textContent = 'Type a username first.'; return; }
        const r = await api('POST', '/api/play/challenges', { type: def.type, opponent: name, color: sideOnline.el.value, ...variantBody() });
        // Same wording whether or not that name exists: the server does not say.
        msg.textContent = r.ok ? `Challenge sent to ${name}. It stays open for 7 days.` : lobbyMessage(r);
        if (r.ok) { input.value = ''; reloadLists.forEach(f => f()); }
      };
      input.onkeydown = e => { if (e.key === 'Enter') void challenge(); };
      return [
        ...(variant ? [variant.wrap] : []),
        sideOnline.wrap,
        h('div', 'flex flex-col gap-2', h('label', 'text-xs uppercase tracking-wide text-gray-500', 'Challenge a user'), input, button('Challenge', BTN_PRIMARY, () => void challenge())),
        h('label', 'text-xs uppercase tracking-wide text-gray-500 mt-1', 'Or send a link'),
        button('Create invite link', BTN_QUIET, async b => {
          b.disabled = true;
          const r = await api<{ id: string; invite: { path: string } }>('POST', '/api/play/invites', { type: def.type, color: sideOnline.el.value, ...variantBody() });
          b.disabled = false;
          if (!r.ok || !r.data) { msg.textContent = lobbyMessage(r); return; }
          const url = absoluteUrl(r.data.invite.path);
          const field = h('input', 'min-h-[44px] bg-gray-800 border border-gray-700 rounded-lg px-3 text-sm text-gray-200 w-full') as HTMLInputElement;
          field.readOnly = true; field.value = url; field.setAttribute('aria-label', 'Invite link');
          inviteOut.replaceChildren(field, h('div', 'flex gap-2',
            button('Copy invite link', BTN_PRIMARY, async cb => { cb.textContent = (await copyText(url)) ? 'Link copied' : 'Copy failed'; }),
            button('Open game', BTN_QUIET, () => { location.href = `/play/m/${r.data!.id}`; })));
          reloadLists.forEach(f => f());
        }),
        inviteOut, msg,
      ];
    };

    const resumeBox = h('div', 'flex flex-col gap-2');
    const paintResume = (): void => {
      resumeBox.replaceChildren();
      const s = loadSaved(def.type);
      if (!s) return;
      resumeBox.append(h('div', 'bg-gray-950 border border-gray-800 rounded-xl p-3 flex flex-col gap-2',
        h('div', 'text-sm text-gray-200', `Unfinished game: ${describeSaved(s)}`),
        h('div', 'flex gap-2',
          button('Resume', BTN_PRIMARY, () => launchLocal(s.cfg, s)),
          button('Discard', BTN_QUIET, () => { clearSaved(def.type); paintResume(); }))));
    };
    window.addEventListener(CLOSED_EVENT, paintResume);

    const startLocal = (m: 'pass' | 'cpu'): void => {
      let humanSeat: 0 | 1 = 0;
      if (m === 'cpu') {
        const v = sideLocal.el.value;
        humanSeat = v === 'random' ? (Math.random() < 0.5 ? 0 : 1) : (Number(v) as 0 | 1);
      }
      const cfg: LocalConfig = { game: def.type, mode: m, level: level.el.value as Level, variant: (variant ? variant.el.value : '8ball') as LocalConfig['variant'], humanSeat };
      clearSaved(def.type);
      launchLocal(cfg, null);
    };

    function paint(): void {
      for (const [m, b] of tabBtns) {
        const on = m === mode;
        b.setAttribute('aria-selected', String(on));
        b.className = `min-h-[44px] rounded-lg text-xs sm:text-sm font-medium leading-tight px-1 transition-colors ${on ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`;
      }
      if (mode === 'online') { body.replaceChildren(...body_online()); return; }
      const start = button(mode === 'pass' ? 'Start (pass and play)' : 'Start game', BTN_PRIMARY, () => startLocal(mode as 'pass' | 'cpu'));
      start.id = `start-${def.type}-${mode}`;
      body.replaceChildren(
        h('p', 'text-xs text-gray-500', mode === 'pass'
          ? 'Two people, one device, taking turns. Runs in this browser; nothing is saved on a server and no account is needed.'
          : 'Play the computer. It runs in this browser, so it is free for everyone and works without an account.'),
        ...(variant ? [variant.wrap] : []),
        ...(mode === 'cpu' ? [level.wrap, sideLocal.wrap] : []),
        start, resumeBox,
      );
      paintResume();
    }
    paint();
    cards.append(card);
  }

  const lists = h('div', 'flex flex-col gap-8');
  const msg = h('p', 'text-sm text-amber-300 min-h-[1.25rem]');
  if (!user) return el;

  el.append(lists);
  const incomingBox = h('section', 'flex flex-col gap-2');
  const mineBox = h('section', 'flex flex-col gap-2');
  lists.append(msg, incomingBox, mineBox);

  const row = (m: MatchSummary, extra: HTMLElement[]): HTMLElement => {
    const who = m.opponent ? `vs ${m.opponent}${m.opponentKind === 'guest' ? ' (guest)' : ''}` : 'waiting for an opponent';
    const statusText = ({ challenge: 'challenge pending', open: 'invite link open', active: m.yourTurn ? 'your move' : "opponent's move", finished: m.winner === null ? 'draw' : m.winner === m.seat ? 'you won' : 'you lost' } as Record<string, string>)[m.status] || m.status;
    const a = h('a', 'flex-1 min-w-0 min-h-[44px] flex flex-col justify-center') as HTMLAnchorElement;
    a.href = `/play/m/${m.id}`;
    a.append(h('span', 'text-sm text-white truncate', `${TITLES[m.type] || m.type} ${who}`),
      h('span', `text-xs ${m.yourTurn ? 'text-green-400' : 'text-gray-500'}`, statusText));
    return h('div', 'bg-gray-900 border border-gray-800 rounded-xl px-4 py-2 flex flex-wrap items-center gap-2', a, ...extra);
  };

  async function load(): Promise<void> {
    const r = await api<{ incoming: MatchSummary[]; matches: MatchSummary[] }>('GET', '/api/play/matches');
    if (!r.ok || !r.data) return;
    incomingBox.replaceChildren(h('h3', 'font-semibold text-white', 'Incoming challenges'));
    if (!r.data.incoming.length) incomingBox.append(h('p', 'text-sm text-gray-600', 'None right now.'));
    for (const m of r.data.incoming) {
      incomingBox.append(row({ ...m, opponent: m.createdBy }, [
        button('Accept', BTN_PRIMARY, async () => { const a = await api('POST', `/api/play/matches/${m.id}/accept`); if (a.ok) location.href = `/play/m/${m.id}`; else { msg.textContent = lobbyMessage(a); void load(); } }),
        button('Decline', BTN_QUIET, async () => { await api('POST', `/api/play/matches/${m.id}/decline`); void load(); }),
      ]));
    }
    mineBox.replaceChildren(h('h3', 'font-semibold text-white', 'Your matches'));
    if (!r.data.matches.length) mineBox.append(h('p', 'text-sm text-gray-600', 'No matches yet. Challenge someone or create a link.'));
    for (const m of r.data.matches) {
      const extra: HTMLElement[] = [];
      if (m.invite) extra.push(button('Copy invite link', BTN_QUIET, async b => { b.textContent = (await copyText(absoluteUrl(m.invite!.path))) ? 'Link copied' : 'Copy failed'; }));
      if (m.status === 'challenge' || m.status === 'open') extra.push(button('Cancel', BTN_DANGER, async () => { await api('POST', `/api/play/matches/${m.id}/cancel`); void load(); }));
      mineBox.append(row(m, extra));
    }
  }

  reloadLists.push(() => void load());
  void load();
  const timer = window.setInterval(() => { if (!el.isConnected) { window.clearInterval(timer); return; } if (!document.hidden) void load(); }, 15000);
  return el;
}
