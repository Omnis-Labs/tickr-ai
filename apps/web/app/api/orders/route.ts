import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { OrderKindSchema } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth, requireAuthOrUpsert } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * Order persistence layer.
 *
 *   GET  /api/orders          List the authed user's open orders.
 *   POST /api/orders          Persist a Jupiter trigger order after the
 *                              client has signed + submitted it to Jupiter.
 *
 * The client is expected to have already called Jupiter and obtained
 * `jupiterOrderId` + `txSignature`. This route only mirrors that into our DB
 * so the Order Tracker (ws-server) can poll status.
 *
 * Auth: Privy access token. User identity is taken from the token, NOT from
 * any wallet-address field on the request — the body retains walletAddress
 * only for first-touch user creation (POST), tied to the verified Privy id.
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
  // xStocks are off Jupiter Trigger v2's allowlist, so our BUY/TP/SL
  // orders are now synthetic: ws-server's price monitor watches Pyth
  // and pushes a `trigger:hit` event to the user when the condition
  // fires; the user signs an Ultra swap at that moment. jupiterOrderId
  // is filled in once the Ultra swap returns a tx signature.
  jupiterOrderId: z.string().nullable().optional(),
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

  const ctx = await requireAuthOrUpsert(req, p.walletAddress);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // For a BUY trigger order without an existing positionId, open a new
  // Position in BUY_PENDING state. Subsequent TP/SL orders will reference it.
  let positionId = p.positionId ?? null;
  if (!positionId && p.createPosition && p.kind === 'BUY_TRIGGER') {
    const pos = await prisma.position.create({
      data: {
        userId: ctx.userId,
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

  // Verify the position belongs to this user — prevents writing orders into
  // someone else's position by passing a foreign positionId.
  const pos = await prisma.position.findUnique({ where: { id: positionId } });
  if (!pos || pos.userId !== ctx.userId) {
    return NextResponse.json({ error: 'position not found' }, { status: 404 });
  }

  const order = await prisma.order.create({
    data: {
      userId: ctx.userId,
      positionId,
      kind: p.kind,
      side: p.side,
      triggerPriceUsd: p.triggerPriceUsd,
      sizeUsd: p.sizeUsd,
      tokenAmount: p.tokenAmount ?? null,
      status: 'OPEN',
      jupiterOrderId: p.jupiterOrderId ?? null,
      txSignature: p.txSignature ?? null,
      slippageBps: p.slippageBps ?? null,
    },
  });

  // Mark proposal EXECUTED if this BUY came from one — but only the user's own.
  if (p.proposalId && p.kind === 'BUY_TRIGGER') {
    await prisma.proposal
      .updateMany({
        where: { id: p.proposalId, userId: ctx.userId },
        data: { status: 'EXECUTED' },
      })
      .catch(() => {
        /* proposal may not exist yet (Phase B emits to memory only) */
      });
  }

  return NextResponse.json({ ok: true, order: decimalsToNumbers(order), positionId });
}

export async function GET(req: NextRequest) {
  if (isDemoServer()) {
    return NextResponse.json({ orders: [] });
  }
  const ctx = await requireAuth(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const orders = await prisma.order.findMany({
    where: {
      userId: ctx.userId,
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ orders: decimalsToNumbers(orders) });
}
