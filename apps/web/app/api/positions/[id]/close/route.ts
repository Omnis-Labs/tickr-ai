import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';

/**
 * POST /api/positions/[id]/close
 *
 * Per spec §Flow 6 — the client has already cancelled TP/SL trigger orders
 * and market-sold the remaining tokens via Jupiter Ultra. This endpoint just
 * mirrors the result into our Position row so the Order Tracker / portfolio
 * agree.
 *
 * Demo: client-side store does the mutation; the route is a no-op ack.
 */
const ClosePayloadSchema = z.object({
  executionPrice: z.number().positive().nullable().optional(),
  tokenAmount: z.number().nonnegative().nullable().optional(),
  txSignature: z.string().nullable().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isDemoServer()) return NextResponse.json({ ok: true, demo: true });
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = ClosePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { executionPrice, tokenAmount } = parsed.data;

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const pos = await prisma.position.findUnique({ where: { id } });
  if (!pos || pos.userId !== auth.userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const realizedPnl =
    executionPrice != null && tokenAmount != null
      ? (executionPrice - pos.entryPrice) * tokenAmount
      : 0;

  const updated = await prisma.position.update({
    where: { id },
    data: {
      state: 'CLOSED',
      closedAt: new Date(),
      closedReason: 'USER_CLOSE',
      realizedPnl,
    },
  });

  return NextResponse.json({ ok: true, position: updated });
}
