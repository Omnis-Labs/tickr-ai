import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';

/**
 * PATCH /api/users/me/jupiter-jwt
 *
 * The web client obtains a Jupiter Trigger v2 JWT via Privy challenge/
 * verify (lib/jupiter/auth.ts) and posts it here so the ws-server
 * Order Tracker can poll the user's order history without holding
 * their wallet keys. JWT lifetime is ~24h on Jupiter's side; the web
 * client refreshes automatically on cache miss and re-PATCHes.
 *
 * Auth: Privy access token (the same one for /api/* in general). The
 * userId comes from the verified token; the JWT payload is stored
 * against that user only.
 *
 * Demo mode short-circuits — no Jupiter calls happen in demo.
 */

const Schema = z.object({
  jwt: z.string().min(20),
  /** Unix milliseconds. Jupiter normally returns this on /verify; web
   *  client falls back to now+24h if missing. */
  expiresAt: z.number().int().positive(),
});

export async function PATCH(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ ok: true, demo: true });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await prisma.user.update({
    where: { id: auth.userId },
    data: {
      jupiterJwt: parsed.data.jwt,
      jupiterJwtExpiresAt: new Date(parsed.data.expiresAt),
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/users/me/jupiter-jwt
 * Wipe the cached JWT (e.g. on logout, or when the tracker reports 401).
 */
export async function DELETE(req: NextRequest) {
  if (isDemoServer()) return NextResponse.json({ ok: true, demo: true });

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await prisma.user.update({
    where: { id: auth.userId },
    data: { jupiterJwt: null, jupiterJwtExpiresAt: null },
  });

  return NextResponse.json({ ok: true });
}
