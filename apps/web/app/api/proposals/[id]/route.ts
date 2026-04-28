import { NextResponse } from 'next/server';
import { makeDemoProposal } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * GET /api/proposals/[id]
 * Cold-read for shared-link / refresh on /proposals/[id].
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  if (isDemoServer()) {
    // Synthesise a stable demo proposal keyed by id so a shared link / refresh
    // still lands on a usable modal.
    const proposal = { ...makeDemoProposal(Math.abs(hash(id))), id };
    return NextResponse.json({ proposal, source: 'demo' });
  }

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: 'proposal not found' }, { status: 404 });
  }
  return NextResponse.json({ proposal, source: 'postgres' });
}
