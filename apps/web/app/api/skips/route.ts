import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { SkipReasonSchema } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

/**
 * POST /api/skips
 * body: { walletAddress, proposalId, reason, detail? }
 *
 * Records a skip + marks the proposal as SKIPPED. In demo mode echoes back
 * without DB writes.
 */
const SkipBodySchema = z.object({
  walletAddress: z.string().min(1),
  proposalId: z.string().min(1),
  reason: SkipReasonSchema,
  detail: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = SkipBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { walletAddress, proposalId, reason, detail } = parsed.data;

  if (isDemoServer()) {
    return NextResponse.json({ ok: true, demo: true });
  }

  // Best-effort: skip the proposal rather than insert into Skip table if the
  // proposal row doesn't exist (e.g. ws-server hasn't persisted it yet).
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return NextResponse.json({ ok: true, deferred: true });

  const user = await prisma.user.upsert({
    where: { walletAddress },
    update: {},
    create: { walletAddress },
  });

  await prisma.skip.upsert({
    where: { userId_proposalId: { userId: user.id, proposalId } },
    update: { reason, detail: detail ?? null },
    create: { userId: user.id, proposalId, reason, detail: detail ?? null },
  });

  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: 'SKIPPED' },
  });

  return NextResponse.json({ ok: true });
}
