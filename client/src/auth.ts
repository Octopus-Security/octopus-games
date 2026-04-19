export interface User {
  username: string;
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

export async function login(username: string, password: string): Promise<string | null> {
  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error || 'Login failed';
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
