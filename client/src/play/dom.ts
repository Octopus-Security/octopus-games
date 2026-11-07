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
  const b = h('button', `g-btn ${cls}`, label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => onClick(b));
  return b;
}

export const BTN_PRIMARY = 'g-btn-primary';
export const BTN_QUIET = '';
export const BTN_DANGER = 'g-btn-danger';

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
