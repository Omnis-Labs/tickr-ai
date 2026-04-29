// Server-only helper: read a wallet's USDC balance via Solana RPC.
//
// Used by /api/portfolio to populate cashUsd. We cache per-wallet for 60s
// so the desk page's 15s portfolio refetch doesn't pound the RPC. Cache
// is module-scoped; in dev/Vercel the function-instance recycles regularly
// so this stays cheap.

import 'server-only';
import { Connection, PublicKey } from '@solana/web3.js';
import { USDC_DECIMALS, USDC_MINT, parseRpcUrls } from '@hunch-it/shared';

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TTL_MS = 60_000;

let lazyConn: Connection | null = null;
function getConn(): Connection {
  if (lazyConn) return lazyConn;
  const rpcUrls = parseRpcUrls(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS);
  lazyConn = new Connection(rpcUrls[0]!, 'confirmed');
  return lazyConn;
}

const cache = new Map<string, { at: number; usd: number }>();

/**
 * Returns the wallet's USDC balance in USD (decimals already applied).
 * Returns 0 on any failure — caller treats this as "unknown / no funds".
 */
export async function readUsdcBalance(walletAddress: string): Promise<number> {
  const cached = cache.get(walletAddress);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.usd;

  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    return 0;
  }

  try {
    const res = await getConn().getParsedTokenAccountsByOwner(owner, {
      programId: new PublicKey(SPL_TOKEN_PROGRAM),
    });
    let raw = 0;
    for (const acct of res.value) {
      const info = acct.account.data;
      if (!('parsed' in info) || !info.parsed?.info?.mint) continue;
      if (info.parsed.info.mint !== USDC_MINT) continue;
      const amount = Number(info.parsed.info.tokenAmount?.amount ?? '0');
      raw += amount;
    }
    const usd = raw / 10 ** USDC_DECIMALS;
    cache.set(walletAddress, { at: Date.now(), usd });
    return usd;
  } catch (err) {
    console.warn(`[portfolio] usdc balance fetch failed for ${walletAddress.slice(0, 6)}…`, err);
    return 0;
  }
}
