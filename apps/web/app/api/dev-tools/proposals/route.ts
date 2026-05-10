import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSignalAssets } from '@hunch-it/shared';
import { requireAuth } from '@/lib/auth/context';
import { devToolsGuard } from '@/lib/dev-tools/auth';
import { ActiveDevToolsProposalError, createDevToolsProposal } from '@/lib/dev-tools/server';

const SIGNAL_ASSET_IDS = new Set(getSignalAssets().map((asset) => asset.assetId));

const Schema = z.object({
  ticker: z.string().refine((value) => SIGNAL_ASSET_IDS.has(value), {
    message: 'Unsupported signal asset',
  }),
});

export async function POST(req: NextRequest) {
  const guard = devToolsGuard(req);
  if (guard) return guard;

  const auth = await requireAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await createDevToolsProposal({
      userId: auth.userId,
      ticker: parsed.data.ticker,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ActiveDevToolsProposalError) {
      return NextResponse.json(
        {
          error: 'active_dev_tools_proposal_exists',
          proposalId: err.proposalId,
        },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[dev-tools] proposal create failed', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
