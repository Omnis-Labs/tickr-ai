// Jupiter Trigger v2 authentication.
//
// v2 mandates a per-wallet JWT obtained via a 2-step challenge/verify
// flow. The wallet signs Jupiter's challenge with its private key,
// proves ownership, and gets a 24h JWT back. The JWT goes on every
// user-scoped request as `Authorization: Bearer <jwt>`.
//
// We use Jupiter's `message` signing path (not `transaction`). The
// transaction path passes a memo-style tx through Privy's
// signTransaction → Privy v3's pre-flight tries to simulate it via the
// configured solana rpc and chokes (`t.slice is not a function` deep
// inside Privy's tx prep). Message signing skips simulation entirely
// — we get a UTF-8 challenge string, ask the wallet to sign it, send
// back base58 signature, done.
//
// JWTs are cached per wallet address in localStorage so a tab refresh
// doesn't re-trigger a Privy modal. They also live in an in-memory
// Map for fast access during a single page lifetime.

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
  type?: 'message' | 'transaction';
  /** UTF-8 message to sign — Jupiter ships this when type='message'. */
  challenge?: string;
  /** Some endpoints return a server-side challenge id we echo back. */
  challengeId?: string;
  expiresAt?: number;
}

interface VerifyResponse {
  token: string;
  expiresAt?: number;
}

export interface JupiterAuthInput {
  walletAddress: string;
  signMessage: (message: string) => Promise<string>;
  /** When provided, after a successful challenge/verify the new JWT is
   *  PATCHed to /api/users/me/jupiter-jwt so the ws-server tracker can
   *  poll Jupiter on the user's behalf. Cache-hit calls skip this — we
   *  only sync on a fresh issue. */
  persistToServer?: (jwt: string, expiresAt: number) => Promise<void>;
}

/**
 * Returns a JWT good for at least REFRESH_MARGIN_MS more. Reads cache
 * first; on miss runs challenge → wallet sign → verify.
 */
export async function getJupiterJwt(input: JupiterAuthInput): Promise<string> {
  const cached = readCached(input.walletAddress);
  if (cached) return cached.token;

  // 1. Ask Jupiter for a challenge MESSAGE tied to this wallet.
  const challengeRes = await fetch(jupiterUrl(CHALLENGE_PATH), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletPubkey: input.walletAddress, type: 'message' }),
  });
  if (!challengeRes.ok) {
    const text = await challengeRes.text().catch(() => '');
    throw new Error(`Jupiter challenge failed (${challengeRes.status}): ${text}`);
  }
  const challenge = (await challengeRes.json()) as ChallengeResponse;
  if (!challenge.challenge) {
    throw new Error('Jupiter challenge response missing `challenge`');
  }

  // 2. Sign the message with the wallet. Returns base58 signature.
  const signature = await input.signMessage(challenge.challenge);

  // 3. Send the signature back to verify and exchange for a JWT.
  const verifyRes = await fetch(jupiterUrl(VERIFY_PATH), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      walletPubkey: input.walletAddress,
      signature,
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
  if (input.persistToServer) {
    void input.persistToServer(verify.token, expiresAt).catch((err) => {
      console.warn('[jupiter] persistToServer failed', err);
    });
  }
  return verify.token;
}
