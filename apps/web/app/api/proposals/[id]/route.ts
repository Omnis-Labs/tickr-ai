import { NextResponse } from 'next/server';
import { makeDemoProposal } from '@hunch-it/shared';
import { prisma } from '@/lib/db';
import { isDemoServer } from '@/lib/demo/flag';
import { requireAuth } from '@/lib/auth/context';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * GET /api/proposals/[id]
 * Cold-read for shared-link / refresh on /proposals/[id].
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  if (isDemoServer()) {
    const proposal = { ...makeDemoProposal(Math.abs(hash(id))), id };
    return NextResponse.json({ proposal, source: 'demo' });
  }

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal || proposal.userId !== auth.userId) {
    return NextResponse.json({ error: 'proposal not found' }, { status: 404 });
  }
  return NextResponse.json({ proposal, source: 'postgres' });
}
