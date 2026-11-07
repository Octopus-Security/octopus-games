// Tiny DOM builder. Text goes in with textContent only, so a display name or
// username can never be parsed as markup.
type Child = Node | string | null | undefined | false;

export function h(tag: string, cls = '', ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  }
  return el;
}

export function button(label: string, cls: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = h('button', `min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors ${cls}`, label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => onClick(b));
  return b;
}

export const BTN_PRIMARY = 'bg-blue-600 hover:bg-blue-500 text-white';
export const BTN_QUIET = 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700';
export const BTN_DANGER = 'bg-red-900/60 hover:bg-red-800 text-red-100 border border-red-800';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export const absoluteUrl = (path: string): string => `${location.origin}${path}`;
