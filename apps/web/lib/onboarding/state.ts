// Onboarding completion flag — keyed by wallet so a user switching
// wallets sees the wizard the first time. Stored in localStorage; this
// is purely UX routing (the source of truth for "ready to trade" stays
// the Mandate row in the DB).

const KEY_PREFIX = 'onboarded:';

function key(wallet: string | null | undefined): string | null {
  if (!wallet) return null;
  return `${KEY_PREFIX}${wallet}`;
}

export function hasOnboarded(wallet: string | null | undefined): boolean {
  if (typeof window === 'undefined') return false;
  const k = key(wallet);
  if (!k) return false;
  return window.localStorage.getItem(k) === '1';
}

export function markOnboarded(wallet: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  const k = key(wallet);
  if (!k) return;
  window.localStorage.setItem(k, '1');
}
