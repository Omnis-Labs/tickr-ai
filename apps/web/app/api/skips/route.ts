import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { SkipReasonSchema } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';

/**
 * POST /api/skips
 * body: { proposalId, reason, detail? }
 *
 * Records a skip + marks the proposal as SKIPPED. The user identity comes
 * from the verified Privy access token; the body no longer carries
 * walletAddress.
 */
const SkipBodySchema = z.object({
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
  const { proposalId, reason, detail } = parsed.data;

  if (isDemoServer()) {
    return NextResponse.json({ ok: true, demo: true });
  }

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Best-effort: skip the proposal rather than insert into Skip table if the
  // proposal row doesn't exist (e.g. ws-server hasn't persisted it yet).
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return NextResponse.json({ ok: true, deferred: true });
  if (proposal.userId !== auth.userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  await prisma.skip.upsert({
    where: { userId_proposalId: { userId: auth.userId, proposalId } },
    update: { reason, detail: detail ?? null },
    create: { userId: auth.userId, proposalId, reason, detail: detail ?? null },
  });

  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: 'SKIPPED' },
  });

  return NextResponse.json({ ok: true });
}
