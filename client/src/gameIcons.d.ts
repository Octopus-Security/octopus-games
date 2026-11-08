export const GAME_ICONS: Record<string, string>;
export const CATEGORY_ICONS: Record<string, string>;
export function iconFor(slug?: string | null, category?: string | null): string | null;
export function emojiDataUri(emoji: string): string;
export function setGameIcon(slug?: string | null, category?: string | null): void;
export function resetGameIcon(): void;
export function showIconWhileHubHidden(hubEl: HTMLElement, slug?: string | null, category?: string | null): void;
