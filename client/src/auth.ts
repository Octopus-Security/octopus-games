export interface User {
  username: string;
  role?: string;
}

export async function getUser(): Promise<User | null> {
  try {
    const res = await fetch('/api/me');
    if (res.ok) return res.json();
    return null;
  } catch {
    return null;
  }
}

// Auth is centralized at auth.octopustechnology.net (single SSO login page that
// sets the shared octopus_sso cookie). Games has no local login form — it sends
// the user to the central page and comes back to where they were.
export const AUTH_BASE = 'https://auth.octopustechnology.net';

export function goToLogin(register = false): void {
  const back = encodeURIComponent(location.href);
  const path = register ? '/register' : '/login';
  location.href = `${AUTH_BASE}${path}?redirect=${back}`;
}

export async function logout(): Promise<void> {
  await fetch('/logout', { method: 'POST' });
}

export async function loadSave<T>(slug: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/games/${slug}/save`);
    if (!res.ok) return null;
    const data = await res.json();
    return Object.keys(data).length ? (data as T) : null;
  } catch {
    return null;
  }
}

export async function writeSave(slug: string, data: unknown): Promise<void> {
  await fetch(`/api/games/${slug}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
