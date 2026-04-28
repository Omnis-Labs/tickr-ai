import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * POST /api/proposals/[id]/sell-confirm
 *
 * User accepted a thesis-invalidation SELL Proposal. The body carries the
 * realised execution data (executionPrice + tokenAmount + txSignature)
 * from the client-side market sell, exactly like
 * /api/positions/[id]/close — but here we also flip the SELL Proposal to
 * EXECUTED so leaderboard / outcome tracking can attribute the close to
 * the SELL signal.
 *
 * Demo: returns ok with no DB writes (the demo store mutates positions).
 */
const Body = z.object({
  executionPrice: z.number().positive().nullable().optional(),
  tokenAmount: z.number().nonnegative().nullable().optional(),
  txSignature: z.string().nullable().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  if (isDemoServer()) return NextResponse.json({ ok: true, demo: true });

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
  const { executionPrice, tokenAmount, txSignature } = parsed.data;

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (
    !proposal ||
    proposal.userId !== auth.userId ||
    proposal.action !== 'SELL' ||
    !proposal.positionId
  ) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const position = await prisma.position.findUnique({
    where: { id: proposal.positionId },
  });
  if (!position || position.userId !== auth.userId) {
    return NextResponse.json({ error: 'position not found' }, { status: 404 });
  }

  const realizedPnl =
    executionPrice != null && tokenAmount != null
      ? (executionPrice - position.entryPrice.toNumber()) * tokenAmount
      : 0;

  const [updatedPosition, _trade] = await Promise.all([
    prisma.position.update({
      where: { id: position.id },
      data: {
        state: 'CLOSED',
        closedAt: new Date(),
        closedReason: 'USER_CLOSE',
        realizedPnl,
      },
    }),
    prisma.trade.create({
      data: {
        userId: auth.userId,
        positionId: position.id,
        proposalId: proposal.id,
        ticker: position.ticker,
        side: 'SELL',
        source: 'USER_CLOSE',
        actualSizeUsd:
          executionPrice != null && tokenAmount != null
            ? executionPrice * tokenAmount
            : 0,
        executionPrice,
        filledAmount: tokenAmount,
        realizedPnl,
      },
    }),
  ]);

  await prisma.proposal.update({
    where: { id: proposal.id },
    data: { status: 'EXECUTED' },
  });

  void txSignature; // currently informational — Trade has no txSignature column

  return NextResponse.json({
    ok: true,
    position: decimalsToNumbers(updatedPosition),
  });
}
