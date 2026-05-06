import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { userCloseActive, prisma } from '@hunch-it/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/positions/[id]/close
 *
 * Manual market-close of an ACTIVE position. The client has already broadcast
 * the Jupiter Ultra SELL swap and supplies its (txSignature, executionPrice,
 * tokenAmount). This route delegates to userCloseActive which:
 *   • cancels both OPEN exit Orders (TP + SL) for the Position,
 *   • flips Position state ACTIVE → CLOSED with closedReason=USER_CLOSE,
 *   • creates a synthetic CLOSE_SWAP Order carrying the txSignature (this is
 *     also the idempotency key — same signature replayed = duplicate=true,
 *     no double-write),
 *   • creates a Trade(SELL, USER_CLOSE),
 * all in one prisma.\$transaction. Replaces the previous best-effort path
 * that closed the Position but depended on the client to have already
 * cancelled exits and silently swallowed Trade creation failures.
 *
 * Auth: Privy access token. Position must belong to the authed user.
 */
const Schema = z.object({
  txSignature: z.string().min(1),
  executionPrice: z.number().positive(),
  tokenAmount: z.number().positive(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

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

  const result = await userCloseActive({
    userId: auth.userId,
    positionId: id,
    txSignature: parsed.data.txSignature,
    executionPrice: parsed.data.executionPrice,
    tokenAmount: parsed.data.tokenAmount,
  });

  if (result.status === 'conflict') {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  const position = await prisma.position.findUnique({ where: { id } });
  if (result.status === 'duplicate') {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      position: decimalsToNumbers(position),
      cancelledExitOrderIds: [],
      closeOrderId: result.orderId,
    });
  }
  return NextResponse.json({
    ok: true,
    duplicate: false,
    position: decimalsToNumbers(position),
    cancelledExitOrderIds: result.data.cancelledExitOrderIds,
    closeOrderId: result.data.closeOrderId,
  });
}
