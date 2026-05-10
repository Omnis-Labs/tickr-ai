import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { SkipReasonSchema } from '@hunch-it/shared';
import { expireActiveProposals, prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth/context';

/**
 * POST /api/skips
 * body: { proposalId, reason?, detail? }
 *
 * Marks the proposal as SKIPPED and records feedback when a reason is provided.
 * The user identity comes from the verified Privy access token; the body no
 * longer carries walletAddress.
 */
const SkipBodySchema = z.object({
  proposalId: z.string().min(1),
  reason: SkipReasonSchema.optional(),
  detail: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body: unknown = await req.json().catch(() => null);
  const parsed = SkipBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { proposalId, reason, detail } = parsed.data;

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date();
  await expireActiveProposals(prisma, { userId: auth.userId, now });

  // Best-effort: skip the proposal rather than insert into Skip table if the
  // proposal row doesn't exist (e.g. ws-server hasn't persisted it yet).
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return NextResponse.json({ ok: true, deferred: true });
  if (proposal.userId !== auth.userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (proposal.status === 'EXPIRED' || proposal.expiresAt.getTime() <= now.getTime()) {
    return NextResponse.json({ ok: true, expired: true });
  }

  if (reason) {
    await prisma.skip.upsert({
      where: { userId_proposalId: { userId: auth.userId, proposalId } },
      update: { reason, detail: detail ?? null },
      create: { userId: auth.userId, proposalId, reason, detail: detail ?? null },
    });
  }

  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: 'SKIPPED' },
  });

  return NextResponse.json({ ok: true });
}
