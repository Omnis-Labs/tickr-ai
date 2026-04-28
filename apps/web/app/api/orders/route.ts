import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { OrderKindSchema } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * Order persistence layer.
 *
 *   GET  /api/orders?wallet=<addr>          List user's open orders.
 *   POST /api/orders                          Persist a Jupiter trigger order
 *                                              after the client has signed +
 *                                              submitted to Jupiter.
 *
 * The client is expected to have already called Jupiter and obtained
 * `jupiterOrderId` + `txSignature`. This route only mirrors that into our DB
 * so the Order Tracker (ws-server) can poll status.
 */
const PersistOrderSchema = z.object({
  walletAddress: z.string().min(1),
  proposalId: z.string().nullable().optional(),
  positionId: z.string().nullable().optional(),
  ticker: z.string(),
  kind: OrderKindSchema,
  side: z.enum(['BUY', 'SELL']),
  triggerPriceUsd: z.number().nullable(),
  sizeUsd: z.number().positive(),
  tokenAmount: z.number().nullable().optional(),
  jupiterOrderId: z.string().min(1),
  txSignature: z.string().nullable().optional(),
  slippageBps: z.number().int().nullable().optional(),
  // For BUY trigger orders we also create a Position(BUY_PENDING) so subsequent
  // TP/SL orders attach to the same row.
  createPosition: z
    .object({
      mint: z.string(),
      entryPriceEstimate: z.number().positive(),
      tpPrice: z.number().positive().nullable(),
      slPrice: z.number().positive().nullable(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ ok: true, demo: true });
  }
  const body: unknown = await req.json().catch(() => null);
  const parsed = PersistOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  const user = await prisma.user.upsert({
    where: { walletAddress: p.walletAddress },
    update: {},
    create: { walletAddress: p.walletAddress },
  });

  // For a BUY trigger order without an existing positionId, open a new
  // Position in BUY_PENDING state. Subsequent TP/SL orders will reference it.
  let positionId = p.positionId ?? null;
  if (!positionId && p.createPosition && p.kind === 'BUY_TRIGGER') {
    const pos = await prisma.position.create({
      data: {
        userId: user.id,
        ticker: p.ticker,
        mint: p.createPosition.mint,
        tokenAmount: 0,
        entryPrice: 0,
        totalCost: 0,
        currentTpPrice: p.createPosition.tpPrice,
        currentSlPrice: p.createPosition.slPrice,
        state: 'BUY_PENDING',
        firstEntryAt: new Date(),
      },
    });
    positionId = pos.id;
  }

  if (!positionId) {
    return NextResponse.json(
      { error: 'positionId is required for non-BUY orders, or createPosition for BUY_TRIGGER' },
      { status: 400 },
    );
  }

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      positionId,
      kind: p.kind,
      side: p.side,
      triggerPriceUsd: p.triggerPriceUsd,
      sizeUsd: p.sizeUsd,
      tokenAmount: p.tokenAmount ?? null,
      status: 'OPEN',
      jupiterOrderId: p.jupiterOrderId,
      txSignature: p.txSignature ?? null,
      slippageBps: p.slippageBps ?? null,
    },
  });

  // Mark proposal EXECUTED if this BUY came from one.
  if (p.proposalId && p.kind === 'BUY_TRIGGER') {
    await prisma.proposal
      .update({ where: { id: p.proposalId }, data: { status: 'EXECUTED' } })
      .catch(() => {
        /* proposal may not exist yet (Phase B emits to memory only) */
      });
  }

  return NextResponse.json({ ok: true, order, positionId });
}

export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ orders: [] });
  }
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) return NextResponse.json({ orders: [] });
  const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!user) return NextResponse.json({ orders: [] });
  const orders = await prisma.order.findMany({
    where: {
      userId: user.id,
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ orders });
}
