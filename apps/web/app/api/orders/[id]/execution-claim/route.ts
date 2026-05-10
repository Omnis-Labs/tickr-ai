import { NextResponse, type NextRequest } from 'next/server';
import {
  claimOrderExecution,
  prisma,
  releaseOrderExecutionClaim,
} from '@hunch-it/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * Short-lived server-side execution claim for synthetic trigger orders.
 *
 * The wallet swap happens in the browser before /execute can settle the DB
 * fill, so duplicate toasts/tabs need a DB-backed guard before any on-chain
 * transaction starts. POST claims OPEN -> PENDING; DELETE releases only when
 * the browser failed before broadcast and no tx signature was written.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const result = await claimOrderExecution({ userId: auth.userId, orderId: id });
  if (result.status === 'conflict') {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  if (result.status !== 'success') {
    return NextResponse.json({ error: 'unexpected_claim_result' }, { status: 409 });
  }

  const order = await prisma.order.findUnique({ where: { id } });
  return NextResponse.json({
    ok: true,
    claim: result.data,
    order: decimalsToNumbers(order),
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const result = await releaseOrderExecutionClaim({ userId: auth.userId, orderId: id });
  if (result.status === 'conflict') {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  if (result.status !== 'success') {
    return NextResponse.json({ error: 'unexpected_release_result' }, { status: 409 });
  }

  const order = await prisma.order.findUnique({ where: { id } });
  return NextResponse.json({
    ok: true,
    release: result.data,
    order: decimalsToNumbers(order),
  });
}
