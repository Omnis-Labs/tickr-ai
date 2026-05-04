import 'server-only';
import { cookies } from 'next/headers';
import type { PrivyClient } from '@privy-io/server-auth';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

export type SessionStage = 'SIGNED_OUT' | 'NEEDS_MANDATE' | 'READY';

export interface SessionState {
  stage: SessionStage;
  userId: string | null;
  walletAddress: string | null;
  hasMandate: boolean;
  nextPath: '/login' | '/mandate' | '/desk' | null;
}

const PRIVY_COOKIE_NAMES = ['privy-token', 'privy-id-token'];
const DEMO_PRIVY_ID = 'did:privy:demo-user';
const DEMO_WALLET = 'demo-wallet';

let cachedClient: PrivyClient | null = null;
async function getPrivy(): Promise<PrivyClient | null> {
  if (cachedClient) return cachedClient;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return null;
  try {
    const mod = await import('@privy-io/server-auth');
    cachedClient = new mod.PrivyClient(appId, secret);
    return cachedClient;
  } catch {
    return null;
  }
}

async function privyUserIdForToken(token: string): Promise<string | null> {
  const client = await getPrivy();
  if (!client) return null;
  try {
    const v = await client.verifyAuthToken(token);
    return v?.userId ?? null;
  } catch {
    return null;
  }
}

function signedOut(): SessionState {
  return {
    stage: 'SIGNED_OUT',
    userId: null,
    walletAddress: null,
    hasMandate: false,
    nextPath: '/login',
  };
}

async function stateForPrivyUserId(privyUserId: string | null): Promise<SessionState> {
  if (!privyUserId) return signedOut();
  const user = await prisma.user.findUnique({
    where: { privyUserId },
    select: { id: true, walletAddress: true, mandate: { select: { id: true } } },
  });
  if (!user) {
    return {
      stage: 'NEEDS_MANDATE',
      userId: null,
      walletAddress: null,
      hasMandate: false,
      nextPath: '/mandate',
    };
  }
  const hasMandate = !!user.mandate;
  return {
    stage: hasMandate ? 'READY' : 'NEEDS_MANDATE',
    userId: user.id,
    walletAddress: user.walletAddress,
    hasMandate,
    nextPath: hasMandate ? '/desk' : '/mandate',
  };
}

async function demoState(): Promise<SessionState> {
  const user = await prisma.user.upsert({
    where: { walletAddress: DEMO_WALLET },
    update: {},
    create: { privyUserId: DEMO_PRIVY_ID, walletAddress: DEMO_WALLET },
    select: { id: true, walletAddress: true, mandate: { select: { id: true } } },
  });
  const hasMandate = !!user.mandate;
  return {
    stage: hasMandate ? 'READY' : 'NEEDS_MANDATE',
    userId: user.id,
    walletAddress: user.walletAddress,
    hasMandate,
    nextPath: hasMandate ? '/desk' : '/mandate',
  };
}

export async function resolveSession(req: Request): Promise<SessionState> {
  if (isDemoServer()) return demoState();
  const h = req.headers.get('authorization') ?? '';
  const token = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;
  const privyUserId = token ? await privyUserIdForToken(token) : null;
  return stateForPrivyUserId(privyUserId);
}

export async function resolveSessionFromCookies(): Promise<SessionState> {
  if (isDemoServer()) return demoState();
  const jar = await cookies();
  let token: string | null = null;
  for (const name of PRIVY_COOKIE_NAMES) {
    const v = jar.get(name)?.value;
    if (v) {
      token = v;
      break;
    }
  }
  const privyUserId = token ? await privyUserIdForToken(token) : null;
  return stateForPrivyUserId(privyUserId);
}
