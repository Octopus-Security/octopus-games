import { goToLogin, type User } from '../auth';
import { api, lobbyMessage, type MatchSummary } from './api';
import { h, button, copyText, absoluteUrl, BTN_PRIMARY, BTN_QUIET, BTN_DANGER } from './dom';

const TITLES: Record<string, string> = { chess: 'Chess', pool: 'Pool' };

/** The "Play with friends" tab of the hub. */
export function renderPlayHub(user: User | null): HTMLElement {
  const el = h('div', 'flex flex-col gap-8');
  el.append(h('div', '',
    h('h2', 'text-xl font-bold text-white', 'Play with friends'),
    h('p', 'text-sm text-gray-400 mt-1', 'Turn-based games you can leave and come back to. Challenge someone by username, or send a link that works without an account.')));

  // Game cards
  const cards = h('div', 'grid grid-cols-1 sm:grid-cols-2 gap-4');
  const msg = h('p', 'text-sm text-amber-300 min-h-[1.25rem]');
  msg.id = 'playMsg';
  const inviteOut = h('div', 'flex flex-col gap-2');

  const chessCard = h('div', 'bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col gap-3');
  chessCard.append(h('div', 'flex items-center gap-3', h('span', 'text-3xl', '♞'), h('div', '', h('div', 'font-semibold text-white', 'Chess'), h('div', 'text-xs text-gray-500', 'Full rules, draws, resign. Correspondence-style.'))));
  const poolCard = h('div', 'bg-gray-900/50 border border-gray-800 rounded-2xl p-5 flex items-center gap-3 opacity-70');
  poolCard.append(h('span', 'text-3xl', '🎱'), h('div', '', h('div', 'font-semibold text-gray-300', 'Pool'), h('div', 'text-xs text-gray-500', 'Coming soon')));
  cards.append(chessCard, poolCard);
  el.append(cards);

  const lists = h('div', 'flex flex-col gap-8');

  if (!user) {
    chessCard.append(h('p', 'text-sm text-gray-400', 'Sign in to challenge people or create a link. If someone sent you a link, just open it.'),
      button('Sign in', BTN_PRIMARY, () => goToLogin(false)));
    return el;
  }

  // Challenge a user
  const form = h('div', 'flex flex-col gap-2');
  const input = h('input', 'min-h-[44px] bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 text-base text-white outline-none placeholder:text-gray-600 w-full') as HTMLInputElement;
  input.placeholder = 'Their username';
  input.id = 'challengeName';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Username to challenge');
  const color = h('select', 'min-h-[44px] bg-gray-800 border border-gray-700 rounded-lg px-2 text-base text-white') as HTMLSelectElement;
  color.setAttribute('aria-label', 'Your colour');
  for (const [v, t] of [['random', 'Random side'], ['white', 'I play white'], ['black', 'I play black']]) { const o = h('option', '', t) as HTMLOptionElement; o.value = v; color.append(o); }
  const challenge = async (): Promise<void> => {
    const name = input.value.trim();
    if (!name) { msg.textContent = 'Type a username first.'; return; }
    const r = await api('POST', '/api/play/challenges', { type: 'chess', opponent: name, color: color.value });
    // Same wording whether or not that name exists: the server does not say.
    msg.textContent = r.ok ? `Challenge sent to ${name}. It stays open for 7 days.` : lobbyMessage(r);
    if (r.ok) { input.value = ''; void load(); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') void challenge(); });
  form.append(h('label', 'text-xs uppercase tracking-wide text-gray-500', 'Challenge a user'), input, h('div', 'flex gap-2', color, button('Challenge', BTN_PRIMARY, () => void challenge())));
  chessCard.append(form);

  chessCard.append(h('label', 'text-xs uppercase tracking-wide text-gray-500 mt-2', 'Or send a link'),
    button('Create invite link', BTN_QUIET, async b => {
      b.disabled = true;
      const r = await api<{ id: string; invite: { path: string } }>('POST', '/api/play/invites', { type: 'chess', color: color.value });
      b.disabled = false;
      if (!r.ok || !r.data) { msg.textContent = lobbyMessage(r); return; }
      const url = absoluteUrl(r.data.invite.path);
      const field = h('input', 'min-h-[44px] bg-gray-800 border border-gray-700 rounded-lg px-3 text-sm text-gray-200 w-full') as HTMLInputElement;
      field.readOnly = true; field.value = url; field.setAttribute('aria-label', 'Invite link');
      inviteOut.replaceChildren(field, h('div', 'flex gap-2',
        button('Copy invite link', BTN_PRIMARY, async cb => { cb.textContent = (await copyText(url)) ? 'Link copied' : 'Copy failed'; }),
        button('Open game', BTN_QUIET, () => { location.href = `/play/m/${r.data!.id}`; })));
      void load();
    }), inviteOut, msg);

  const incomingBox = h('section', 'flex flex-col gap-2');
  const mineBox = h('section', 'flex flex-col gap-2');
  lists.append(incomingBox, mineBox);
  el.append(lists);

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

  void load();
  const timer = window.setInterval(() => { if (!el.isConnected) { window.clearInterval(timer); return; } if (!document.hidden) void load(); }, 15000);
  return el;
}
