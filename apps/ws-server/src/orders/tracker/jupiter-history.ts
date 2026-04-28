// Thin client for Jupiter Trigger Order v2 History endpoint, plus the cancel
// initiate / confirm endpoints used by the OCO auto-cancel path.

const JUPITER_BASE = process.env.NEXT_PUBLIC_JUPITER_API_BASE ?? 'https://lite-api.jup.ag';
export const JUPITER_HISTORY = '/trigger/v2/orders/history';
export const JUPITER_CANCEL_INITIATE = '/trigger/v2/orders/cancel/initiate';
export const JUPITER_CANCEL_CONFIRM = '/trigger/v2/orders/cancel/confirm';

export type JupiterOrderStatus =
  | 'OPEN'
  | 'FILLED'
  | 'PARTIALLY_FILLED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface JupiterHistoryEntry {
  id: string;
  status: JupiterOrderStatus;
  filledAmount?: string;
  outAmount?: string;
  inAmount?: string;
  filledAt?: number;
  expiresAt?: number;
}

export async function fetchHistoryForWallet(
  walletAddress: string,
): Promise<JupiterHistoryEntry[]> {
  const url = `${JUPITER_BASE}${JUPITER_HISTORY}?wallet=${encodeURIComponent(walletAddress)}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      console.warn(`[tracker] jupiter history ${walletAddress.slice(0, 6)}… ${res.status}`);
      return [];
    }
    const j = (await res.json()) as { orders?: JupiterHistoryEntry[] };
    return j.orders ?? [];
  } catch (err) {
    console.warn('[tracker] jupiter history fetch failed', err);
    return [];
  }
}

export function jupiterUrl(path: string): string {
  return `${JUPITER_BASE}${path}`;
}
