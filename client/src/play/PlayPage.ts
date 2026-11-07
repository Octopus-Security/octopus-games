import { goToLogin, type User } from '../auth';
import { api, type MatchState } from './api';
import { h, button, copyText, absoluteUrl, BTN_PRIMARY, BTN_QUIET, BTN_DANGER } from './dom';
import { renderChess } from './chess';
import { renderPool } from './pool';

export type PlayRoute = { kind: 'm'; id: string } | { kind: 'i'; token: string };

const UIS: Record<string, (root: HTMLElement, ctx: { match: MatchState; send: (m: Record<string, unknown>) => Promise<string | null> }) => void> = {
  chess: renderChess,
  pool: renderPool,
};
const TITLES: Record<string, string> = { chess: 'Chess', pool: 'Pool' };
const rememberKey = (token: string): string => `octopus_play_inv_${token}`;

function shell(): { el: HTMLElement; body: HTMLElement } {
  const el = h('div', 'min-h-screen bg-gray-950 text-white');
  const nav = h('nav', 'bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between gap-3',
    h('span', 'font-bold text-blue-400', '🐙 Octopus Games'));
  const home = h('a', 'min-h-[44px] flex items-center text-sm text-gray-400 hover:text-white', 'All games') as HTMLAnchorElement;
  home.href = '/';
  nav.append(home);
  const body = h('main', 'w-full max-w-[560px] mx-auto');
  el.append(nav, body);
  return { el, body };
}

function notice(body: HTMLElement, title: string, text: string): void {
  body.replaceChildren(h('div', 'px-4 py-10 text-center', h('h1', 'text-xl font-bold mb-2', title), h('p', 'text-gray-400 text-sm', text)));
}

export function renderPlay(route: PlayRoute, user: User | null): HTMLElement {
  const { el, body } = shell();
  if (route.kind === 'i') void inviteFlow(body, route.token, user);
  else void matchFlow(body, `/play/m/${route.id}`, route.id);
  return el;
}

// ── invite link ───────────────────────────────────────────────────────────────
async function inviteFlow(body: HTMLElement, token: string, user: User | null): Promise<void> {
  // A guest who already took a seat comes back through the same link: the seat
  // cookie is scoped to the match path, so go there if it still works.
  try {
    const known = localStorage.getItem(rememberKey(token));
    if (known) {
      const r = await api('GET', `/play/m/${known}/state`);
      if (r.ok) { location.replace(`/play/m/${known}`); return; }
    }
  } catch { /* storage blocked */ }

  const info = await api<{ type: string; title: string; status: string; host: string; seatOpen: boolean; you: { seat: number } | null; matchId: string | null }>('GET', `/play/i/${token}/info`);
  if (!info.ok || !info.data) {
    notice(body, 'This link does not work', 'It may have been cancelled by the person who sent it, or mistyped.');
    return;
  }
  const d = info.data;
  if (d.you && d.matchId) { location.replace(`/play/m/${d.matchId}`); return; }
  if (d.status === 'expired') { notice(body, 'This invite has expired', 'Ask the sender for a new link.'); return; }
  if (!d.seatOpen) {
    await matchFlow(body, `/play/i/${token}`, null);
    return;
  }

  const card = h('div', 'px-4 py-8 flex flex-col gap-4');
  card.append(h('h1', 'text-2xl font-bold', `${d.title || TITLES[d.type] || d.type} with ${d.host}`),
    h('p', 'text-sm text-gray-400', `${d.host} has invited you to a game. No account needed.`));
  const err = h('p', 'text-sm text-amber-300 min-h-[1.25rem]');
  const claim = async (name?: string): Promise<void> => {
    const r = await api<{ matchId?: string; role: string }>('POST', `/play/i/${token}/claim`, name ? { name } : {});
    if (r.status === 400) { err.textContent = r.error === 'NAME_TAKEN' ? 'That name is taken in this game.' : 'Use 1-24 letters, numbers, spaces, dots, dashes or underscores.'; return; }
    if (!r.ok || !r.data) { err.textContent = r.status === 410 ? 'This invite has expired.' : 'Could not join. Try again.'; return; }
    if (r.data.role === 'player' && r.data.matchId) {
      try { localStorage.setItem(rememberKey(token), r.data.matchId); } catch { /* ignore */ }
      location.replace(`/play/m/${r.data.matchId}`);
    } else {
      await matchFlow(body, `/play/i/${token}`, null); // someone else got there first: watch
    }
  };
  if (user) {
    card.append(button(`Join as ${user.username}`, BTN_PRIMARY, b => { b.disabled = true; void claim(); }));
  } else {
    const input = h('input', 'min-h-[44px] w-full bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg px-3 text-base text-white outline-none placeholder:text-gray-600') as HTMLInputElement;
    input.placeholder = 'Your name (1-24 characters)';
    input.maxLength = 24;
    input.setAttribute('autocomplete', 'nickname');
    input.setAttribute('aria-label', 'Your display name');
    const go = (): void => { void claim(input.value); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    card.append(input, button('Play as a guest', BTN_PRIMARY, go),
      h('p', 'text-xs text-gray-500', 'Or'), button('Sign in or create an account', BTN_QUIET, () => goToLogin(false)));
  }
  card.append(err);
  body.replaceChildren(card);
}

// ── a match ───────────────────────────────────────────────────────────────────
async function matchFlow(body: HTMLElement, base: string, matchId: string | null): Promise<void> {
  let current: MatchState | null = null;
  let es: EventSource | null = null;
  let pollTimer: number | undefined;
  let fetching = false;
  const root = h('div', '');
  body.replaceChildren(root);
  // The stage persists across redraws so a game page can keep state (the pool board
  // keeps its canvas, so a new shot can animate from the previous position).
  const top = h('div', '');
  const stage = h('div', '');
  root.append(top, stage);

  async function refresh(): Promise<void> {
    if (fetching) return;
    fetching = true;
    try {
      const r = await api<MatchState>('GET', `${base}/state`);
      if (r.status === 404) { stop(); notice(body, 'Match not found', 'This match does not exist, or the link was cancelled.'); return; }
      if (r.ok && r.data && (!current || r.data.version !== current.version || r.data.status !== current.status)) {
        current = r.data;
        draw();
      } else if (!current) {
        stage.replaceChildren(h('p', 'px-4 py-10 text-center text-gray-500', 'Could not load the match. Retrying…'));
      }
    } finally { fetching = false; }
  }

  async function send(move: Record<string, unknown>): Promise<string | null> {
    if (!current || current.you.seat === null) return 'You are watching this game.';
    const id = matchId || current.id;
    const r = await api<MatchState>('POST', `/play/m/${id}/moves`, { version: current.version, move });
    if (r.ok && r.data) { current = r.data; draw(); return null; }
    if (r.status === 409) { await refresh(); return r.error === 'STALE' ? 'The game moved on. Board refreshed, try again.' : 'This game is not active.'; }
    if (r.status === 422) return r.message ? `Not allowed: ${r.message}.` : 'That move is not allowed.';
    if (r.status === 429) return 'Slow down a little.';
    return 'Could not send the move.';
  }

  function draw(): void {
    const m = current!;
    document.title = `${TITLES[m.type] || m.type} · Octopus Games`;
    const ui = UIS[m.type];
    top.replaceChildren();
    // Challenge actions for the invited player
    if (m.status === 'challenge' && m.you.seat !== null && !m.you.creator) {
      top.append(h('div', 'px-4 py-3 flex flex-wrap items-center gap-2 bg-gray-900 border-b border-gray-800',
        h('span', 'text-sm text-gray-200 w-full', `${m.createdBy} challenged you to ${TITLES[m.type] || m.type}.`),
        button('Accept', BTN_PRIMARY, async () => { await api('POST', `/api/play/matches/${m.id}/accept`); current = null; await refresh(); }),
        button('Decline', BTN_DANGER, async () => { await api('POST', `/api/play/matches/${m.id}/decline`); location.href = '/'; })));
    }
    // Invite link controls for the creator
    if (m.invite && m.you.creator && (m.status === 'open' || m.status === 'active')) {
      const row = h('div', 'px-4 py-3 flex flex-wrap items-center gap-2 bg-gray-900 border-b border-gray-800');
      if (m.status === 'open') row.append(h('span', 'text-sm text-gray-300 w-full', 'Send this link to anyone, no account needed:'));
      const copy = button('Copy invite link', BTN_PRIMARY, async b => { b.textContent = (await copyText(absoluteUrl(m.invite!.path))) ? 'Link copied' : 'Copy failed'; });
      copy.id = 'copyInvite';
      row.append(copy, button('Cancel link', BTN_QUIET, async () => {
        await api('POST', `/api/play/matches/${m.id}/revoke-invite`);
        current = null; await refresh();
      }));
      top.append(row);
    }
    if (m.you.role === 'spectator') top.append(h('div', 'px-4 py-2 text-xs text-gray-400 bg-gray-900', 'You are watching this game.'));
    if (ui) ui(stage, { match: m, send });
    else stage.replaceChildren(h('p', 'px-4 py-10 text-gray-400', 'This game type is not available here yet.'));
  }

  function stop(): void {
    if (es) { es.close(); es = null; }
    window.clearInterval(pollTimer);
  }

  await refresh();
  if (!current) return;

  // Live updates: server-sent events, with polling as the fallback and as a slow
  // safety net in case an intermediary buffers the stream.
  const startPolling = (ms: number): void => {
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => { if (!root.isConnected) { stop(); return; } if (!document.hidden) void refresh(); }, ms);
  };
  if (typeof EventSource !== 'undefined') {
    try {
      es = new EventSource(`${base}/events`);
      es.addEventListener('update', () => void refresh());
      es.addEventListener('closed', () => { stop(); void refresh(); });
      es.onopen = () => startPolling(15000);
      es.onerror = () => startPolling(4000); // the browser reconnects by itself; poll meanwhile
    } catch { startPolling(4000); }
  }
  startPolling(es ? 15000 : 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
}
