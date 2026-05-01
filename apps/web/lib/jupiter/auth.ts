// Jupiter Trigger v2 authentication.
//
// v2 mandates a per-wallet JWT obtained via a 2-step challenge/verify
// flow. The wallet signs Jupiter's challenge with its private key,
// proves ownership, and gets a 24h JWT back. The JWT goes on every
// user-scoped request as `Authorization: Bearer <jwt>` alongside the
// `x-api-key` header.
//
// Two signing paths exist on Jupiter's side: `message` (sign a UTF-8
// string, base58-encode the signature) and `transaction` (sign a
// base64 tx, return signed base64). We use `transaction` because
// our UnifiedWallet exposes signTransaction natively across providers
// (Privy, demo stub, future Phantom direct), but doesn't yet expose
// signMessage.
//
// JWTs are cached per wallet address in localStorage so a tab refresh
// doesn't re-trigger a Privy modal. They also live in an in-memory
// Map for fast access during a single page lifetime.

import { VersionedTransaction, Transaction } from '@solana/web3.js';
import { jupiterUrl } from './config.js';

const CHALLENGE_PATH = '/trigger/v2/auth/challenge';
const VERIFY_PATH = '/trigger/v2/auth/verify';
const STORAGE_PREFIX = 'jupiter:jwt:';
// JWTs are 24h on Jupiter's side. We refresh 30 min early so concurrent
// in-flight requests never see a token expiring mid-flight.
const REFRESH_MARGIN_MS = 30 * 60 * 1000;

interface JwtRecord {
  token: string;
  expiresAt: number;
}

const memCache = new Map<string, JwtRecord>();

function readCached(walletAddress: string): JwtRecord | null {
  const mem = memCache.get(walletAddress);
  if (mem && mem.expiresAt - REFRESH_MARGIN_MS > Date.now()) return mem;
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + walletAddress);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as JwtRecord;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt - REFRESH_MARGIN_MS <= Date.now()) return null;
    memCache.set(walletAddress, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function persist(walletAddress: string, record: JwtRecord): void {
  memCache.set(walletAddress, record);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_PREFIX + walletAddress, JSON.stringify(record));
  }
}

export function clearJupiterJwt(walletAddress: string): void {
  memCache.delete(walletAddress);
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_PREFIX + walletAddress);
  }
}

interface ChallengeResponse {
  /** base64 transaction we sign and bounce back. */
  transaction: string;
  /** Some endpoints also return a server-side challenge id — capture it
   *  loosely so the verify call can echo whatever Jupiter expects. */
  challengeId?: string;
  expiresAt?: number;
}

interface VerifyResponse {
  token: string;
  /** Spec says JWT is 24h; if the server tells us, prefer that. */
  expiresAt?: number;
}

interface SignTransaction {
  <T extends VersionedTransaction | Transaction>(tx: T): Promise<T>;
}

export interface JupiterAuthInput {
  walletAddress: string;
  signTransaction: SignTransaction;
  /** When provided, after a successful challenge/verify the new JWT is
   *  PATCHed to /api/users/me/jupiter-jwt so the ws-server tracker can
   *  poll Jupiter on the user's behalf. Cache-hit calls skip this — we
   *  only sync on a fresh issue. */
  persistToServer?: (jwt: string, expiresAt: number) => Promise<void>;
}

/**
 * Returns a JWT good for at least REFRESH_MARGIN_MS more. Reads cache
 * first; on miss runs challenge → wallet sign → verify. Throws if the
 * api-key isn't configured (caller should surface a banner) or if the
 * Privy modal was rejected.
 */
export async function getJupiterJwt(input: JupiterAuthInput): Promise<string> {
  const cached = readCached(input.walletAddress);
  if (cached) return cached.token;

  // 1. Ask Jupiter for a challenge transaction tied to this wallet. The
  //    /api/jupiter proxy attaches x-api-key server-side; browser
  //    calling api.jup.ag directly would fail CORS preflight on that
  //    header.
  const challengeRes = await fetch(jupiterUrl(CHALLENGE_PATH), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletPubkey: input.walletAddress, type: 'transaction' }),
  });
  if (!challengeRes.ok) {
    const text = await challengeRes.text().catch(() => '');
    throw new Error(`Jupiter challenge failed (${challengeRes.status}): ${text}`);
  }
  const challenge = (await challengeRes.json()) as ChallengeResponse;
  if (!challenge.transaction) {
    throw new Error('Jupiter challenge response missing `transaction`');
  }

  // 2. Decode the unsigned tx, ask the wallet to sign.
  const txBytes = Uint8Array.from(Buffer.from(challenge.transaction, 'base64'));
  let unsigned: VersionedTransaction | Transaction;
  try {
    unsigned = VersionedTransaction.deserialize(txBytes);
  } catch {
    unsigned = Transaction.from(txBytes);
  }
  const signed = await input.signTransaction(unsigned);
  const signedBytes =
    signed instanceof VersionedTransaction
      ? signed.serialize()
      : (signed as Transaction).serialize();
  const signedB64 = Buffer.from(signedBytes).toString('base64');

  // 3. Send the signed tx back to verify and exchange for a JWT.
  const verifyRes = await fetch(jupiterUrl(VERIFY_PATH), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      walletPubkey: input.walletAddress,
      transaction: signedB64,
      ...(challenge.challengeId ? { challengeId: challenge.challengeId } : {}),
    }),
  });
  if (!verifyRes.ok) {
    const text = await verifyRes.text().catch(() => '');
    throw new Error(`Jupiter verify failed (${verifyRes.status}): ${text}`);
  }
  const verify = (await verifyRes.json()) as VerifyResponse;
  if (!verify.token) {
    throw new Error('Jupiter verify response missing `token`');
  }

  const expiresAt = verify.expiresAt ?? Date.now() + 24 * 3600 * 1000;
  persist(input.walletAddress, { token: verify.token, expiresAt });
  // Best-effort sync to server so the tracker can use the JWT too. We
  // don't await because a network blip here shouldn't block the user
  // from placing their order — the next tracker tick that 401s will
  // self-heal once the next refresh lands.
  if (input.persistToServer) {
    void input.persistToServer(verify.token, expiresAt).catch((err) => {
      console.warn('[jupiter] persistToServer failed', err);
    });
  }
  return verify.token;
}
