import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { confirmSellProposalClose, prisma } from '@hunch-it/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/proposals/[id]/sell-confirm
 *
 * User accepted a thesis-invalidation SELL Proposal. The body carries the
 * realised execution data (executionPrice + tokenAmount + txSignature)
 * from the client-side market sell, exactly like
 * /api/positions/[id]/close. PositionLifecycle closes the Position, cancels
 * open exits, writes the CLOSE_SWAP Order and Trade, and flips the SELL
 * Proposal to EXECUTED in one transaction.
 */
const Body = z.object({
  executionPrice: z.number().positive(),
  tokenAmount: z.number().positive(),
  txSignature: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = await confirmSellProposalClose({
    userId: auth.userId,
    proposalId: id,
    txSignature: parsed.data.txSignature,
    executionPrice: parsed.data.executionPrice,
    tokenAmount: parsed.data.tokenAmount,
  });

  if (result.status === 'conflict') {
    return NextResponse.json(
      { error: result.reason },
      { status: ['proposal_not_found', 'position_not_found'].includes(result.reason) ? 404 : 409 },
    );
  }

  const positionId = result.status === 'success' ? result.data.positionId : result.positionId;
  const position = await prisma.position.findUnique({ where: { id: positionId } });

  return NextResponse.json({
    ok: true,
    duplicate: result.status === 'duplicate',
    position: decimalsToNumbers(position),
    closeOrderId: result.status === 'success' ? result.data.closeOrderId : result.orderId,
    cancelledExitOrderIds: result.status === 'success' ? result.data.cancelledExitOrderIds : [],
  });
}
