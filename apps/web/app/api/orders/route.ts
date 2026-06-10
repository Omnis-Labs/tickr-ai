import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { OrderKindSchema } from '@hunch-it/shared';
import { acceptBuyProposal, placeProtectionOrder } from '@hunch-it/db';
import { prisma } from '@/lib/db';
import { requireAuth, requireAuthOrUpsert } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';
import { serializeOpenOrdersForClient } from '@/lib/orders/open-orders';

/**
 * Order persistence layer.
 *
 *   GET  /api/orders          List the authed user's open orders.
 *   POST /api/orders          Accept a BUY proposal into synthetic DB Orders.
 *
 * Synthetic orders have no external trigger provider. The ws-server
 * trigger monitor later emits `trigger:hit`; the client executes a Jupiter
 * Ultra swap only after the user taps Execute.
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
  txSignature: z.string().nullable().optional(),
  slippageBps: z.number().int().nullable().optional(),
  // For BUY trigger orders we also create a Position(BUY_PENDING). Exit legs
  // are delegated to PositionLifecycle after the position exists.
  createPosition: z
    .object({
      mint: z.string(),
      entryPriceEstimate: z.number().positive(),
      tpPrice: z.number().positive().nullable(),
      slPrice: z.number().positive().nullable(),
    })
    .optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  if (p.kind === 'BUY_TRIGGER') {
    if (
      !p.proposalId ||
      !p.createPosition ||
      p.triggerPriceUsd == null ||
      p.createPosition.tpPrice == null ||
      p.createPosition.slPrice == null
    ) {
      return NextResponse.json(
        {
          error:
            'BUY_TRIGGER requires proposalId, createPosition with tpPrice/slPrice, triggerPriceUsd',
        },
        { status: 400 },
      );
    }
    const result = await acceptBuyProposal({
      userId: ctx.userId,
      proposalId: p.proposalId,
      ticker: p.ticker,
      mint: p.createPosition.mint,
      sizeUsd: p.sizeUsd,
      triggerPriceUsd: p.triggerPriceUsd,
      tpPrice: p.createPosition.tpPrice,
      slPrice: p.createPosition.slPrice,
      entryPriceEstimate: p.createPosition.entryPriceEstimate,
    });
    if (result.status === 'conflict') {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    const orderId = result.status === 'success' ? result.data.orderId : result.orderId;
    const positionId = result.status === 'success' ? result.data.positionId : result.positionId;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    return NextResponse.json({
      ok: true,
      duplicate: result.status === 'duplicate',
      order: decimalsToNumbers(order),
      positionId,
    });
  }

  const positionId = p.positionId ?? null;
  if (!positionId) {
    return NextResponse.json(
      { error: 'positionId is required for non-BUY orders' },
      { status: 400 },
    );
  }

  if (p.kind !== 'TAKE_PROFIT' && p.kind !== 'STOP_LOSS') {
    return NextResponse.json(
      { error: `cannot create order kind ${p.kind} via this route` },
      { status: 400 },
    );
  }
  if (p.side !== 'SELL') {
    return NextResponse.json({ error: 'protection orders must be SELL orders' }, { status: 400 });
  }
  if (p.triggerPriceUsd == null || p.tokenAmount == null) {
    return NextResponse.json(
      { error: 'protection orders require triggerPriceUsd and tokenAmount' },
      { status: 400 },
    );
  }

  const result = await placeProtectionOrder({
    userId: ctx.userId,
    positionId,
    kind: p.kind,
    triggerPriceUsd: p.triggerPriceUsd,
    tokenAmount: p.tokenAmount,
    slippageBps: p.slippageBps ?? null,
  });
  if (result.status === 'conflict') {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === 'position_not_found' ? 404 : 409 },
    );
  }

  const orderId = result.status === 'success' ? result.data.orderId : result.orderId;
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
  });

  return NextResponse.json({
    ok: true,
    duplicate: result.status === 'duplicate',
    order: decimalsToNumbers(order),
    positionId,
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireAuth(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const orders = await prisma.order.findMany({
    where: {
      userId: ctx.userId,
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
    },
    select: {
      id: true,
      positionId: true,
      kind: true,
      side: true,
      status: true,
      jupiterOrderId: true,
      triggerPriceUsd: true,
      sizeUsd: true,
      tokenAmount: true,
      position: { select: { ticker: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ orders: serializeOpenOrdersForClient(orders) });
}
