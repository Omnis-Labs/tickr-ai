import 'server-only';
import type { PrivyClient } from '@privy-io/server-auth';

/**
 * Server-side Privy access token verification.
 *
 *   const claims = await verifyPrivyToken(req);
 *   if (!claims) return 401;
 *   // claims.userId is the canonical Privy user id
 *
 * Lazy-imports the SDK so a missing PRIVY_APP_SECRET (e.g. local dev without
 * Privy creds) doesn't crash module load — every API route falls back to the
 * demo path via isDemoServer().
 */

interface PrivyAuthClaims {
  userId: string; // claims.userId from Privy ('did:privy:...')
}

let cachedClient: PrivyClient | null = null;
async function getClient(): Promise<PrivyClient | null> {
  if (cachedClient) return cachedClient;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return null;
  try {
    const mod = await import('@privy-io/server-auth');
    cachedClient = new mod.PrivyClient(appId, secret);
    return cachedClient;
  } catch (err) {
    console.warn('[auth] @privy-io/server-auth load failed', err);
    return null;
  }
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  if (!h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim() || null;
}

export async function verifyPrivyToken(req: Request): Promise<PrivyAuthClaims | null> {
  const token = extractBearer(req);
  if (!token) return null;
  const client = await getClient();
  if (!client) return null;
  try {
    const verified = await client.verifyAuthToken(token);
    if (!verified?.userId) return null;
    return { userId: verified.userId };
  } catch {
    return null;
  }
}
