import { NextResponse } from 'next/server';
import { expireActiveProposals, prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/context';
import { decimalsToNumbers } from '@/lib/db/decimal';

/**
 * GET /api/proposals/[id]
 * Cold-read for shared-link / refresh on /proposals/[id].
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date();
  await expireActiveProposals(prisma, { userId: auth.userId, now });

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal || proposal.userId !== auth.userId) {
    return NextResponse.json({ error: 'proposal not found' }, { status: 404 });
  }
  if (proposal.status === 'EXPIRED' || proposal.expiresAt.getTime() <= now.getTime()) {
    return NextResponse.json({ error: 'proposal expired' }, { status: 404 });
  }
  return NextResponse.json({ proposal: decimalsToNumbers(proposal), source: 'postgres' });
}
