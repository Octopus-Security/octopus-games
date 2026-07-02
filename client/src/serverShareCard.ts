// Shareable server card: Discord/plain-text formats + a share modal.
// Mirrors the copyable card format used in cortex's admin panel.

export interface ShareMod { name: string; url: string; }

export interface ShareServer {
  id: number;
  name: string;
  label: string;
  emoji: string;
  status: string;
  visibility?: string;
  serverIP?: string;
  port?: number;
  password?: string;
  gameVersion?: string;
  description?: string;
  modPlatform?: string | null;
  mods?: ShareMod[];
  modpackUrl?: string;
  loader?: string;
  instructions?: string[];
}

const PLATFORM_LABELS: Record<string, string> = {
  steam: 'Steam Workshop mods',
  thunderstore: 'Thunderstore mods',
  nexus: 'Nexus mods (SMAPI)',
  modpack: 'Modpack',
  workshop_collection: 'Steam Workshop collection',
};

export function modsBlockHtml(s: ShareServer): string {
  const parts: string[] = [];
  if (s.mods && s.mods.length) {
    const label = PLATFORM_LABELS[s.modPlatform || ''] || 'Required mods';
    parts.push(`<p class="text-xs text-gray-600 uppercase tracking-wide mb-2">${label}</p>`);
    parts.push('<div class="flex flex-col gap-1 mb-4">' + s.mods.map(m =>
      `<a href="${m.url}" target="_blank" rel="noopener" class="text-sm text-blue-400 hover:underline break-all">↗ ${m.name}</a>`
    ).join('') + '</div>');
  }
  if (s.modPlatform === 'modpack' && s.modpackUrl) {
    parts.push(`<p class="text-xs text-gray-600 uppercase tracking-wide mb-2">Modpack</p>`);
    parts.push(`<a href="${s.modpackUrl}" target="_blank" rel="noopener" class="text-sm text-blue-400 hover:underline break-all mb-4 block">↗ Download modpack</a>`);
  }
  return parts.join('');
}

export function instructionsBlockHtml(s: ShareServer): string {
  if (!s.instructions || !s.instructions.length) return '';
  const steps = s.instructions.map(line => `<li class="text-sm text-gray-400 leading-relaxed mb-1.5">${line}</li>`).join('');
  return `<p class="text-xs text-gray-600 uppercase tracking-wide mb-2">How to connect</p>
    <ol class="list-decimal list-inside mb-4 marker:text-gray-600">${steps}</ol>`;
}

function addr(s: ShareServer): string {
  return s.serverIP && s.port ? `${s.serverIP}:${s.port}` : (s.serverIP || '');
}

export function buildDiscord(s: ShareServer): string {
  const sep = '━━━━━━━━━━━━━━━━━━━━';
  const lines = [
    `**${s.emoji} ${s.name}** ・ ${s.label}`,
    sep,
    `🌐  **Address:** \`${addr(s)}\``,
  ];
  if (s.password)    lines.push(`🔑  **Password:** \`${s.password}\``);
  if (s.gameVersion) lines.push(`🎮  **Version:** ${s.gameVersion}`);
  if (s.modPlatform === 'modpack' && s.modpackUrl) lines.push(`📦  **Modpack:** ${s.modpackUrl}`);
  if (s.mods && s.mods.length) lines.push(`📦  **Mods:** ${s.mods.map(m => m.name).join(' • ')}`);
  lines.push(sep);
  return lines.join('\n');
}

export function buildPlain(s: ShareServer): string {
  const lines = [
    `${s.name} (${s.label})`,
    `Address: ${addr(s)}`,
  ];
  if (s.password)    lines.push(`Password: ${s.password}`);
  if (s.gameVersion) lines.push(`Version: ${s.gameVersion}`);
  if (s.modPlatform === 'modpack' && s.modpackUrl) lines.push(`Modpack: ${s.modpackUrl}`);
  if (s.mods && s.mods.length) lines.push(`Mods: ${s.mods.map(m => m.name).join(', ')}`);
  return lines.join('\n');
}

export function shareLink(s: ShareServer): string {
  return `${location.origin}/server/${s.id}`;
}

function copyBtn(label: string, getText: () => string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors';
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      const prev = b.textContent;
      b.textContent = '✓ Copied';
      setTimeout(() => { b.textContent = prev; }, 1600);
    } catch { b.textContent = 'Copy failed'; }
  });
  return b;
}

// Opens a centered modal with the share link + copy buttons for a server.
export function openShareModal(s: ShareServer): void {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto';
  overlay.addEventListener('click', () => overlay.remove());

  const card = document.createElement('div');
  card.className = 'bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md';
  card.addEventListener('click', e => e.stopPropagation());

  const hasDetails = !!s.serverIP;

  card.innerHTML = `
    <div class="flex items-start justify-between gap-2 mb-4">
      <div class="flex items-center gap-2">
        <span class="text-3xl">${s.emoji}</span>
        <div>
          <h3 class="text-lg font-bold text-white leading-tight">${s.name}</h3>
          <span class="text-xs text-gray-500">${s.label}</span>
        </div>
      </div>
      <button class="close-btn text-gray-500 hover:text-gray-300 text-xl leading-none">✕</button>
    </div>
    ${hasDetails ? `
      <div class="space-y-1 mb-4">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500 w-16 shrink-0">Address</span>
          <code class="text-sm text-blue-300 font-mono bg-gray-800 px-2 py-0.5 rounded select-all">${addr(s)}</code>
        </div>
        ${s.password ? `<div class="flex items-center gap-2">
          <span class="text-xs text-gray-500 w-16 shrink-0">Password</span>
          <code class="text-sm text-yellow-300 font-mono bg-gray-800 px-2 py-0.5 rounded select-all">${s.password}</code>
        </div>` : ''}
        ${s.gameVersion ? `<div class="flex items-center gap-2">
          <span class="text-xs text-gray-500 w-16 shrink-0">Version</span>
          <span class="text-xs text-gray-400">${s.gameVersion}</span>
        </div>` : ''}
      </div>` : `
      <p class="text-sm text-gray-500 mb-4">This server is private — connection details are only shown to people you've given access.</p>`}
    ${hasDetails ? modsBlockHtml(s) : ''}
    ${hasDetails ? instructionsBlockHtml(s) : ''}
    <p class="text-xs text-gray-600 uppercase tracking-wide mb-2">Shareable link</p>
    <div class="flex gap-2 mb-4">
      <input class="link-input flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono outline-none min-w-0" readonly value="${shareLink(s)}" />
      <button class="copy-link px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs shrink-0 transition-colors">Copy</button>
    </div>
    ${hasDetails ? `
      <p class="text-xs text-gray-600 uppercase tracking-wide mb-2">Copy as…</p>
      <div class="copy-row flex gap-2 flex-wrap"></div>` : ''}
  `;

  card.querySelector('.close-btn')!.addEventListener('click', () => overlay.remove());

  const linkInput = card.querySelector('.link-input') as HTMLInputElement;
  card.querySelector('.copy-link')!.addEventListener('click', async () => {
    linkInput.select();
    try {
      await navigator.clipboard.writeText(shareLink(s));
      const btn = card.querySelector('.copy-link') as HTMLButtonElement;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
    } catch { /* noop */ }
  });

  if (hasDetails) {
    const row = card.querySelector('.copy-row') as HTMLElement;
    row.appendChild(copyBtn('Discord embed', () => buildDiscord(s)));
    row.appendChild(copyBtn('Plain text', () => buildPlain(s)));
    row.appendChild(copyBtn('IP:Port', () => addr(s)));
    if (s.password) row.appendChild(copyBtn('Password', () => s.password!));
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
