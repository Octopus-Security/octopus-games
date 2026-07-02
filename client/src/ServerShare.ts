// Standalone public share page for a single game server: /server/:id
import { type ShareServer, buildDiscord, buildPlain, shareLink, modsBlockHtml, instructionsBlockHtml } from './serverShareCard';

function addr(s: ShareServer): string {
  return s.serverIP && s.port ? `${s.serverIP}:${s.port}` : (s.serverIP || '');
}

function copyBtn(label: string, getText: () => string): string {
  return `<button data-copy="${encodeURIComponent(getText())}" class="copy-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors">${label}</button>`;
}

export function renderServerShare(id: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'min-h-screen bg-gray-950 text-white';

  el.innerHTML = `
    <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <a href="/" class="font-bold text-blue-400 text-lg">🐙 Octopus Games</a>
      <a href="/" class="text-sm text-gray-500 hover:text-gray-300">All servers →</a>
    </nav>
    <main class="max-w-lg mx-auto px-4 py-10">
      <div id="shareBody"><p class="text-center text-gray-600 py-16">Loading…</p></div>
    </main>
  `;

  const body = el.querySelector('#shareBody') as HTMLElement;

  fetch(`/api/public/game-servers/${encodeURIComponent(id)}`)
    .then(async r => {
      if (r.status === 404) throw new Error('This server does not exist.');
      if (r.status === 403) throw new Error('private');
      if (!r.ok) throw new Error('Could not load this server.');
      return r.json() as Promise<ShareServer>;
    })
    .then(s => {
      const online = s.status === 'running';
      const badge = online
        ? '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-400 border border-green-800">Online</span>'
        : '<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/50 text-red-400 border border-red-800">Offline</span>';
      const hasDetails = !!s.serverIP;

      body.innerHTML = `
        <div class="bg-gray-900 border border-gray-700 rounded-2xl p-6">
          <div class="flex items-start justify-between gap-2 mb-4">
            <div class="flex items-center gap-3">
              <span class="text-4xl">${s.emoji}</span>
              <div>
                <h1 class="text-xl font-bold text-white leading-tight">${s.name}</h1>
                <span class="text-sm text-gray-500">${s.label}</span>
              </div>
            </div>
            ${badge}
          </div>
          ${s.description ? `<p class="text-sm text-gray-400 leading-relaxed mb-4">${s.description}</p>` : ''}
          ${hasDetails ? `
            <div class="space-y-2 mb-5">
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500 w-20 shrink-0">Address</span>
                <code class="text-sm text-blue-300 font-mono bg-gray-800 px-2 py-1 rounded select-all">${addr(s)}</code>
              </div>
              ${s.password ? `<div class="flex items-center gap-2">
                <span class="text-xs text-gray-500 w-20 shrink-0">Password</span>
                <code class="text-sm text-yellow-300 font-mono bg-gray-800 px-2 py-1 rounded select-all">${s.password}</code>
              </div>` : ''}
              ${s.gameVersion ? `<div class="flex items-center gap-2">
                <span class="text-xs text-gray-500 w-20 shrink-0">Version</span>
                <span class="text-sm text-gray-400">${s.gameVersion}</span>
              </div>` : ''}
            </div>
            ${modsBlockHtml(s)}
            ${instructionsBlockHtml(s)}
            <p class="text-xs text-gray-600 uppercase tracking-wide mb-2">Copy as…</p>
            <div class="flex gap-2 flex-wrap mb-5">
              ${copyBtn('Discord embed', () => buildDiscord(s))}
              ${copyBtn('Plain text', () => buildPlain(s))}
              ${copyBtn('IP:Port', () => addr(s))}
              ${s.password ? copyBtn('Password', () => s.password!) : ''}
            </div>` : ''}
          <p class="text-xs text-gray-600 uppercase tracking-wide mb-2">Shareable link</p>
          <div class="flex gap-2">
            <input class="link-input flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono outline-none min-w-0" readonly value="${shareLink(s)}" />
            <button class="copy-link px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs shrink-0 transition-colors">Copy</button>
          </div>
        </div>
      `;

      body.querySelectorAll('.copy-btn').forEach(b => {
        b.addEventListener('click', async () => {
          const text = decodeURIComponent((b as HTMLElement).dataset.copy || '');
          try {
            await navigator.clipboard.writeText(text);
            const prev = b.textContent;
            b.textContent = '✓ Copied';
            setTimeout(() => { b.textContent = prev; }, 1600);
          } catch { /* noop */ }
        });
      });

      const linkInput = body.querySelector('.link-input') as HTMLInputElement;
      body.querySelector('.copy-link')?.addEventListener('click', async () => {
        linkInput.select();
        try {
          await navigator.clipboard.writeText(shareLink(s));
          const btn = body.querySelector('.copy-link') as HTMLButtonElement;
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
        } catch { /* noop */ }
      });
    })
    .catch((e: Error) => {
      if (e.message === 'private') {
        body.innerHTML = `
          <div class="bg-gray-900 border border-gray-700 rounded-2xl p-6 text-center">
            <p class="text-4xl mb-3">🔒</p>
            <h1 class="text-lg font-bold text-white mb-2">Private server</h1>
            <p class="text-sm text-gray-500 mb-4">You need to be signed in with an account that has access to view this server.</p>
            <a href="/" class="inline-block text-sm px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg">Go to Octopus Games</a>
          </div>`;
      } else {
        body.innerHTML = `<div class="bg-gray-900 border border-gray-700 rounded-2xl p-6 text-center">
          <p class="text-sm text-red-400">${e.message}</p>
          <a href="/" class="inline-block mt-4 text-sm text-blue-400 hover:underline">← All servers</a>
        </div>`;
      }
    });

  return el;
}
